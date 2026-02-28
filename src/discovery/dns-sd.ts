/**
 * DNS-SD Service Advertisement and Browsing — RFC 6763 compliant.
 *
 * Provides high-level service advertisement (`advertise`/`stop`) and
 * discovery (`browse`/`resolve`) using the mDNS transport layer and
 * DNS packet encoder/decoder.
 *
 * Service instances are advertised with PTR + SRV + TXT + A records.
 * Browsing queries for PTR records and resolves discovered instances.
 */

import { hostname, networkInterfaces } from 'node:os'
import { MdnsResponder, type MdnsOptions } from './mdns.js'
import { RecordCache } from './cache.js'
import {
  RECORD_TYPE,
  RECORD_CLASS,
  CACHE_FLUSH_BIT,
  FLAGS_QR_RESPONSE,
  FLAGS_QR_QUERY,
  encodeA,
  encodeSrv,
  encodeTxt,
  encodePtr,
  decodeA,
  decodeSrv,
  decodeTxt,
  decodePtr,
  type DnsPacket,
  type DnsResourceRecord,
} from './dns-packet.js'
import type { ServiceInfo, DiscoveredService, ResolveResult } from './schemas.js'

const MDNS_DOMAIN = 'local'
const DEFAULT_TTL = 120 // RFC 6762 recommended default TTL

export interface DnsSdOptions {
  /** mDNS transport options */
  mdns?: MdnsOptions
}

/**
 * DNS-SD discovery service.
 *
 * Advertises services on the local network via mDNS and discovers
 * other CareAgent services using DNS-SD PTR/SRV/TXT queries.
 */
export class DnsSdService {
  private responder: MdnsResponder
  private cache: RecordCache
  private serviceInfo: ServiceInfo | null = null
  private reannounceTimer: ReturnType<typeof setInterval> | null = null
  private localHost: string
  private localAddresses: string[]

  constructor(options: DnsSdOptions = {}) {
    this.responder = new MdnsResponder(options.mdns)
    this.cache = new RecordCache()
    this.localHost = hostname() + '.' + MDNS_DOMAIN
    this.localAddresses = this.getLocalIPv4Addresses()
  }

  /**
   * Start advertising a service on the local network.
   *
   * Creates PTR, SRV, TXT, and A records for the service and begins
   * multicast advertisement. Re-announces before TTL expiry to maintain
   * presence.
   */
  async advertise(info: ServiceInfo): Promise<void> {
    this.serviceInfo = info
    this.localAddresses = this.getLocalIPv4Addresses()
    if (info.host) {
      this.localHost = info.host.includes('.')
        ? info.host
        : info.host + '.' + MDNS_DOMAIN
    }

    await this.responder.start()

    // Listen for incoming queries to respond to
    this.responder.on('packet', (packet, rinfo) => {
      this.handleIncomingPacket(packet, rinfo)
    })

    // Send initial announcement (RFC 6762 Section 8.3)
    await this.sendAnnouncement()

    // Re-announce at 80% of TTL (RFC 6762 Section 5.2)
    const ttl = info.ttl ?? DEFAULT_TTL
    const reannounceMs = ttl * 800 // 80% of TTL in ms
    this.reannounceTimer = setInterval(async () => {
      try {
        await this.sendAnnouncement()
      } catch {
        // Ignore send errors during re-announce
      }
    }, reannounceMs)

    if (this.reannounceTimer.unref) {
      this.reannounceTimer.unref()
    }

    // Start cache cleanup
    this.cache.startCleanup()
  }

  /**
   * Stop advertising and send goodbye packets (TTL=0) per RFC 6762 Section 10.1.
   */
  async stop(): Promise<void> {
    if (this.reannounceTimer) {
      clearInterval(this.reannounceTimer)
      this.reannounceTimer = null
    }

    if (this.serviceInfo && this.responder.isActive) {
      try {
        await this.sendGoodbye()
      } catch {
        // Best-effort goodbye
      }
    }

    this.cache.stopCleanup()
    this.cache.clear()
    await this.responder.stop()
    this.serviceInfo = null
  }

