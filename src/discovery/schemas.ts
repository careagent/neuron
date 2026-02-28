/**
 * TypeBox schemas for mDNS/DNS-SD service info and discovery results.
 *
 * Defines validation schemas for service advertisement configuration
 * and discovered service records.
 */

import { Type, type Static } from '@sinclair/typebox'

/** TXT record key-value pairs for DNS-SD */
export const ServiceTxtSchema = Type.Record(Type.String(), Type.String())
export type ServiceTxt = Static<typeof ServiceTxtSchema>

/** Configuration for advertising a service via DNS-SD */
export const ServiceInfoSchema = Type.Object({
  /** Service type without protocol suffix (e.g., '_careagent') */
  serviceType: Type.String({ minLength: 1 }),
  /** Unique service instance name (e.g., 'neuron-abc123') */
  serviceName: Type.String({ minLength: 1 }),
  /** Port the service is listening on */
  port: Type.Number({ minimum: 1, maximum: 65535 }),
  /** Hostname to advertise (defaults to OS hostname) */
  host: Type.Optional(Type.String()),
  /** TXT record key-value pairs (RFC 6763 Section 6) */
  txt: Type.Optional(ServiceTxtSchema),
  /** TTL in seconds for advertised records (default 120 per RFC 6762) */
  ttl: Type.Optional(Type.Number({ minimum: 0, default: 120 })),
})
export type ServiceInfo = Static<typeof ServiceInfoSchema>

/** A discovered service instance */
export const DiscoveredServiceSchema = Type.Object({
  /** Service instance name (e.g., 'neuron-abc123._careagent._tcp.local') */
  fullName: Type.String(),
  /** Short service name (e.g., 'neuron-abc123') */
  serviceName: Type.String(),
  /** Service type (e.g., '_careagent._tcp') */
  serviceType: Type.String(),
  /** Resolved hostname */
  host: Type.String(),
  /** Resolved port */
  port: Type.Number({ minimum: 1, maximum: 65535 }),
  /** Resolved IPv4 addresses */
  addresses: Type.Array(Type.String()),
  /** TXT record data */
  txt: ServiceTxtSchema,
  /** TTL of the service record in seconds */
  ttl: Type.Number({ minimum: 0 }),
})
export type DiscoveredService = Static<typeof DiscoveredServiceSchema>

/** Options for browsing services */
export const BrowseOptionsSchema = Type.Object({
  /** Service type to browse for (e.g., '_careagent._tcp') */
  serviceType: Type.String({ minLength: 1 }),
  /** Timeout in milliseconds for the browse operation */
  timeoutMs: Type.Optional(Type.Number({ minimum: 100, default: 3000 })),
})
export type BrowseOptions = Static<typeof BrowseOptionsSchema>

/** Result of a resolve operation */
export const ResolveResultSchema = Type.Object({
  /** Resolved hostname */
  host: Type.String(),
  /** Resolved port */
  port: Type.Number({ minimum: 1, maximum: 65535 }),
  /** Resolved IPv4 addresses */
  addresses: Type.Array(Type.String()),
  /** TXT record data */
  txt: ServiceTxtSchema,
})
export type ResolveResult = Static<typeof ResolveResultSchema>
