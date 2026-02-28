// Legacy bonjour-service wrapper (existing)
export { DiscoveryService } from './service.js'
export type { DiscoveryConfig } from './types.js'

// Pure Node.js mDNS/DNS-SD implementation (Session 04a)
export { MdnsResponder, MDNS_MULTICAST_ADDR, MDNS_PORT } from './mdns.js'
export type { MdnsOptions } from './mdns.js'

export { DnsSdService, createDiscoveryService } from './dns-sd.js'
export type { DnsSdOptions } from './dns-sd.js'

export { RecordCache } from './cache.js'
export type { CachedRecord } from './cache.js'

export {
  // Packet encode/decode
  encodePacket,
  decodePacket,
  encodeName,
  decodeName,
  encodeHeader,
  decodeHeader,
  encodeQuestion,
  decodeQuestion,
  encodeResourceRecord,
  decodeResourceRecord,
  // RDATA helpers
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
  // Constants
  RECORD_TYPE,
  RECORD_CLASS,
  CACHE_FLUSH_BIT,
  FLAGS_QR_RESPONSE,
  FLAGS_QR_QUERY,
} from './dns-packet.js'
export type {
  DnsPacket,
  DnsHeader,
  DnsQuestion,
  DnsResourceRecord,
  SrvData,
  TxtData,
  RecordType,
} from './dns-packet.js'

// TypeBox schemas
export {
  ServiceInfoSchema,
  DiscoveredServiceSchema,
  BrowseOptionsSchema,
  ResolveResultSchema,
  ServiceTxtSchema,
} from './schemas.js'
export type {
  ServiceInfo,
  DiscoveredService,
  BrowseOptions,
  ResolveResult,
  ServiceTxt,
} from './schemas.js'
