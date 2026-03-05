/**
 * A2A Server layer for Neuron.
 *
 * Provides Agent Card generation, JSON-RPC 2.0 server, SSE streaming,
 * and HTTP route handlers for A2A protocol compliance.
 */

export { generateAgentCard, agentCardHandler } from './agent-card.js'
export type { AgentCardOptions } from './agent-card.js'

export { A2AServer } from './server.js'
export type { A2AServerDeps } from './server.js'

export { createSSEStream, streamTaskUpdates } from './sse.js'
export type { SSEWriter } from './sse.js'

export { handleA2ARequest, handleAgentCard, handleA2AStream } from './routes.js'
