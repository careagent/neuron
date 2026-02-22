import type { NeuronConfig } from '../types/config.js'

/** Default configuration values matching TypeBox schema defaults */
export const DEFAULT_CONFIG: Omit<NeuronConfig, 'organization'> & {
  organization: Partial<NeuronConfig['organization']>
} = {
  organization: {},
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  storage: {
    path: './data/neuron.db',
  },
  audit: {
    path: './data/audit.jsonl',
    enabled: true,
  },
  localNetwork: {
    enabled: false,
  },
  heartbeat: {
    intervalMs: 60000,
  },
  axon: {
    registryUrl: 'http://localhost:9999',
    endpointUrl: 'http://localhost:3000',
    backoffCeilingMs: 300000,
  },
}
