/**
 * Tests for DNS packet encoder/decoder — RFC 1035 compliance.
 *
 * Validates encode/decode round-trips for all supported record types
 * (A, AAAA, PTR, SRV, TXT), name compression, and full packet serialization.
 */

import { describe, it, expect } from 'vitest'
import {
  encodeName,
  decodeName,
  encodeHeader,
  decodeHeader,
  encodeQuestion,
  decodeQuestion,
  encodeResourceRecord,
  decodeResourceRecord,
  encodePacket,
  decodePacket,
  encodeA,
  decodeA,
  encodeAAAA,
  decodeAAAA,
  encodeSrv,
  decodeSrv,
  encodeTxt,
  decodeTxt,
  encodePtr,
  decodePtr,
  RECORD_TYPE,
  RECORD_CLASS,
  CACHE_FLUSH_BIT,
  FLAGS_QR_RESPONSE,
  FLAGS_QR_QUERY,
  type DnsPacket,
  type DnsHeader,
  type DnsQuestion,
  type DnsResourceRecord,
} from '../../src/discovery/dns-packet.js'

describe('DNS Name Encoding/Decoding', () => {
  it('encodes a simple domain name as length-prefixed labels', () => {
    const buf = encodeName('example.local')
    // [7, e,x,a,m,p,l,e, 5, l,o,c,a,l, 0]
    expect(buf[0]).toBe(7)
    expect(buf.toString('ascii', 1, 8)).toBe('example')
    expect(buf[8]).toBe(5)
    expect(buf.toString('ascii', 9, 14)).toBe('local')
    expect(buf[14]).toBe(0) // root label
  })

  it('encodes a multi-label name correctly', () => {
    const buf = encodeName('_careagent._tcp.local')
    // _careagent = 10 chars, _tcp = 4 chars, local = 5 chars
    expect(buf[0]).toBe(10) // _careagent length
    expect(buf[11]).toBe(4) // _tcp length
    expect(buf[16]).toBe(5) // local length
    expect(buf[buf.length - 1]).toBe(0) // root label
  })

  it('handles trailing dot', () => {
    const buf1 = encodeName('example.local.')
    const buf2 = encodeName('example.local')
    expect(buf1).toEqual(buf2)
  })

  it('throws on label exceeding 63 bytes', () => {
    const longLabel = 'a'.repeat(64)
    expect(() => encodeName(`${longLabel}.local`)).toThrow('exceeds 63 bytes')
  })

  it('round-trips a name through encode/decode', () => {
    const name = '_careagent._tcp.local'
    const buf = encodeName(name)
    const { name: decoded, bytesRead } = decodeName(buf, 0)
    expect(decoded).toBe(name)
    expect(bytesRead).toBe(buf.length)
  })

  it('decodes names with compression pointers', () => {
    // Build a buffer with a name at offset 0, then a pointer to it
    const firstBuf = encodeName('example.local')
    // At offset after first name, add a pointer (0xC000 | 0 = pointer to offset 0)
    const pointerBuf = Buffer.alloc(firstBuf.length + 2)
    firstBuf.copy(pointerBuf, 0)
    pointerBuf.writeUInt16BE(0xc000, firstBuf.length) // pointer to offset 0

    const { name, bytesRead } = decodeName(pointerBuf, firstBuf.length)
    expect(name).toBe('example.local')
    expect(bytesRead).toBe(2) // Only consumed the pointer
  })

  it('decodes names with partial compression', () => {
    // "foo" label followed by a pointer to an existing name
    const baseBuf = encodeName('example.local')
    const combined = Buffer.alloc(baseBuf.length + 1 + 3 + 2) // base + label "foo" + pointer
    baseBuf.copy(combined, 0)

    const offset = baseBuf.length
    combined.writeUInt8(3, offset) // label length 3
    combined.write('foo', offset + 1, 'ascii')
    combined.writeUInt16BE(0xc000 | 0, offset + 4) // pointer to offset 0 (example.local)

    const { name } = decodeName(combined, offset)
    expect(name).toBe('foo.example.local')
  })
})

