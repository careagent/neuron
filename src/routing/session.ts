/**
 * Handshake session manager for tracking active WebSocket connections.
 *
 * Sessions are ephemeral (handshakes last seconds, not minutes).
 * Stored in an in-memory Map, not persisted to SQLite.
 */

import { randomUUID } from 'node:crypto'
import type { HandshakeStatus } from './types.js'

/** Internal session state managed by the session manager */
export interface InternalSession {
  id: string
  patientAgentId: string
  providerNpi: string
  status: HandshakeStatus
  startedAt: string
}

export class HandshakeSessionManager {
  private readonly sessions = new Map<string, InternalSession>()

  /** Create a new session, returns session object */
  create(): InternalSession {
    const session: InternalSession = {
      id: randomUUID(),
      patientAgentId: '',
      providerNpi: '',
      status: 'authenticating',
      startedAt: new Date().toISOString(),
    }
    this.sessions.set(session.id, session)
    return session
  }

  /** Get session by ID */
  get(id: string): InternalSession | undefined {
    return this.sessions.get(id)
  }

  /** Remove session (on disconnect or completion) */
  remove(id: string): boolean {
    return this.sessions.delete(id)
  }

  /** Current number of active sessions */
  get size(): number {
    return this.sessions.size
  }

  /** All active sessions (for ProtocolServer.activeSessions()) */
  all(): InternalSession[] {
    return Array.from(this.sessions.values())
  }

  /** Clear all sessions (for shutdown) */
  clear(): void {
    this.sessions.clear()
  }
}
