/**
 * NeuronProtocolServer: WebSocket server for the consent handshake protocol.
 *
 * Implements the ProtocolServer interface from provider-core. Uses the `ws`
 * library in noServer mode attached to a Node.js http.createServer() instance.
 * The HTTP server is exposed for Phase 7 REST API reuse.
 *
 * Safety ceiling: when maxConcurrentHandshakes is reached, new connections
 * are queued (not rejected) and processed when slots open. Per user decision:
 * "no patient CareAgent should ever be turned away."
 */

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { Duplex } from 'node:stream'
import type { NeuronConfig } from '../types/config.js'
import type { ProtocolServer, ProtocolSession } from './types.js'
import { HandshakeSessionManager } from './session.js'
import type { ConsentHandshakeHandler } from '../relationships/handshake.js'
import type { RelationshipStore } from '../relationships/store.js'
import type { AuditLogger } from '../audit/logger.js'

/** Pending upgrade entry for queued connections */
interface PendingUpgrade {
  request: IncomingMessage
  socket: Duplex
  head: Buffer
  timer: ReturnType<typeof setTimeout>
}

/** Dependencies for the connection handler factory */
export interface ConnectionHandlerDeps {
  config: NeuronConfig
  handshakeHandler: ConsentHandshakeHandler
  relationshipStore: RelationshipStore
  sessionManager: HandshakeSessionManager
  organizationNpi: string
  neuronEndpointUrl: string
  auditLogger?: AuditLogger
}

/** Connection handler type: function called on each new WebSocket connection */
export type ConnectionHandler = (ws: WebSocket, request: IncomingMessage) => void

export class NeuronProtocolServer implements ProtocolServer {
  private httpServer: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private readonly sessionManager = new HandshakeSessionManager()
  private readonly pendingUpgrades: PendingUpgrade[] = []
  private connectionHandler: ConnectionHandler | null = null
  private onSessionEnd: (() => void) | null = null

  constructor(
    private readonly config: NeuronConfig,
    private readonly handshakeHandler: ConsentHandshakeHandler,
    private readonly relationshipStore: RelationshipStore,
    private readonly auditLogger?: AuditLogger,
  ) {}

  /** Set the connection handler (created by createConnectionHandler in handler.ts) */
  setConnectionHandler(handler: ConnectionHandler): void {
    this.connectionHandler = handler
  }

  /** Get the session manager (for handler factory injection) */
  getSessionManager(): HandshakeSessionManager {
    return this.sessionManager
  }

  /** Set the onSessionEnd callback (called when a session completes/disconnects to process pending upgrades) */
  setOnSessionEnd(callback: () => void): void {
    this.onSessionEnd = callback
  }