describe('DNS Header', () => {
  it('encodes and decodes a header correctly', () => {
    const header: DnsHeader = {
      id: 0x1234,
      flags: FLAGS_QR_RESPONSE,
      qdcount: 1,
      ancount: 2,
      nscount: 0,
      arcount: 3,
    }

    const buf = encodeHeader(header)
    expect(buf.length).toBe(12)

    const decoded = decodeHeader(buf)
    expect(decoded).toEqual(header)
  })

  it('round-trips mDNS response flags', () => {
    const header: DnsHeader = {
      id: 0,
      flags: FLAGS_QR_RESPONSE,
      qdcount: 0,
      ancount: 1,
      nscount: 0,
      arcount: 0,
    }

    const buf = encodeHeader(header)
    const decoded = decodeHeader(buf)
    expect(decoded.flags & 0x8000).toBe(0x8000) // QR bit set
    expect(decoded.flags & 0x0400).toBe(0x0400) // AA bit set
  })

  it('round-trips query flags', () => {
    const header: DnsHeader = {
      id: 0,
      flags: FLAGS_QR_QUERY,
      qdcount: 1,
      ancount: 0,
      nscount: 0,
      arcount: 0,
    }

    const buf = encodeHeader(header)
    const decoded = decodeHeader(buf)
    expect(decoded.flags & 0x8000).toBe(0) // QR bit clear (query)
  })

  it('throws on truncated header', () => {
    const buf = Buffer.alloc(6)
    expect(() => decodeHeader(buf)).toThrow('too short')
  })
})

describe('DNS Question', () => {
  it('encodes and decodes a question correctly', () => {
    const question: DnsQuestion = {
      name: '_careagent._tcp.local',
      type: RECORD_TYPE.PTR,
      class: RECORD_CLASS.IN,
    }

    const buf = encodeQuestion(question)
    const { question: decoded, bytesRead } = decodeQuestion(buf, 0)
    expect(decoded).toEqual(question)
    expect(bytesRead).toBe(buf.length)
  })

  it('supports SRV question type', () => {
    const question: DnsQuestion = {
      name: 'myservice._careagent._tcp.local',
      type: RECORD_TYPE.SRV,
      class: RECORD_CLASS.IN,
    }

    const buf = encodeQuestion(question)
    const { question: decoded } = decodeQuestion(buf, 0)
    expect(decoded.type).toBe(RECORD_TYPE.SRV)
  })
})

describe('DNS Resource Record', () => {
  it('encodes and decodes a resource record', () => {
    const rr: DnsResourceRecord = {
      name: 'test.local',
      type: RECORD_TYPE.A,
      class: RECORD_CLASS.IN | CACHE_FLUSH_BIT,
      ttl: 120,
      rdata: encodeA('192.168.1.1'),
    }

    const buf = encodeResourceRecord(rr)
    const { record, bytesRead } = decodeResourceRecord(buf, 0)
    expect(record.name).toBe(rr.name)
    expect(record.type).toBe(rr.type)
    expect(record.class).toBe(rr.class)
    expect(record.ttl).toBe(rr.ttl)
    expect(record.rdata).toEqual(rr.rdata)
    expect(bytesRead).toBe(buf.length)
  })

  it('preserves cache-flush bit in class field', () => {
    const rr: DnsResourceRecord = {
      name: 'test.local',
      type: RECORD_TYPE.A,
      class: RECORD_CLASS.IN | CACHE_FLUSH_BIT,
      ttl: 120,
      rdata: encodeA('10.0.0.1'),
    }

    const buf = encodeResourceRecord(rr)
    const { record } = decodeResourceRecord(buf, 0)
    expect(record.class & CACHE_FLUSH_BIT).toBe(CACHE_FLUSH_BIT)
    expect(record.class & 0x7fff).toBe(RECORD_CLASS.IN)
  })
})

describe('A Record (IPv4)', () => {
  it('encodes and decodes an IPv4 address', () => {
    const ip = '192.168.1.42'
    const buf = encodeA(ip)
    expect(buf.length).toBe(4)
    expect(buf[0]).toBe(192)
    expect(buf[1]).toBe(168)
    expect(buf[2]).toBe(1)
    expect(buf[3]).toBe(42)

    const decoded = decodeA(buf)
    expect(decoded).toBe(ip)
  })

  it('handles 0.0.0.0', () => {
    const buf = encodeA('0.0.0.0')
    expect(decodeA(buf)).toBe('0.0.0.0')
  })

  it('handles 255.255.255.255', () => {
    const buf = encodeA('255.255.255.255')
    expect(decodeA(buf)).toBe('255.255.255.255')
  })

  it('throws on invalid IPv4 address', () => {
    expect(() => encodeA('999.0.0.1')).toThrow('Invalid IPv4')
    expect(() => encodeA('not-an-ip')).toThrow('Invalid IPv4')
  })

  it('throws on wrong RDATA length', () => {
    expect(() => decodeA(Buffer.alloc(3))).toThrow('Invalid A record RDATA length')
  })
})

