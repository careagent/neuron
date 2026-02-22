/**
 * NeuronTestHarness: composable E2E test harness for Neuron integration tests.
 *
 * Composes all Neuron subsystems in the same order as src/cli/commands/start.ts
 * without spawning a CLI child process. Reusable across all E2E test suites.
 *
 * Also exports WebSocket helper functions for consent handshake testing.
 */

import http from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { SqliteStorage } from '../../src/storage/sqlite.js'
import { AuditLogger } from '../../src/audit/logger.js'
import { AxonRegistrationService } from '../../src/registration/service.js'
import { RelationshipStore } from '../../src/relationships/store.js'
import { ConsentHandshakeHandler } from '../../src/relationships/handshake.js'
import { NeuronProtocolServer, createConnectionHandler } from '../../src/routing/index.js'
import { DiscoveryService } from '../../src/discovery/service.js'
import { ApiKeyStore } from '../../src/api/keys.js'
import { TokenBucketRateLimiter } from '../../src/api/rate-limiter.js'
import { createApiRouter } from '../../src/api/router.js'
import { createMockAxonServer } from '../../test/mock-axon/server.js'
import type { NeuronConfig } from '../../src/types/config.js'

/** Options for configuring the test harness */
export interface HarnessOptions {
  enableDiscovery?: boolean
  enableAxonMock?: boolean
  rateLimit?: { maxRequests: number; windowMs: number }
  heartbeatIntervalMs?: number
}

/**
 * NeuronTestHarness: starts all Neuron subsystems in the same initialization
 * order as start.ts, exposing each for direct test assertions.
 *
 * Uses beforeAll/afterAll lifecycle (not beforeEach) -- subsystem creation is
 * expensive and tests can share the harness, resetting state where needed.
 */
export class NeuronTestHarness {
  storage!: SqliteStorage
  auditLogger!: AuditLogger
  registrationService!: AxonRegistrationService
  relationshipStore!: RelationshipStore
  handshakeHandler!: ConsentHandshakeHandler
  protocolServer!: NeuronProtocolServer
  apiKeyStore!: ApiKeyStore
  rateLimiter!: TokenBucketRateLimiter
  discoveryService?: DiscoveryService
  mockAxonServer?: http.Server
  config!: NeuronConfig
  port = 0

  private tempDir = ''
  private mockAxonPort = 0

  /**
   * Start the full Neuron subsystem stack.
   *
   * Initialization order (matching start.ts):
   * 1. Mock Axon server (if enabled)
   * 2. Build config
   * 3. SqliteStorage (in-memory)
   * 4. AuditLogger (temp directory)
   * 5. AxonRegistrationService, RelationshipStore, ConsentHandshakeHandler
   * 6. NeuronProtocolServer + ConnectionHandler
   * 7. ApiKeyStore, TokenBucketRateLimiter, ApiRouter
   * 8. DiscoveryService (if enabled)
   * 9. Start AxonRegistrationService
   */
  async start(options?: HarnessOptions): Promise<void> {
    const enableAxonMock = options?.enableAxonMock ?? true
    const enableDiscovery = options?.enableDiscovery ?? false
    const rateLimitConfig = options?.rateLimit ?? { maxRequests: 100, windowMs: 60000 }
    const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 999999

    // 1. Start mock Axon server on ephemeral port
    if (enableAxonMock) {
      this.mockAxonServer = createMockAxonServer(0)
      await new Promise<void>((resolve) => {
        this.mockAxonServer!.on('listening', () => {
          const addr = this.mockAxonServer!.address()
          if (addr && typeof addr === 'object') {
            this.mockAxonPort = addr.port
          }
          resolve()
        })
      })
    }

    // 2. Build NeuronConfig
    this.tempDir = mkdtempSync(join(tmpdir(), 'neuron-e2e-'))
    const auditPath = join(this.tempDir, 'audit.jsonl')

    this.config = {
      organization: { npi: '9999999999', name: 'E2E Test Org', type: 'practice' },
      server: { port: 0, host: '127.0.0.1' },
      websocket: {
        path: '/ws/handshake',
        maxConcurrentHandshakes: 10,
        authTimeoutMs: 10000,
        queueTimeoutMs: 30000,
        maxPayloadBytes: 65536,
      },
      storage: { path: ':memory:' },
      audit: { path: auditPath, enabled: true },
      localNetwork: {
        enabled: enableDiscovery,
        serviceType: 'careagent-neuron',
        protocolVersion: 'v1.0',
      },
      heartbeat: { intervalMs: heartbeatIntervalMs },
      axon: {
        registryUrl: enableAxonMock
          ? `http://127.0.0.1:${this.mockAxonPort}`
          : 'http://localhost:9999',
        endpointUrl: 'http://127.0.0.1:0',
        backoffCeilingMs: 300000,
      },
      api: {
        rateLimit: rateLimitConfig,
        cors: { allowedOrigins: ['*'] },
      },
    }

    // 3. Initialize storage (in-memory SQLite)
    this.storage = new SqliteStorage(':memory:')
    this.storage.initialize()

    // 4. Create audit logger
    this.auditLogger = new AuditLogger(auditPath)

    // 5. Create registration, relationship, and consent services
    this.registrationService = new AxonRegistrationService(
      this.config,
      this.storage,
      this.auditLogger,
    )

    this.relationshipStore = new RelationshipStore(this.storage)

    this.handshakeHandler = new ConsentHandshakeHandler(
      this.relationshipStore,
      this.config.organization.npi,
      this.auditLogger,
    )

    // 6. Create and start protocol server
    this.protocolServer = new NeuronProtocolServer(
      this.config,
      this.handshakeHandler,
      this.relationshipStore,
      this.auditLogger,
    )

    const connectionHandler = createConnectionHandler({
      config: this.config,
      handshakeHandler: this.handshakeHandler,
      relationshipStore: this.relationshipStore,
      sessionManager: this.protocolServer.getSessionManager(),
      organizationNpi: this.config.organization.npi,
      neuronEndpointUrl: this.config.axon.endpointUrl,
      auditLogger: this.auditLogger,
      onSessionEnd: () => this.protocolServer.notifySessionEnd(),
    })

    this.protocolServer.setConnectionHandler(connectionHandler)
    await this.protocolServer.start(0) // ephemeral port

    this.port = this.protocolServer.port!

    // 7. Wire REST API
    this.apiKeyStore = new ApiKeyStore(this.storage)
    this.rateLimiter = new TokenBucketRateLimiter(
      rateLimitConfig.maxRequests,
      rateLimitConfig.maxRequests, // refill = max (full refill each window)
      rateLimitConfig.windowMs,
    )

    const apiRouter = createApiRouter({
      config: this.config,
      storage: this.storage,
      apiKeyStore: this.apiKeyStore,
      rateLimiter: this.rateLimiter,
      relationshipStore: this.relationshipStore,
      registrationService: this.registrationService,
      protocolServer: this.protocolServer,
    })

    const httpServer = this.protocolServer.server!
    httpServer.on('request', apiRouter)

    // 8. Start discovery (if enabled)
    if (enableDiscovery) {
      const endpointUrl = `ws://127.0.0.1:${this.port}${this.config.websocket.path}`
      this.discoveryService = new DiscoveryService({
        enabled: true,
        serviceType: this.config.localNetwork.serviceType,
        protocolVersion: this.config.localNetwork.protocolVersion,
        organizationNpi: this.config.organization.npi,
        serverPort: this.port,
        endpointUrl,
      })
      await this.discoveryService.start()
    }

    // 9. Start Axon registration
    try {
      await this.registrationService.start()
    } catch {
      // Axon unreachable is acceptable for some tests
    }
  }