  /**
   * Start the protocol server.
   *
   * Creates HTTP server + WebSocket server in noServer mode.
   * Routes /ws/handshake path to WebSocket upgrade.
   * Rejects other paths by destroying the socket.
   *
   * @param port - Port to listen on. Use 0 for OS-assigned (tests).
   * @param httpServer - Optional existing HTTP server for Phase 7 reuse.
   */
  async start(port: number, httpServer?: HttpServer): Promise<void> {
    if (httpServer) {
      this.httpServer = httpServer
    } else {
      this.httpServer = createServer()
    }

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.websocket.maxPayloadBytes,
    })

    // Handle malformed WebSocket upgrade requests (pitfall #5)
    this.wss.on('wsClientError', (_error, socket) => {
      socket.destroy()
    })

    // Wire upgrade handler with path routing and safety ceiling
    this.httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`)

      if (url.pathname !== this.config.websocket.path) {
        socket.destroy()
        return
      }

      // Error handler for pre-upgrade socket errors
      socket.on('error', () => {
        socket.destroy()
      })

      if (this.sessionManager.size < this.config.websocket.maxConcurrentHandshakes) {
        this.performUpgrade(request, socket, head)
      } else {
        // Queue the connection (never reject a patient CareAgent)
        const timer = setTimeout(() => {
          const idx = this.pendingUpgrades.findIndex((p) => p.socket === socket)
          if (idx !== -1) {
            this.pendingUpgrades.splice(idx, 1)
            socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
            socket.destroy()
          }
        }, this.config.websocket.queueTimeoutMs)

        this.pendingUpgrades.push({ request, socket, head, timer })
      }
    })

    // Wire connection event to handler
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      if (this.connectionHandler) {
        this.connectionHandler(ws, request)
      }
    })

    // Set the onSessionEnd callback to process pending upgrades
    this.onSessionEnd = () => {
      this.tryProcessPending()
    }

    // Start listening (skip if httpServer was provided and is already listening)
    if (!httpServer) {
      return new Promise<void>((resolve, reject) => {
        this.httpServer!.on('error', reject)
        this.httpServer!.listen(port, () => {
          this.httpServer!.removeListener('error', reject)
          resolve()
        })
      })
    } else if (!httpServer.listening) {
      return new Promise<void>((resolve, reject) => {
        this.httpServer!.on('error', reject)
        this.httpServer!.listen(port, () => {
          this.httpServer!.removeListener('error', reject)
          resolve()
        })
      })
    }
  }

  /**
   * Stop the protocol server gracefully.
   *
   * Closes all active WebSocket connections with code 1001 (going away).
   * Destroys all pending queued sockets. Closes WebSocketServer. Closes HTTP server.
   */
  async stop(): Promise<void> {
    // Close all active WebSocket connections with code 1001
    if (this.wss) {
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, 'Server shutting down')
        }
      }
    }

    // Destroy all pending queued sockets
    for (const pending of this.pendingUpgrades) {
      clearTimeout(pending.timer)
      pending.socket.destroy()
    }
    this.pendingUpgrades.length = 0

    // Clear session tracking
    this.sessionManager.clear()

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => (err ? reject(err) : resolve()))
      })
      this.httpServer = null
    }
  }

  /**
   * Get all active handshake sessions mapped to ProtocolSession format.
   */
  activeSessions(): ProtocolSession[] {
    return this.sessionManager.all().map((session) => ({
      sessionId: session.id,
      patientAgentId: session.patientAgentId,
      providerAgentId: session.providerNpi,
      startedAt: session.startedAt,
      status: session.status === 'completed' ? 'completed' as const
        : session.status === 'failed' ? 'terminated' as const
        : 'active' as const,
    }))
  }

  /**
   * Notify the server that a session has ended.
   * Called by the connection handler when a handshake completes or a connection closes.
   */
  notifySessionEnd(): void {
    if (this.onSessionEnd) {
      this.onSessionEnd()
    }
  }

  /** Expose the underlying HTTP server for Phase 7 REST API reuse */
  get server(): HttpServer | null {
    return this.httpServer
  }

  /** Get the port the server is listening on (useful in tests with port 0) */
  get port(): number | null {
    const addr = this.httpServer?.address()
    if (addr && typeof addr === 'object') {
      return addr.port
    }
    return null
  }

  /**
   * Perform the WebSocket upgrade and emit connection event.
   */
  private performUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss!.handleUpgrade(request, socket, head, (ws) => {
      socket.removeAllListeners('error')
      this.wss!.emit('connection', ws, request)
    })
  }

  /**
   * Process pending upgrades when a slot opens.
   * Called after a session ends to promote queued connections.
   */
  private tryProcessPending(): void {
    while (
      this.pendingUpgrades.length > 0 &&
      this.sessionManager.size < this.config.websocket.maxConcurrentHandshakes
    ) {
      const pending = this.pendingUpgrades.shift()!
      clearTimeout(pending.timer)

      // Check if the socket is still writable (client may have given up)
      if (pending.socket.writable) {
        this.performUpgrade(pending.request, pending.socket, pending.head)
      }
    }
  }
}
