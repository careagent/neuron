/**
 * mDNS Responder — RFC 6762 compliant multicast DNS.
 *
 * Manages UDP multicast sockets on port 5353, joining the mDNS multicast
 * group (224.0.0.251) on all available network interfaces. Provides the
 * transport layer for DNS-SD service advertisement and browsing.
 *
 * Uses only Node.js built-in modules: `dgram`, `os`, `events`.
 */

import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { EventEmitter } from 'node:events'
import {
  decodePacket,
  encodePacket,
  type DnsPacket,
} from './dns-packet.js'

/** mDNS multicast address (IPv4) */
export const MDNS_MULTICAST_ADDR = '224.0.0.251'
/** mDNS port */
export const MDNS_PORT = 5353

export interface MdnsEvents {
  packet: (packet: DnsPacket, rinfo: { address: string; port: number }) => void
  error: (err: Error) => void
  ready: () => void
}

export interface MdnsOptions {
  /** Bind to a specific interface address (default: all interfaces) */
  interface?: string
  /** Port override for testing (default: 5353) */
  port?: number
  /** Multicast address override for testing */
  multicastAddr?: string
  /** Whether to enable multicast loopback (default: true) */
  loopback?: boolean
  /** Reuse address (default: true) */
  reuseAddr?: boolean
}

/**
 * Low-level mDNS socket manager.
 *
 * Handles UDP multicast socket creation, multicast group membership,
 * packet send/receive, and cleanup.
 */
export class MdnsResponder extends EventEmitter {
  private socket: Socket | null = null
  private readonly port: number
  private readonly multicastAddr: string
  private readonly loopback: boolean
  private readonly reuseAddr: boolean
  private readonly bindInterface?: string
  private destroyed = false

  constructor(options: MdnsOptions = {}) {
    super()
    this.port = options.port ?? MDNS_PORT
    this.multicastAddr = options.multicastAddr ?? MDNS_MULTICAST_ADDR
    this.loopback = options.loopback ?? true
    this.reuseAddr = options.reuseAddr ?? true
    this.bindInterface = options.interface
  }

  /**
   * Start the mDNS responder — bind the UDP socket and join multicast group.
   */
  async start(): Promise<void> {
    if (this.socket) return

    return new Promise<void>((resolve, reject) => {
      const socket = createSocket({
        type: 'udp4',
        reuseAddr: this.reuseAddr,
      })

      socket.on('error', (err) => {
        if (!this.socket) {
          reject(err)
          return
        }
        this.emit('error', err)
      })

      socket.on('message', (msg, rinfo) => {
        try {
          const packet = decodePacket(msg)
          this.emit('packet', packet, {
            address: rinfo.address,
            port: rinfo.port,
          })
        } catch {
          // Ignore malformed packets
        }
      })

      socket.bind({ port: this.port, address: '0.0.0.0' }, () => {
        try {
          socket.setMulticastTTL(255) // RFC 6762 Section 11
          socket.setMulticastLoopback(this.loopback)

          // Join multicast group on all available IPv4 interfaces
          const interfaces = this.getIPv4Interfaces()
          for (const iface of interfaces) {
            try {
              socket.addMembership(this.multicastAddr, iface)
            } catch {
              // Interface may not support multicast — skip silently
            }
          }

          this.socket = socket
          this.emit('ready')
          resolve()
        } catch (err) {
          socket.close()
          reject(err)
        }
      })
    })
  }

  /**
   * Send a DNS packet via multicast.
   */
  async send(packet: DnsPacket): Promise<void> {
    if (!this.socket || this.destroyed) {
      throw new Error('mDNS responder not started')
    }

    const buf = encodePacket(packet)

    return new Promise<void>((resolve, reject) => {
      this.socket!.send(buf, 0, buf.length, this.port, this.multicastAddr, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Send a DNS packet to a specific unicast address.
   */
  async sendTo(
    packet: DnsPacket,
    address: string,
    port: number,
  ): Promise<void> {
    if (!this.socket || this.destroyed) {
      throw new Error('mDNS responder not started')
    }

    const buf = encodePacket(packet)

    return new Promise<void>((resolve, reject) => {
      this.socket!.send(buf, 0, buf.length, port, address, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Stop the mDNS responder — leave multicast group and close socket.
   */
  async stop(): Promise<void> {
    if (!this.socket || this.destroyed) return
    this.destroyed = true

    const socket = this.socket
    this.socket = null

    // Try to drop multicast membership
    const interfaces = this.getIPv4Interfaces()
    for (const iface of interfaces) {
      try {
        socket.dropMembership(this.multicastAddr, iface)
      } catch {
        // Ignore — socket may already be closing
      }
    }

    return new Promise<void>((resolve) => {
      socket.close(() => resolve())
    })
  }

  /** Whether the responder is currently active */
  get isActive(): boolean {
    return this.socket !== null && !this.destroyed
  }

  /**
   * Get all IPv4 interface addresses suitable for multicast.
   */
  private getIPv4Interfaces(): string[] {
    if (this.bindInterface) return [this.bindInterface]

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

    // Always include loopback for local testing
    addresses.push('127.0.0.1')

    return [...new Set(addresses)]
  }
}
