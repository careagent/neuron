/** Session status for a handshake connection */
export type HandshakeStatus = 'authenticating' | 'challenged' | 'completed' | 'failed'

/** Active handshake session representation (satisfies ProtocolSession from provider-core) */
export interface ProtocolSession {
  sessionId: string
  patientAgentId: string
  providerAgentId: string
  startedAt: string
  status: 'active' | 'completed' | 'terminated'
}

/** Protocol server interface (satisfies ProtocolServer from provider-core) */
export interface ProtocolServer {
  start(port: number): Promise<void>
  stop(): Promise<void>
  activeSessions(): ProtocolSession[]
}

/**
 * Internal handshake session tracking.
 * WebSocket reference and auth timer are managed by the server implementation (Plan 02),
 * not stored in this exported type.
 */
export interface HandshakeSession {
  id: string
  patientAgentId: string
  providerNpi: string
  status: HandshakeStatus
  startedAt: string
}
