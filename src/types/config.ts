import { Type, type Static } from '@sinclair/typebox'
import { NpiString, OrganizationType } from './common.js'

/** Neuron configuration schema for neuron.config.json */
export const NeuronConfigSchema = Type.Object({
  organization: Type.Object({
    npi: NpiString,
    name: Type.String({ minLength: 1 }),
    type: OrganizationType,
  }),
  server: Type.Object({
    port: Type.Number({ minimum: 1, maximum: 65535, default: 3000 }),
    host: Type.String({ default: '0.0.0.0' }),
  }),
  websocket: Type.Object({
    path: Type.String({ default: '/ws/handshake' }),
    maxConcurrentHandshakes: Type.Number({ minimum: 1, default: 10 }),
    authTimeoutMs: Type.Number({ minimum: 1000, default: 10000 }),
    queueTimeoutMs: Type.Number({ minimum: 1000, default: 30000 }),
    maxPayloadBytes: Type.Number({ minimum: 1024, default: 65536 }),
  }),
  storage: Type.Object({
    path: Type.String({ default: './data/neuron.db' }),
  }),
  audit: Type.Object({
    path: Type.String({ default: './data/audit.jsonl' }),
    enabled: Type.Boolean({ default: true }),
  }),
  localNetwork: Type.Object({
    enabled: Type.Boolean({ default: false }),
    serviceType: Type.String({ default: 'careagent-neuron' }),
    protocolVersion: Type.String({ default: 'v1.0' }),
  }),
  heartbeat: Type.Object({
    intervalMs: Type.Number({ minimum: 1000, default: 60000 }),
  }),
  axon: Type.Object({
    registryUrl: Type.String({ default: 'http://localhost:9999' }),
    endpointUrl: Type.String({ default: 'http://localhost:3000' }),
    backoffCeilingMs: Type.Number({ minimum: 1000, default: 300000 }),
  }),
  api: Type.Object({
    rateLimit: Type.Object({
      maxRequests: Type.Number({ minimum: 1, default: 100 }),
      windowMs: Type.Number({ minimum: 1000, default: 60000 }),
    }),
    cors: Type.Object({
      allowedOrigins: Type.Array(Type.String(), { default: [] }),
    }),
  }),
})

export type NeuronConfig = Static<typeof NeuronConfigSchema>
