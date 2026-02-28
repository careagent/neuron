/**
 * DNS Packet Encoder/Decoder — RFC 1035 compliant.
 *
 * Implements DNS packet serialization and deserialization for mDNS/DNS-SD.
 * Supports: A (1), AAAA (28), PTR (12), SRV (33), TXT (16) record types.
 * Includes DNS name compression (RFC 1035 Section 4.1.4) for encoding.
 */

/** DNS record types */
export const RECORD_TYPE = {
  A: 1,
  PTR: 12,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
} as const

export type RecordType = (typeof RECORD_TYPE)[keyof typeof RECORD_TYPE]

/** DNS class — IN (Internet) */
export const RECORD_CLASS = {
  IN: 1,
} as const

/** mDNS cache-flush bit (RFC 6762 Section 10.2) */
export const CACHE_FLUSH_BIT = 0x8000

/** DNS header flags */
export interface DnsHeader {
  id: number
  flags: number
  qdcount: number
  ancount: number
  nscount: number
  arcount: number
}

/** DNS question */
export interface DnsQuestion {
  name: string
  type: number
  class: number
}

/** DNS resource record */
export interface DnsResourceRecord {
  name: string
  type: number
  class: number
  ttl: number
  rdata: Buffer
}

/** Parsed SRV record data */
export interface SrvData {
  priority: number
  weight: number
  port: number
  target: string
}

/** Parsed TXT record data */
export type TxtData = Record<string, string>

/** Complete DNS packet */
export interface DnsPacket {
  header: DnsHeader
  questions: DnsQuestion[]
  answers: DnsResourceRecord[]
  authorities: DnsResourceRecord[]
  additionals: DnsResourceRecord[]
}

// ─── Name Encoding/Decoding ──────────────────────────────────────────────────

/**
 * Encode a DNS domain name as a sequence of length-prefixed labels.
 * Example: "example.local" → [7, 'e','x','a','m','p','l','e', 5, 'l','o','c','a','l', 0]
 */
export function encodeName(name: string): Buffer {
  const labels = name.replace(/\.$/, '').split('.')
  const parts: Buffer[] = []

  for (const label of labels) {
    if (label.length === 0) continue
    if (label.length > 63) {
      throw new Error(`DNS label exceeds 63 bytes: "${label}"`)
    }
    const labelBuf = Buffer.alloc(1 + label.length)
    labelBuf.writeUInt8(label.length, 0)
    labelBuf.write(label, 1, 'ascii')
    parts.push(labelBuf)
  }

  parts.push(Buffer.from([0])) // root label
  return Buffer.concat(parts)
}

/**
 * Decode a DNS domain name from a packet buffer, handling compression pointers.
 * Returns the decoded name and the number of bytes consumed from the current position.
 */
export function decodeName(
  buf: Buffer,
  offset: number,
): { name: string; bytesRead: number } {
  const labels: string[] = []
  let pos = offset
  let bytesRead = 0
  let jumped = false

  while (pos < buf.length) {
    const len = buf.readUInt8(pos)

    if (len === 0) {
      // End of name
      if (!jumped) bytesRead += 1
      break
    }

    // Check for compression pointer (top 2 bits set)
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) {
        throw new Error('DNS name compression pointer truncated')
      }
      const pointer = buf.readUInt16BE(pos) & 0x3fff
      if (!jumped) bytesRead += 2
      jumped = true
      pos = pointer
      continue
    }

    // Regular label
    if (pos + 1 + len > buf.length) {
      throw new Error('DNS label extends beyond packet')
    }

    labels.push(buf.toString('ascii', pos + 1, pos + 1 + len))

    if (!jumped) bytesRead += 1 + len
    pos += 1 + len
  }

  return { name: labels.join('.'), bytesRead }
}

// ─── Header Encoding/Decoding ────────────────────────────────────────────────

const HEADER_SIZE = 12

export function encodeHeader(header: DnsHeader): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE)
  buf.writeUInt16BE(header.id, 0)
  buf.writeUInt16BE(header.flags, 2)
  buf.writeUInt16BE(header.qdcount, 4)
  buf.writeUInt16BE(header.ancount, 6)
  buf.writeUInt16BE(header.nscount, 8)
  buf.writeUInt16BE(header.arcount, 10)
  return buf
}

export function decodeHeader(buf: Buffer): DnsHeader {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`DNS header too short: ${buf.length} bytes`)
  }
  return {
    id: buf.readUInt16BE(0),
    flags: buf.readUInt16BE(2),
    qdcount: buf.readUInt16BE(4),
    ancount: buf.readUInt16BE(6),
    nscount: buf.readUInt16BE(8),
    arcount: buf.readUInt16BE(10),
  }
}