  /**
   * Browse for services of a given type on the local network.
   *
   * Sends a PTR query for `_serviceType._tcp.local` and collects
   * responses within the timeout window.
   */
  async browse(serviceType: string, timeoutMs: number = 3000): Promise<DiscoveredService[]> {
    const wasActive = this.responder.isActive

    if (!wasActive) {
      await this.responder.start()
      this.responder.on('packet', (packet) => {
        this.handleBrowseResponse(packet)
      })
    }

    const fqServiceType = this.fqServiceType(serviceType)

    // Send PTR query
    const queryPacket: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_QUERY,
        qdcount: 1,
        ancount: 0,
        nscount: 0,
        arcount: 0,
      },
      questions: [
        {
          name: fqServiceType,
          type: RECORD_TYPE.PTR,
          class: RECORD_CLASS.IN,
        },
      ],
      answers: [],
      authorities: [],
      additionals: [],
    }

    await this.responder.send(queryPacket)

    // Wait for responses
    const services: Map<string, DiscoveredService> = new Map()

    await new Promise<void>((resolve) => {
      const handler = (packet: DnsPacket) => {
        this.extractServices(packet, fqServiceType, services)
      }

      this.responder.on('packet', handler)

      setTimeout(() => {
        this.responder.removeListener('packet', handler)
        resolve()
      }, timeoutMs)
    })

    if (!wasActive) {
      await this.responder.stop()
    }

    return Array.from(services.values())
  }

  /**
   * Resolve a specific service instance to host:port + TXT data.
   *
   * Sends SRV + TXT + A queries for the given service name.
   */
  async resolve(
    serviceName: string,
    timeoutMs: number = 3000,
  ): Promise<ResolveResult | null> {
    const wasActive = this.responder.isActive

    if (!wasActive) {
      await this.responder.start()
    }

    const fqName = serviceName.endsWith('.' + MDNS_DOMAIN)
      ? serviceName
      : serviceName + '.' + MDNS_DOMAIN

    // Send SRV + TXT queries
    const queryPacket: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_QUERY,
        qdcount: 2,
        ancount: 0,
        nscount: 0,
        arcount: 0,
      },
      questions: [
        { name: fqName, type: RECORD_TYPE.SRV, class: RECORD_CLASS.IN },
        { name: fqName, type: RECORD_TYPE.TXT, class: RECORD_CLASS.IN },
      ],
      answers: [],
      authorities: [],
      additionals: [],
    }

    await this.responder.send(queryPacket)

    // Collect result
    let result: ResolveResult | null = null

    await new Promise<void>((resolve) => {
      const handler = (packet: DnsPacket) => {
        const allRecords = [
          ...packet.answers,
          ...packet.additionals,
        ]

        let host = ''
        let port = 0
        const addresses: string[] = []
        let txt: Record<string, string> = {}

        for (const rr of allRecords) {
          if (rr.name === fqName && rr.type === RECORD_TYPE.SRV) {
            const srv = decodeSrv(rr.rdata)
            host = srv.target
            port = srv.port
          }
          if (rr.name === fqName && rr.type === RECORD_TYPE.TXT) {
            txt = decodeTxt(rr.rdata)
          }
          if (rr.type === RECORD_TYPE.A) {
            addresses.push(decodeA(rr.rdata))
          }
        }

        if (host && port > 0) {
          result = { host, port, addresses, txt }
          this.responder.removeListener('packet', handler)
          resolve()
        }
      }

      this.responder.on('packet', handler)

      setTimeout(() => {
        this.responder.removeListener('packet', handler)
        resolve()
      }, timeoutMs)
    })

    if (!wasActive) {
      await this.responder.stop()
    }

    return result
  }

  /** Access the underlying record cache */
  getCache(): RecordCache {
    return this.cache
  }

  /** Access the underlying mDNS responder (for testing) */
  getResponder(): MdnsResponder {
    return this.responder
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Build the fully-qualified DNS-SD service type name.
   * Input:  "_careagent._tcp" or "_careagent"
   * Output: "_careagent._tcp.local"
   */
  private fqServiceType(serviceType: string): string {
    let fq = serviceType
    if (!fq.includes('._tcp') && !fq.includes('._udp')) {
      fq = fq + '._tcp'
    }
    if (!fq.endsWith('.' + MDNS_DOMAIN)) {
      fq = fq + '.' + MDNS_DOMAIN
    }
    return fq
  }

  /**
   * Build the fully-qualified service instance name.
   * Example: "neuron-abc123._careagent._tcp.local"
   */
  private fqInstanceName(): string {
    if (!this.serviceInfo) throw new Error('No service info configured')
    const fqType = this.fqServiceType(this.serviceInfo.serviceType)
    return `${this.serviceInfo.serviceName}.${fqType}`
  }

  /**
   * Send an announcement with all records for our service.
   */
  private async sendAnnouncement(): Promise<void> {
    if (!this.serviceInfo) return

    const ttl = this.serviceInfo.ttl ?? DEFAULT_TTL
    const records = this.buildServiceRecords(ttl)

    const packet: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_RESPONSE,
        qdcount: 0,
        ancount: records.length,
        nscount: 0,
        arcount: 0,
      },
      questions: [],
      answers: records,
      authorities: [],
      additionals: [],
    }

    await this.responder.send(packet)
  }

  /**
   * Send goodbye packets (TTL=0) for all our service records.
   */
  private async sendGoodbye(): Promise<void> {
    if (!this.serviceInfo) return

    const records = this.buildServiceRecords(0) // TTL=0 = goodbye

    const packet: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_RESPONSE,
        qdcount: 0,
        ancount: records.length,
        nscount: 0,
        arcount: 0,
      },
      questions: [],
      answers: records,
      authorities: [],
      additionals: [],
    }

    await this.responder.send(packet)
  }

  /**
   * Build all DNS records for the configured service.
   */
  private buildServiceRecords(ttl: number): DnsResourceRecord[] {
    if (!this.serviceInfo) return []

    const fqType = this.fqServiceType(this.serviceInfo.serviceType)
    const fqInstance = this.fqInstanceName()
    const classFlush = RECORD_CLASS.IN | CACHE_FLUSH_BIT

    const records: DnsResourceRecord[] = []

    // PTR record: _careagent._tcp.local → neuron-abc123._careagent._tcp.local
    records.push({
      name: fqType,
      type: RECORD_TYPE.PTR,
      class: RECORD_CLASS.IN, // PTR records don't use cache-flush
      ttl,
      rdata: encodePtr(fqInstance),
    })

    // SRV record: neuron-abc123._careagent._tcp.local → hostname:port
    records.push({
      name: fqInstance,
      type: RECORD_TYPE.SRV,
      class: classFlush,
      ttl,
      rdata: encodeSrv({
        priority: 0,
        weight: 0,
        port: this.serviceInfo.port,
        target: this.localHost,
      }),
    })

    // TXT record: neuron-abc123._careagent._tcp.local → key=value pairs
    records.push({
      name: fqInstance,
      type: RECORD_TYPE.TXT,
      class: classFlush,
      ttl,
      rdata: encodeTxt(this.serviceInfo.txt ?? {}),
    })

    // A records: hostname.local → IPv4 addresses
    for (const addr of this.localAddresses) {
      records.push({
        name: this.localHost,
        type: RECORD_TYPE.A,
        class: classFlush,
        ttl,
        rdata: encodeA(addr),
      })
    }

    return records
  }

  /**
   * Handle incoming mDNS packets — respond to queries for our service.
   */
  private handleIncomingPacket(
    packet: DnsPacket,
    _rinfo: { address: string; port: number },
  ): void {
    // Cache received answers
    for (const rr of [...packet.answers, ...packet.additionals]) {
      this.cache.put(rr)
    }

    // Only respond to queries (QR bit = 0)
    if (packet.header.flags & 0x8000) return
    if (!this.serviceInfo) return

    const fqType = this.fqServiceType(this.serviceInfo.serviceType)
    const fqInstance = this.fqInstanceName()

    let shouldRespond = false

    for (const q of packet.questions) {
      if (
        (q.name === fqType && q.type === RECORD_TYPE.PTR) ||
        (q.name === fqInstance &&
          (q.type === RECORD_TYPE.SRV ||
            q.type === RECORD_TYPE.TXT ||
            q.type === RECORD_TYPE.A ||
            q.type === 255)) || // ANY
        (q.name === this.localHost && q.type === RECORD_TYPE.A)
      ) {
        shouldRespond = true
        break
      }
    }

    if (shouldRespond) {
      const ttl = this.serviceInfo.ttl ?? DEFAULT_TTL
      const records = this.buildServiceRecords(ttl)

      const response: DnsPacket = {
        header: {
          id: 0,
          flags: FLAGS_QR_RESPONSE,
          qdcount: 0,
          ancount: records.length,
          nscount: 0,
          arcount: 0,
        },
        questions: [],
        answers: records,
        authorities: [],
        additionals: [],
      }

      this.responder.send(response).catch(() => {
        // Ignore send errors for responses
      })
    }
  }

  /**
   * Handle browse responses — extract service info from PTR/SRV/TXT/A records.
   */
  private handleBrowseResponse(packet: DnsPacket): void {
    for (const rr of [...packet.answers, ...packet.additionals]) {
      this.cache.put(rr)
    }
  }

  /**
   * Extract discovered services from a response packet.
   */
  private extractServices(
    packet: DnsPacket,
    fqServiceType: string,
    services: Map<string, DiscoveredService>,
  ): void {
    const allRecords = [
      ...packet.answers,
      ...packet.additionals,
    ]

    // Find PTR records pointing to service instances
    for (const rr of allRecords) {
      if (rr.type === RECORD_TYPE.PTR && rr.name === fqServiceType) {
        const instanceName = decodePtr(rr.rdata)

        // Look for SRV and TXT in the same packet
        let host = ''
        let port = 0
        let txt: Record<string, string> = {}
        const addresses: string[] = []

        for (const other of allRecords) {
          if (other.name === instanceName && other.type === RECORD_TYPE.SRV) {
            const srv = decodeSrv(other.rdata)
            host = srv.target
            port = srv.port
          }
          if (other.name === instanceName && other.type === RECORD_TYPE.TXT) {
            txt = decodeTxt(other.rdata)
          }
          if (other.type === RECORD_TYPE.A) {
            addresses.push(decodeA(other.rdata))
          }
        }

        // Extract short name from instance name
        const shortName = instanceName.replace('.' + fqServiceType, '')

        services.set(instanceName, {
          fullName: instanceName,
          serviceName: shortName,
          serviceType: fqServiceType.replace('.' + MDNS_DOMAIN, ''),
          host,
          port,
          addresses,
          txt,
          ttl: rr.ttl,
        })
      }
    }
  }

  /**
   * Get all non-internal IPv4 addresses of this machine.
   */
  private getLocalIPv4Addresses(): string[] {
    const ifaces = networkInterfaces()
    const addresses: string[] = []

    for (const [, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          addresses.push(addr.address)
        }
      }
    }

    // Fall back to loopback if no external addresses found
    if (addresses.length === 0) {
      addresses.push('127.0.0.1')
    }

    return addresses
  }
}

/**
 * Factory function matching the session's example usage pattern.
 */
export function createDiscoveryService(
  info: ServiceInfo & { mdns?: MdnsOptions },
): DnsSdService {
  const { mdns, ...serviceInfo } = info
  const service = new DnsSdService({ mdns })
  // Store the service info for later use in advertise()
  return Object.assign(service, { _serviceInfo: serviceInfo })
}
