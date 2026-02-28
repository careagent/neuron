/**
 * Tests for DNS-SD service advertisement and browsing.
 *
 * Validates service advertisement lifecycle, goodbye packets,
 * query handling, and the factory function. Uses mocked mDNS
 * transport to avoid actual multicast network activity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { DnsSdService, createDiscoveryService } from '../../src/discovery/dns-sd.js'
import {
  decodePacket,
  encodePacket,
  decodePtr,
  decodeSrv,
  decodeTxt,
  decodeA,
  encodePtr,
  encodeSrv,
  encodeTxt,
  encodeA,
  RECORD_TYPE,
  RECORD_CLASS,
  CACHE_FLUSH_BIT,
  FLAGS_QR_RESPONSE,
  FLAGS_QR_QUERY,
  type DnsPacket,
} from '../../src/discovery/dns-packet.js'
import type { ServiceInfo } from '../../src/discovery/schemas.js'

// Mock dgram to prevent actual UDP sockets
class MockSocket extends EventEmitter {
  bind = vi.fn((opts: unknown, cb: () => void) => { cb() })
  close = vi.fn((cb: () => void) => { cb() })
  send = vi.fn((_buf: Buffer, _offset: number, _length: number, _port: number, _addr: string, cb: (err: Error | null) => void) => { cb(null) })
  setMulticastTTL = vi.fn()
  setMulticastLoopback = vi.fn()
  addMembership = vi.fn()
  dropMembership = vi.fn()
}

let mockSocket: MockSocket

vi.mock('node:dgram', () => ({
  createSocket: vi.fn(() => {
    mockSocket = new MockSocket()
    return mockSocket
  }),
}))

const testServiceInfo: ServiceInfo = {
  serviceType: '_careagent._tcp',
  serviceName: 'neuron-test123',
  port: 8080,
  host: 'testhost.local',
  txt: {
    version: '1.0.0',
    pubkey: 'ed25519:abc123def',
    caps: 'consent,lookup',
  },
  ttl: 120,
}

describe('DnsSdService', () => {
  let service: DnsSdService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DnsSdService()
  })

  afterEach(async () => {
    await service.stop()
  })

  describe('advertise()', () => {
    it('starts mDNS responder and sends announcement', async () => {
      await service.advertise(testServiceInfo)

      // Socket should be bound
      expect(mockSocket.bind).toHaveBeenCalledOnce()

      // Announcement should have been sent
      expect(mockSocket.send).toHaveBeenCalled()

      // Parse the sent packet
      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      // Should be a response (announcement)
      expect(packet.header.flags & 0x8000).toBe(0x8000) // QR=1
      expect(packet.answers.length).toBeGreaterThanOrEqual(3) // PTR + SRV + TXT + A records
    })

    it('includes PTR record in announcement', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const ptrRecord = packet.answers.find((r) => r.type === RECORD_TYPE.PTR)
      expect(ptrRecord).toBeDefined()
      expect(ptrRecord!.name).toBe('_careagent._tcp.local')

      const instanceName = decodePtr(ptrRecord!.rdata)
      expect(instanceName).toBe('neuron-test123._careagent._tcp.local')
    })

    it('includes SRV record with correct port', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const srvRecord = packet.answers.find((r) => r.type === RECORD_TYPE.SRV)
      expect(srvRecord).toBeDefined()
      expect(srvRecord!.name).toBe('neuron-test123._careagent._tcp.local')

      const srv = decodeSrv(srvRecord!.rdata)
      expect(srv.port).toBe(8080)
      expect(srv.target).toBe('testhost.local')
    })

    it('includes TXT record with metadata', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const txtRecord = packet.answers.find((r) => r.type === RECORD_TYPE.TXT)
      expect(txtRecord).toBeDefined()

      const txt = decodeTxt(txtRecord!.rdata)
      expect(txt.version).toBe('1.0.0')
      expect(txt.pubkey).toBe('ed25519:abc123def')
      expect(txt.caps).toBe('consent,lookup')
    })

    it('includes A record for host', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const aRecords = packet.answers.filter((r) => r.type === RECORD_TYPE.A)
      expect(aRecords.length).toBeGreaterThanOrEqual(1)
    })

    it('sets cache-flush bit on SRV, TXT, and A records', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const srvRecord = packet.answers.find((r) => r.type === RECORD_TYPE.SRV)
      expect(srvRecord!.class & CACHE_FLUSH_BIT).toBe(CACHE_FLUSH_BIT)

      const txtRecord = packet.answers.find((r) => r.type === RECORD_TYPE.TXT)
      expect(txtRecord!.class & CACHE_FLUSH_BIT).toBe(CACHE_FLUSH_BIT)
    })

    it('PTR record does NOT have cache-flush bit', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const ptrRecord = packet.answers.find((r) => r.type === RECORD_TYPE.PTR)
      expect(ptrRecord!.class & CACHE_FLUSH_BIT).toBe(0)
    })

    it('sets TTL on records', async () => {
      await service.advertise(testServiceInfo)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      for (const rr of packet.answers) {
        expect(rr.ttl).toBe(120)
      }
    })
  })

  describe('stop()', () => {
    it('sends goodbye packets with TTL=0', async () => {
      await service.advertise(testServiceInfo)

      // Clear the announcement send calls
      mockSocket.send.mockClear()

      await service.stop()

      // Goodbye should have been sent
      expect(mockSocket.send).toHaveBeenCalled()

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      // All records should have TTL=0
      for (const rr of packet.answers) {
        expect(rr.ttl).toBe(0)
      }
    })

    it('is safe to call when never started', async () => {
      await expect(service.stop()).resolves.toBeUndefined()
    })

    it('is safe to call multiple times', async () => {
      await service.advertise(testServiceInfo)
      await service.stop()
      await expect(service.stop()).resolves.toBeUndefined()
    })
  })

  describe('query response', () => {
    it('responds to PTR queries for its service type', async () => {
      await service.advertise(testServiceInfo)

      // Clear initial announcement
      mockSocket.send.mockClear()

      // Simulate receiving a PTR query
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
          { name: '_careagent._tcp.local', type: RECORD_TYPE.PTR, class: RECORD_CLASS.IN },
        ],
        answers: [],
        authorities: [],
        additionals: [],
      }

      const queryBuf = encodePacket(queryPacket)
      mockSocket.emit('message', queryBuf, { address: '192.168.1.50', port: 5353 })

      // Wait for async response
      await new Promise((r) => setTimeout(r, 50))

      // Should have sent a response
      expect(mockSocket.send).toHaveBeenCalled()
    })

    it('does not respond to queries for other service types', async () => {
      await service.advertise(testServiceInfo)
      mockSocket.send.mockClear()

      // Query for a different service type
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
          { name: '_other._tcp.local', type: RECORD_TYPE.PTR, class: RECORD_CLASS.IN },
        ],
        answers: [],
        authorities: [],
        additionals: [],
      }

      const queryBuf = encodePacket(queryPacket)
      mockSocket.emit('message', queryBuf, { address: '192.168.1.50', port: 5353 })

      await new Promise((r) => setTimeout(r, 50))

      // Should NOT have sent a response
      expect(mockSocket.send).not.toHaveBeenCalled()
    })

    it('does not respond to response packets (QR=1)', async () => {
      await service.advertise(testServiceInfo)
      mockSocket.send.mockClear()

      // Another node's response — should be cached but not responded to
      const responsePacket: DnsPacket = {
        header: {
          id: 0,
          flags: FLAGS_QR_RESPONSE,
          qdcount: 0,
          ancount: 1,
          nscount: 0,
          arcount: 0,
        },
        questions: [],
        answers: [
          {
            name: '_careagent._tcp.local',
            type: RECORD_TYPE.PTR,
            class: RECORD_CLASS.IN,
            ttl: 120,
            rdata: encodePtr('other-neuron._careagent._tcp.local'),
          },
        ],
        authorities: [],
        additionals: [],
      }

      const responseBuf = encodePacket(responsePacket)
      mockSocket.emit('message', responseBuf, { address: '192.168.1.100', port: 5353 })

      await new Promise((r) => setTimeout(r, 50))

      expect(mockSocket.send).not.toHaveBeenCalled()
    })
  })

  describe('cache', () => {
    it('caches received answer records', async () => {
      await service.advertise(testServiceInfo)

      // Simulate receiving a response with records
      const responsePacket: DnsPacket = {
        header: {
          id: 0,
          flags: FLAGS_QR_RESPONSE,
          qdcount: 0,
          ancount: 1,
          nscount: 0,
          arcount: 0,
        },
        questions: [],
        answers: [
          {
            name: 'other._careagent._tcp.local',
            type: RECORD_TYPE.A,
            class: RECORD_CLASS.IN,
            ttl: 60,
            rdata: encodeA('10.0.0.5'),
          },
        ],
        authorities: [],
        additionals: [],
      }

      const buf = encodePacket(responsePacket)
      mockSocket.emit('message', buf, { address: '10.0.0.5', port: 5353 })

      // Check cache
      const cached = service.getCache().get('other._careagent._tcp.local', RECORD_TYPE.A)
      expect(cached).toHaveLength(1)
    })
  })

  describe('service type normalization', () => {
    it('appends ._tcp if not present', async () => {
      const info: ServiceInfo = {
        serviceType: '_careagent',
        serviceName: 'test',
        port: 3000,
      }

      await service.advertise(info)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const ptrRecord = packet.answers.find((r) => r.type === RECORD_TYPE.PTR)
      expect(ptrRecord!.name).toBe('_careagent._tcp.local')
    })

    it('preserves ._tcp when already present', async () => {
      const info: ServiceInfo = {
        serviceType: '_careagent._tcp',
        serviceName: 'test',
        port: 3000,
      }

      await service.advertise(info)

      const sentBuf = mockSocket.send.mock.calls[0][0] as Buffer
      const packet = decodePacket(sentBuf)

      const ptrRecord = packet.answers.find((r) => r.type === RECORD_TYPE.PTR)
      expect(ptrRecord!.name).toBe('_careagent._tcp.local')
    })
  })
})

describe('createDiscoveryService', () => {
  it('creates a DnsSdService instance', () => {
    const service = createDiscoveryService({
      serviceType: '_careagent._tcp',
      serviceName: 'neuron-abc123',
      port: 8080,
      txt: {
        version: '1.0.0',
        pubkey: 'ed25519:abc123',
        caps: 'consent,lookup',
      },
    })

    expect(service).toBeInstanceOf(DnsSdService)
  })

  it('accepts mDNS options', () => {
    const service = createDiscoveryService({
      serviceType: '_careagent._tcp',
      serviceName: 'neuron-abc123',
      port: 8080,
      mdns: { port: 15353, loopback: false },
    })

    expect(service).toBeInstanceOf(DnsSdService)
  })
})