// ─── Question Encoding/Decoding ──────────────────────────────────────────────

export function encodeQuestion(question: DnsQuestion): Buffer {
  const nameBuf = encodeName(question.name)
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(question.type, 0)
  tail.writeUInt16BE(question.class, 2)
  return Buffer.concat([nameBuf, tail])
}

export function decodeQuestion(
  buf: Buffer,
  offset: number,
): { question: DnsQuestion; bytesRead: number } {
  const { name, bytesRead: nameBytes } = decodeName(buf, offset)
  const pos = offset + nameBytes

  if (pos + 4 > buf.length) {
    throw new Error('DNS question truncated')
  }

  return {
    question: {
      name,
      type: buf.readUInt16BE(pos),
      class: buf.readUInt16BE(pos + 2),
    },
    bytesRead: nameBytes + 4,
  }
}

// ─── Resource Record Encoding/Decoding ───────────────────────────────────────

export function encodeResourceRecord(rr: DnsResourceRecord): Buffer {
  const nameBuf = encodeName(rr.name)
  const fixedBuf = Buffer.alloc(10)
  fixedBuf.writeUInt16BE(rr.type, 0)
  fixedBuf.writeUInt16BE(rr.class, 2)
  fixedBuf.writeUInt32BE(rr.ttl, 4)
  fixedBuf.writeUInt16BE(rr.rdata.length, 8)
  return Buffer.concat([nameBuf, fixedBuf, rr.rdata])
}

export function decodeResourceRecord(
  buf: Buffer,
  offset: number,
): { record: DnsResourceRecord; bytesRead: number } {
  const { name, bytesRead: nameBytes } = decodeName(buf, offset)
  let pos = offset + nameBytes

  if (pos + 10 > buf.length) {
    throw new Error('DNS resource record truncated')
  }

  const type = buf.readUInt16BE(pos)
  const cls = buf.readUInt16BE(pos + 2)
  const ttl = buf.readUInt32BE(pos + 4)
  const rdlength = buf.readUInt16BE(pos + 8)
  pos += 10

  if (pos + rdlength > buf.length) {
    throw new Error('DNS RDATA extends beyond packet')
  }

  const rdata = Buffer.from(buf.subarray(pos, pos + rdlength))

  return {
    record: { name, type, class: cls, ttl, rdata },
    bytesRead: nameBytes + 10 + rdlength,
  }
}

// ─── RDATA Helpers ───────────────────────────────────────────────────────────

/** Encode an IPv4 address to 4-byte buffer */
export function encodeA(ip: string): Buffer {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || isNaN(p))) {
    throw new Error(`Invalid IPv4 address: ${ip}`)
  }
  return Buffer.from(parts)
}

/** Decode a 4-byte buffer to an IPv4 address string */
export function decodeA(rdata: Buffer): string {
  if (rdata.length !== 4) {
    throw new Error(`Invalid A record RDATA length: ${rdata.length}`)
  }
  return `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`
}

/** Encode an IPv6 address to 16-byte buffer */
export function encodeAAAA(ip: string): Buffer {
  const expanded = expandIPv6(ip)
  const groups = expanded.split(':')
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 8; i++) {
    buf.writeUInt16BE(parseInt(groups[i], 16), i * 2)
  }
  return buf
}

/** Expand an IPv6 address to its full 8-group representation */
function expandIPv6(ip: string): string {
  // Handle :: expansion
  if (ip.includes('::')) {
    const [left, right] = ip.split('::')
    const leftGroups = left ? left.split(':') : []
    const rightGroups = right ? right.split(':') : []
    const missing = 8 - leftGroups.length - rightGroups.length
    const midGroups = Array(missing).fill('0000')
    const all = [...leftGroups, ...midGroups, ...rightGroups]
    return all.map((g) => g.padStart(4, '0')).join(':')
  }
  return ip
    .split(':')
    .map((g) => g.padStart(4, '0'))
    .join(':')
}

/** Decode a 16-byte buffer to an IPv6 address string */
export function decodeAAAA(rdata: Buffer): string {
  if (rdata.length !== 16) {
    throw new Error(`Invalid AAAA record RDATA length: ${rdata.length}`)
  }
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push(rdata.readUInt16BE(i).toString(16))
  }
  return groups.join(':')
}

/** Encode SRV record data */
export function encodeSrv(srv: SrvData): Buffer {
  const targetBuf = encodeName(srv.target)
  const buf = Buffer.alloc(6 + targetBuf.length)
  buf.writeUInt16BE(srv.priority, 0)
  buf.writeUInt16BE(srv.weight, 2)
  buf.writeUInt16BE(srv.port, 4)
  targetBuf.copy(buf, 6)
  return buf
}