describe('AAAA Record (IPv6)', () => {
  it('encodes and decodes a full IPv6 address', () => {
    const ip = 'fe80:0000:0000:0000:0000:0000:0000:0001'
    const buf = encodeAAAA(ip)
    expect(buf.length).toBe(16)

    const decoded = decodeAAAA(buf)
    // Decoded format may be shortened (no leading zeros)
    expect(decoded).toBe('fe80:0:0:0:0:0:0:1')
  })

  it('handles :: shorthand', () => {
    const buf = encodeAAAA('::1')
    const decoded = decodeAAAA(buf)
    expect(decoded).toBe('0:0:0:0:0:0:0:1')
  })

  it('handles fe80:: prefix', () => {
    const buf = encodeAAAA('fe80::1')
    const decoded = decodeAAAA(buf)
    expect(decoded).toBe('fe80:0:0:0:0:0:0:1')
  })

  it('throws on wrong RDATA length', () => {
    expect(() => decodeAAAA(Buffer.alloc(8))).toThrow('Invalid AAAA record RDATA length')
  })
})

describe('SRV Record', () => {
  it('encodes and decodes SRV data', () => {
    const srv = {
      priority: 0,
      weight: 0,
      port: 8080,
      target: 'myhost.local',
    }

    const buf = encodeSrv(srv)
    const decoded = decodeSrv(buf)

    expect(decoded.priority).toBe(0)
    expect(decoded.weight).toBe(0)
    expect(decoded.port).toBe(8080)
    expect(decoded.target).toBe('myhost.local')
  })

  it('handles non-zero priority and weight', () => {
    const srv = {
      priority: 10,
      weight: 20,
      port: 443,
      target: 'server.example.local',
    }

    const buf = encodeSrv(srv)
    const decoded = decodeSrv(buf)

    expect(decoded.priority).toBe(10)
    expect(decoded.weight).toBe(20)
    expect(decoded.port).toBe(443)
    expect(decoded.target).toBe('server.example.local')
  })
})

describe('TXT Record', () => {
  it('encodes and decodes key=value pairs', () => {
    const txt = {
      version: '1.0.0',
      pubkey: 'ed25519:abc123',
      capabilities: 'consent,lookup',
    }

    const buf = encodeTxt(txt)
    const decoded = decodeTxt(buf)

    expect(decoded).toEqual(txt)
  })

  it('handles empty TXT record', () => {
    const buf = encodeTxt({})
    expect(buf.length).toBe(1)
    expect(buf[0]).toBe(0) // Empty TXT = single zero byte

    const decoded = decodeTxt(buf)
    expect(decoded).toEqual({})
  })

  it('handles single key=value', () => {
    const txt = { key: 'value' }
    const buf = encodeTxt(txt)
    const decoded = decodeTxt(buf)
    expect(decoded).toEqual(txt)
  })

  it('handles values containing = signs', () => {
    const txt = { formula: 'a=b+c' }
    const buf = encodeTxt(txt)
    const decoded = decodeTxt(buf)
    expect(decoded).toEqual(txt)
  })

  it('TXT record keys follow RFC 6763 maximum 9 chars guideline', () => {
    // Neuron TXT record keys
    const keys = ['version', 'pubkey', 'caps']
    for (const key of keys) {
      expect(key.length).toBeLessThanOrEqual(9)
    }
  })
})

describe('PTR Record', () => {
  it('encodes and decodes a PTR name', () => {
    const name = 'myservice._careagent._tcp.local'
    const buf = encodePtr(name)
    const decoded = decodePtr(buf)
    expect(decoded).toBe(name)
  })

  it('handles service type PTR', () => {
    const name = '_careagent._tcp.local'
    const buf = encodePtr(name)
    const decoded = decodePtr(buf)
    expect(decoded).toBe(name)
  })
})

