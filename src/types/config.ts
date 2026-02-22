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
  storage: Type.Object({
    path: Type.String({ default: './data/neuron.db' }),
  }),
  audit: Type.Object({
    path: Type.String({ default: './data/audit.jsonl' }),
    enabled: Type.Boolean({ default: true }),
  }),
  localNetwork: Type.Object({
    enabled: Type.Boolean({ default: false }),
  }),
  heartbeat: Type.Object({
    intervalMs: Type.Number({ minimum: 1000, default: 60000 }),
  }),
  axon: Type.Object({
    registryUrl: Type.String({ default: 'http://localhost:9999' }),
    endpointUrl: Type.String({ default: 'http://localhost:3000' }),
    backoffCeilingMs: Type.Number({ minimum: 1000, default: 300000 }),
  }),
})

export type NeuronConfig = Static<typeof NeuronConfigSchema>