  /**
   * Stop all subsystems in reverse order (matching start.ts shutdown).
   *
   * Shutdown order:
   * 1. Discovery (goodbye packets)
   * 2. Protocol server (closes WebSocket connections)
   * 3. Registration service (stops heartbeat)
   * 4. Storage
   * 5. Mock Axon server
   * 6. Temp directory cleanup
   */
  async stop(): Promise<void> {
    // 1. Stop discovery
    if (this.discoveryService) {
      try {
        await this.discoveryService.stop()
      } catch {
        // Ignore
      }
    }

    // 2. Stop protocol server
    try {
      await this.protocolServer.stop()
    } catch {
      // Ignore
    }

    // 3. Stop registration
    try {
      await this.registrationService.stop()
    } catch {
      // Ignore
    }

    // 4. Close storage
    try {
      this.storage.close()
    } catch {
      // Ignore
    }

    // 5. Close mock Axon server
    if (this.mockAxonServer) {
      await new Promise<void>((resolve) => {
        this.mockAxonServer!.close(() => resolve())
      })
    }

    // 6. Clean up temp directory
    try {
      rmSync(this.tempDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  }
}

// ── WebSocket Helper Functions ──────────────────────────────────────────────

/** Generate a test Ed25519 key pair and extract base64url public key */
export function makeTestKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  return { publicKey, privateKey, publicKeyBase64url: jwk.x! }
}

/** Create a signed consent token from claims */
export function signConsentToken(
  claims: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
  const signature = sign(null, payload, privateKey)
  return {
    payload: payload.toString('base64url'),
    signature: signature.toString('base64url'),
  }
}

/** Create valid consent claims with 1-hour expiry */
export function validClaims(patientAgentId: string, providerNpi: string): Record<string, unknown> {
  return {
    patient_agent_id: patientAgentId,
    provider_npi: providerNpi,
    consented_actions: ['office_visit', 'lab_results'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
}

/** Connect via WebSocket and wait for the connection to open */
export function connectAndWaitOpen(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/handshake`)
    ws.on('open', () => resolve(ws))
    ws.on('error', (err) => reject(err))
  })
}

/** Receive a single JSON message from a WebSocket with 5-second timeout */
export function receiveMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('receiveMessage timeout')), 5000)
    ws.once('message', (data: Buffer) => {
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
  })
}

/** Wait for a WebSocket close event with 5-second timeout */
export function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: 0, reason: 'already closed' })
      return
    }
    const timeout = setTimeout(() => resolve({ code: 0, reason: 'timeout' }), 5000)
    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timeout)
      resolve({ code, reason: reason.toString() })
    })
  })
}

/** Send a handshake.auth message over WebSocket */
export function sendAuthMessage(
  ws: WebSocket,
  token: { payload: string; signature: string },
  publicKeyBase64url: string,
  patientAgentId = 'patient-agent-001',
  patientEndpoint = 'http://patient.local/ws',
): void {
  ws.send(JSON.stringify({
    type: 'handshake.auth',
    consent_token_payload: token.payload,
    consent_token_signature: token.signature,
    patient_agent_id: patientAgentId,
    patient_public_key: publicKeyBase64url,
    patient_endpoint: patientEndpoint,
  }))
}