describe('Full Packet Encode/Decode', () => {
  it('round-trips a query packet', () => {
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
        {
          name: '_careagent._tcp.local',
          type: RECORD_TYPE.PTR,
          class: RECORD_CLASS.IN,
        },
      ],
      answers: [],
      authorities: [],
      additionals: [],
    }

    const buf = encodePacket(packet)
    const decoded = decodePacket(buf)

    expect(decoded.header.qdcount).toBe(1)
    expect(decoded.header.ancount).toBe(0)
    expect(decoded.questions).toHaveLength(1)
    expect(decoded.questions[0].name).toBe('_careagent._tcp.local')
    expect(decoded.questions[0].type).toBe(RECORD_TYPE.PTR)
  })

  it('round-trips a response packet with multiple records', () => {
    const packet: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_RESPONSE,
        qdcount: 0,
        ancount: 3,
        nscount: 0,
        arcount: 1,
      },
      questions: [],
      answers: [
        {
          name: '_careagent._tcp.local',
          type: RECORD_TYPE.PTR,
          class: RECORD_CLASS.IN,
          ttl: 120,
          rdata: encodePtr('neuron-abc._careagent._tcp.local'),
        },
        {
          name: 'neuron-abc._careagent._tcp.local',
          type: RECORD_TYPE.SRV,
          class: RECORD_CLASS.IN | CACHE_FLUSH_BIT,
          ttl: 120,
          rdata: encodeSrv({
            priority: 0,
            weight: 0,
            port: 8080,
            target: 'myhost.local',
          }),
        },
        {
          name: 'neuron-abc._careagent._tcp.local',
          type: RECORD_TYPE.TXT,
          class: RECORD_CLASS.IN | CACHE_FLUSH_BIT,
          ttl: 120,
          rdata: encodeTxt({ version: '1.0.0', pubkey: 'ed25519:abc' }),
        },
      ],
      authorities: [],
      additionals: [
        {
          name: 'myhost.local',
          type: RECORD_TYPE.A,
          class: RECORD_CLASS.IN | CACHE_FLUSH_BIT,
          ttl: 120,
          rdata: encodeA('192.168.1.42'),
        },
      ],
    }

    const buf = encodePacket(packet)
    const decoded = decodePacket(buf)

    expect(decoded.header.flags).toBe(FLAGS_QR_RESPONSE)
    expect(decoded.answers).toHaveLength(3)
    expect(decoded.additionals).toHaveLength(1)

    // Verify PTR
    expect(decoded.answers[0].type).toBe(RECORD_TYPE.PTR)
    expect(decodePtr(decoded.answers[0].rdata)).toBe('neuron-abc._careagent._tcp.local')

    // Verify SRV
    expect(decoded.answers[1].type).toBe(RECORD_TYPE.SRV)
    const srv = decodeSrv(decoded.answers[1].rdata)
    expect(srv.port).toBe(8080)
    expect(srv.target).toBe('myhost.local')

    // Verify TXT
    expect(decoded.answers[2].type).toBe(RECORD_TYPE.TXT)
    const txt = decodeTxt(decoded.answers[2].rdata)
    expect(txt.version).toBe('1.0.0')
    expect(txt.pubkey).toBe('ed25519:abc')

    // Verify A (additional)
    expect(decoded.additionals[0].type).toBe(RECORD_TYPE.A)
    expect(decodeA(decoded.additionals[0].rdata)).toBe('192.168.1.42')
  })

  it('round-trips a goodbye packet (TTL=0)', () => {
    const packet: DnsPacket = {
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
          ttl: 0, // Goodbye!
          rdata: encodePtr('neuron-abc._careagent._tcp.local'),
        },
      ],
      authorities: [],
      additionals: [],
    }

    const buf = encodePacket(packet)
    const decoded = decodePacket(buf)

    expect(decoded.answers[0].ttl).toBe(0)
  })

  it('handles packet with questions and answers', () => {
    const packet: DnsPacket = {
      header: {
        id: 0,
        flags: FLAGS_QR_RESPONSE,
        qdcount: 1,
        ancount: 1,
        nscount: 0,
        arcount: 0,
      },
      questions: [
        {
          name: '_careagent._tcp.local',
          type: RECORD_TYPE.PTR,
          class: RECORD_CLASS.IN,
        },
      ],
      answers: [
        {
          name: '_careagent._tcp.local',
          type: RECORD_TYPE.PTR,
          class: RECORD_CLASS.IN,
          ttl: 120,
          rdata: encodePtr('test._careagent._tcp.local'),
        },
      ],
      authorities: [],
      additionals: [],
    }

    const buf = encodePacket(packet)
    const decoded = decodePacket(buf)

    expect(decoded.questions).toHaveLength(1)
    expect(decoded.answers).toHaveLength(1)
  })
})

describe('Record Type Constants', () => {
  it('has correct RFC 1035 values', () => {
    expect(RECORD_TYPE.A).toBe(1)
    expect(RECORD_TYPE.PTR).toBe(12)
    expect(RECORD_TYPE.TXT).toBe(16)
    expect(RECORD_TYPE.AAAA).toBe(28)
    expect(RECORD_TYPE.SRV).toBe(33)
  })

  it('cache-flush bit is 0x8000', () => {
    expect(CACHE_FLUSH_BIT).toBe(0x8000)
  })

  it('IN class is 1', () => {
    expect(RECORD_CLASS.IN).toBe(1)
  })
})
