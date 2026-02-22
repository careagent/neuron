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
  websocket: {
    path: '/ws/handshake',
    maxConcurrentHandshakes: 10,
    authTimeoutMs: 10000,
    queueTimeoutMs: 30000,
    maxPayloadBytes: 65536,
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
    serviceType: 'careagent-neuron',
    protocolVersion: 'v1.0',
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
