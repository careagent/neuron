/**
 * Tests for mDNS responder — multicast UDP socket management.
 *
 * Uses mocked dgram sockets for unit tests to avoid actual multicast
 * network activity. Tests socket lifecycle, multicast group membership,
 * packet send/receive, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { MdnsResponder, MDNS_MULTICAST_ADDR, MDNS_PORT } from '../../src/discovery/mdns.js'
import {
  encodePacket,
  FLAGS_QR_QUERY,
  RECORD_TYPE,
  RECORD_CLASS,
  type DnsPacket,
} from '../../src/discovery/dns-packet.js'

// Mock dgram to avoid actual network operations in unit tests
class MockSocket extends EventEmitter {
  bind = vi.fn((opts: unknown, cb: () => void) => { cb() })
  close = vi.fn((cb: () => void) => { cb() })
  send = vi.fn((_buf: Buffer, _offset: number, _length: number, _port: number, _addr: string, cb: (err: Error | null) => void) => { cb(null) })
  setMulticastTTL = vi.fn()
  setMulticastLoopback = vi.fn()
  addMembership = vi.fn()
  dropMembership = vi.fn()
}

vi.mock('node:dgram', () => ({
  createSocket: vi.fn(() => new MockSocket()),
}))

describe('MdnsResponder', () => {
  let mockSocket: MockSocket

  beforeEach(async () => {
    vi.clearAllMocks()
    const dgram = await import('node:dgram')
    mockSocket = new MockSocket()
    vi.mocked(dgram.createSocket).mockReturnValue(mockSocket as never)
  })

  describe('constructor', () => {
    it('uses default port and multicast address', () => {
      const responder = new MdnsResponder()
      expect(responder.isActive).toBe(false)
    })

    it('accepts custom port and multicast address', () => {
      const responder = new MdnsResponder({
        port: 15353,
        multicastAddr: '239.0.0.1',
      })
      expect(responder.isActive).toBe(false)
    })
  })

  describe('start()', () => {
    it('creates socket and joins multicast group', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      expect(mockSocket.bind).toHaveBeenCalledOnce()
      expect(mockSocket.setMulticastTTL).toHaveBeenCalledWith(255)
      expect(mockSocket.setMulticastLoopback).toHaveBeenCalledWith(true)
      expect(mockSocket.addMembership).toHaveBeenCalled()
      expect(responder.isActive).toBe(true)

      await responder.stop()
    })

    it('is idempotent — second start is a no-op', async () => {
      const responder = new MdnsResponder()
      await responder.start()
      await responder.start() // Should not throw

      expect(mockSocket.bind).toHaveBeenCalledOnce()

      await responder.stop()
    })

    it('joins multicast on loopback interface', async () => {
      const responder = new MdnsResponder({ interface: '127.0.0.1' })
      await responder.start()

      expect(mockSocket.addMembership).toHaveBeenCalledWith(
        MDNS_MULTICAST_ADDR,
        '127.0.0.1',
      )

      await responder.stop()
    })

    it('emits ready event after binding', async () => {
      const responder = new MdnsResponder()
      const readyPromise = new Promise<void>((resolve) => {
        responder.on('ready', resolve)
      })

      await responder.start()
      await readyPromise

      await responder.stop()
    })
  })

  describe('send()', () => {
    it('encodes and sends a DNS packet via multicast', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      const packet: DnsPacket = {
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

      await responder.send(packet)

      expect(mockSocket.send).toHaveBeenCalledOnce()
      const [buf, offset, length, port, addr] = mockSocket.send.mock.calls[0]
      expect(buf).toBeInstanceOf(Buffer)
      expect(offset).toBe(0)
      expect(port).toBe(MDNS_PORT)
      expect(addr).toBe(MDNS_MULTICAST_ADDR)

      await responder.stop()
    })

    it('throws if responder is not started', async () => {
      const responder = new MdnsResponder()
      const packet: DnsPacket = {
        header: { id: 0, flags: 0, qdcount: 0, ancount: 0, nscount: 0, arcount: 0 },
        questions: [],
        answers: [],
        authorities: [],
        additionals: [],
      }

      await expect(responder.send(packet)).rejects.toThrow('not started')
    })
  })

  describe('sendTo()', () => {
    it('sends to a specific unicast address', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      const packet: DnsPacket = {
        header: { id: 0, flags: 0, qdcount: 0, ancount: 0, nscount: 0, arcount: 0 },
        questions: [],
        answers: [],
        authorities: [],
        additionals: [],
      }

      await responder.sendTo(packet, '192.168.1.100', 5353)

      const [, , , port, addr] = mockSocket.send.mock.calls[0]
      expect(port).toBe(5353)
      expect(addr).toBe('192.168.1.100')

      await responder.stop()
    })
  })

  describe('packet reception', () => {
    it('emits parsed packet events on incoming messages', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      const packetPromise = new Promise<{ packet: DnsPacket; rinfo: { address: string; port: number } }>((resolve) => {
        responder.on('packet', (packet, rinfo) => {
          resolve({ packet, rinfo })
        })
      })

      // Simulate receiving a valid DNS packet
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
          { name: 'test.local', type: RECORD_TYPE.A, class: RECORD_CLASS.IN },
        ],
        answers: [],
        authorities: [],
        additionals: [],
      }

      const buf = encodePacket(queryPacket)
      mockSocket.emit('message', buf, { address: '192.168.1.50', port: 5353 })

      const { packet, rinfo } = await packetPromise
      expect(packet.questions).toHaveLength(1)
      expect(packet.questions[0].name).toBe('test.local')
      expect(rinfo.address).toBe('192.168.1.50')

      await responder.stop()
    })

    it('ignores malformed packets silently', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      // Send garbage data — should not throw or emit packet
      const spy = vi.fn()
      responder.on('packet', spy)

      mockSocket.emit('message', Buffer.from([0x00, 0x01]), { address: '1.1.1.1', port: 5353 })

      // Wait a tick
      await new Promise((r) => setTimeout(r, 10))
      expect(spy).not.toHaveBeenCalled()

      await responder.stop()
    })
  })

  describe('stop()', () => {
    it('drops multicast membership and closes socket', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      await responder.stop()

      expect(mockSocket.dropMembership).toHaveBeenCalled()
      expect(mockSocket.close).toHaveBeenCalledOnce()
      expect(responder.isActive).toBe(false)
    })

    it('is safe when never started', async () => {
      const responder = new MdnsResponder()
      await responder.stop() // Should not throw
      expect(responder.isActive).toBe(false)
    })

    it('is safe to call multiple times', async () => {
      const responder = new MdnsResponder()
      await responder.start()

      await responder.stop()
      await responder.stop() // No-op

      expect(mockSocket.close).toHaveBeenCalledOnce()
    })
  })

  describe('multicast constants', () => {
    it('MDNS_MULTICAST_ADDR is 224.0.0.251', () => {
      expect(MDNS_MULTICAST_ADDR).toBe('224.0.0.251')
    })

    it('MDNS_PORT is 5353', () => {
      expect(MDNS_PORT).toBe(5353)
    })
  })
})