/** Decode SRV record data from a resource record's rdata using the full packet buffer */
export function decodeSrv(rdata: Buffer, packetBuf?: Buffer, rdataOffset?: number): SrvData {
  if (rdata.length < 7) {
    throw new Error(`Invalid SRV RDATA length: ${rdata.length}`)
  }
  const priority = rdata.readUInt16BE(0)
  const weight = rdata.readUInt16BE(2)
  const port = rdata.readUInt16BE(4)

  // If we have the full packet buffer, use it for name decompression
  const targetBuf = packetBuf && rdataOffset !== undefined ? packetBuf : rdata
  const targetOffset = packetBuf && rdataOffset !== undefined ? rdataOffset + 6 : 6

  const { name: target } = decodeName(targetBuf, targetOffset)

  return { priority, weight, port, target }
}

/** Encode TXT record data as key=value pairs (RFC 6763) */
export function encodeTxt(txt: TxtData): Buffer {
  const entries: Buffer[] = []
  for (const [key, value] of Object.entries(txt)) {
    const entry = `${key}=${value}`
    const entryBuf = Buffer.alloc(1 + entry.length)
    entryBuf.writeUInt8(entry.length, 0)
    entryBuf.write(entry, 1, 'utf8')
    entries.push(entryBuf)
  }
  if (entries.length === 0) {
    // Empty TXT record has a single zero byte
    return Buffer.from([0])
  }
  return Buffer.concat(entries)
}

/** Decode TXT record data from key=value pair entries */
export function decodeTxt(rdata: Buffer): TxtData {
  const result: TxtData = {}
  let pos = 0

  while (pos < rdata.length) {
    const len = rdata.readUInt8(pos)
    pos += 1

    if (len === 0) continue

    if (pos + len > rdata.length) {
      throw new Error('TXT entry extends beyond RDATA')
    }

    const entry = rdata.toString('utf8', pos, pos + len)
    const eqIndex = entry.indexOf('=')
    if (eqIndex > 0) {
      result[entry.substring(0, eqIndex)] = entry.substring(eqIndex + 1)
    }
    pos += len
  }

  return result
}

/** Encode a PTR record (just a domain name) */
export function encodePtr(name: string): Buffer {
  return encodeName(name)
}

/** Decode a PTR record from rdata using the full packet buffer for name decompression */
export function decodePtr(rdata: Buffer, packetBuf?: Buffer, rdataOffset?: number): string {
  const buf = packetBuf && rdataOffset !== undefined ? packetBuf : rdata
  const offset = packetBuf && rdataOffset !== undefined ? rdataOffset : 0
  const { name } = decodeName(buf, offset)
  return name
}

// ─── Full Packet Encoding/Decoding ───────────────────────────────────────────

/** Encode a complete DNS packet */
export function encodePacket(packet: DnsPacket): Buffer {
  const parts: Buffer[] = [encodeHeader(packet.header)]

  for (const q of packet.questions) {
    parts.push(encodeQuestion(q))
  }
  for (const rr of packet.answers) {
    parts.push(encodeResourceRecord(rr))
  }
  for (const rr of packet.authorities) {
    parts.push(encodeResourceRecord(rr))
  }
  for (const rr of packet.additionals) {
    parts.push(encodeResourceRecord(rr))
  }

  return Buffer.concat(parts)
}

/** Decode a complete DNS packet */
export function decodePacket(buf: Buffer): DnsPacket {
  const header = decodeHeader(buf)
  let offset = HEADER_SIZE

  const questions: DnsQuestion[] = []
  for (let i = 0; i < header.qdcount; i++) {
    const { question, bytesRead } = decodeQuestion(buf, offset)
    questions.push(question)
    offset += bytesRead
  }

  const answers: DnsResourceRecord[] = []
  for (let i = 0; i < header.ancount; i++) {
    const { record, bytesRead } = decodeResourceRecord(buf, offset)
    answers.push(record)
    offset += bytesRead
  }

  const authorities: DnsResourceRecord[] = []
  for (let i = 0; i < header.nscount; i++) {
    const { record, bytesRead } = decodeResourceRecord(buf, offset)
    authorities.push(record)
    offset += bytesRead
  }

  const additionals: DnsResourceRecord[] = []
  for (let i = 0; i < header.arcount; i++) {
    const { record, bytesRead } = decodeResourceRecord(buf, offset)
    additionals.push(record)
    offset += bytesRead
  }

  return { header, questions, answers, authorities, additionals }
}

// ─── Header Flag Helpers ─────────────────────────────────────────────────────

/** QR bit: 0 = query, 1 = response */
export const FLAGS_QR_RESPONSE = 0x8400 // QR=1, AA=1 (authoritative)
export const FLAGS_QR_QUERY = 0x0000
