/**
 * Integration tests for WebSocket routing (consent handshake protocol).
 *
 * Uses real WebSocket connections to a real NeuronProtocolServer instance
 * on an ephemeral port. Tests cover the full handshake flow, error paths,
 * safety ceiling queuing, graceful shutdown, and session tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { SqliteStorage } from '../storage/sqlite.js'
import { AuditLogger } from '../audit/logger.js'
import { RelationshipStore } from '../relationships/store.js'
import { ConsentHandshakeHandler } from '../relationships/handshake.js'
import { NeuronProtocolServer } from './server.js'
import { createConnectionHandler } from './handler.js'
import type { NeuronConfig } from '../types/config.js'

/** Generate a test Ed25519 key pair and extract base64url public key */
function makeTestKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  return { publicKey, privateKey, publicKeyBase64url: jwk.x! }
}

/** Create a signed consent token from claims */
function signConsentToken(
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

/** Helper: create valid consent claims */
function validClaims(patientAgentId: string, providerNpi: string): Record<string, unknown> {
  return {
    patient_agent_id: patientAgentId,
    provider_npi: providerNpi,
    consented_actions: ['office_visit', 'lab_results'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
}

/** Helper: connect and wait for open */
function connectAndWaitOpen(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/handshake`)
    ws.on('open', () => resolve(ws))
    ws.on('error', (err) => reject(err))
  })
}

/** Helper: receive a single JSON message */
function receiveMessage(ws: WebSocket): Promise<Record<string, unknown>> {
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

/** Helper: wait for close */
function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
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

/** Helper: send handshake.auth message */
function sendAuthMessage(
  ws: WebSocket,
  opts: {
    consentTokenPayload: string
    consentTokenSignature: string
    patientAgentId: string
    patientPublicKey: string
    patientEndpoint: string
  },
): void {
  ws.send(JSON.stringify({
    type: 'handshake.auth',
    consent_token_payload: opts.consentTokenPayload,
    consent_token_signature: opts.consentTokenSignature,
    patient_agent_id: opts.patientAgentId,
    patient_public_key: opts.patientPublicKey,
    patient_endpoint: opts.patientEndpoint,
  }))
}

describe('WebSocket Routing Integration', () => {
  let tempDir: string
  let storage: SqliteStorage
  let auditLogger: AuditLogger
  let relationshipStore: RelationshipStore
  let handshakeHandler: ConsentHandshakeHandler
  let server: NeuronProtocolServer
  let serverPort: number

  const organizationNpi = '9999999999'
  const providerNpi = '1234567893'
  const neuronEndpointUrl = 'http://localhost:3000'

  const { privateKey, publicKeyBase64url } = makeTestKeyPair()

  const testConfig: NeuronConfig = {
    organization: { npi: organizationNpi, name: 'Test Org', type: 'practice' },
    server: { port: 0, host: '127.0.0.1' },
    websocket: {
      path: '/ws/handshake',
      maxConcurrentHandshakes: 2,
      authTimeoutMs: 500,
      queueTimeoutMs: 2000,
      maxPayloadBytes: 65536,
    },
    storage: { path: ':memory:' },
    audit: { path: '', enabled: true },
    localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
    heartbeat: { intervalMs: 60000 },
    axon: {
      registryUrl: 'http://localhost:9999',
      endpointUrl: neuronEndpointUrl,
      backoffCeilingMs: 300000,
    },
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-routing-test-'))
    const auditPath = join(tempDir, 'audit.jsonl')

    storage = new SqliteStorage(':memory:')
    storage.initialize()

    auditLogger = new AuditLogger(auditPath)
    relationshipStore = new RelationshipStore(storage)
    handshakeHandler = new ConsentHandshakeHandler(
      relationshipStore,
      organizationNpi,
      auditLogger,
    )

    server = new NeuronProtocolServer(
      testConfig,
      handshakeHandler,
      relationshipStore,
      auditLogger,
    )

    const connectionHandler = createConnectionHandler({
      config: testConfig,
      handshakeHandler,
      relationshipStore,
      sessionManager: server.getSessionManager(),
      organizationNpi,
      neuronEndpointUrl,
      auditLogger,
      onSessionEnd: () => server.notifySessionEnd(),
    })

    server.setConnectionHandler(connectionHandler)
    await server.start(0) // ephemeral port

    serverPort = server.port!
  })

  afterEach(async () => {
    await server.stop()
    try {
      storage.close()
    } catch {
      // May already be closed
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should complete a full handshake flow for a new relationship', async () => {
    const ws = await connectAndWaitOpen(serverPort)
    const closePromise = waitForClose(ws)

    // Send handshake.auth
    const token = signConsentToken(validClaims('patient-001', providerNpi), privateKey)
    sendAuthMessage(ws, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-001',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Receive handshake.challenge
    const challenge = await receiveMessage(ws)
    expect(challenge.type).toBe('handshake.challenge')
    expect(challenge.nonce).toBeDefined()
    expect(typeof challenge.nonce).toBe('string')
    expect(challenge.provider_npi).toBe(providerNpi)
    expect(challenge.organization_npi).toBe(organizationNpi)

    // Sign nonce
    const nonceBuffer = Buffer.from(challenge.nonce as string, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    // Send challenge_response
    ws.send(JSON.stringify({
      type: 'handshake.challenge_response',
      signed_nonce: signedNonce.toString('base64url'),
    }))

    // Receive handshake.complete
    const complete = await receiveMessage(ws)
    expect(complete.type).toBe('handshake.complete')
    expect(complete.relationship_id).toBeDefined()
    expect(typeof complete.relationship_id).toBe('string')
    expect(complete.provider_endpoint).toContain(`/ws/provider/${providerNpi}`)
    expect(complete.status).toBe('new')

    // WebSocket should close with 1000
    const closeResult = await closePromise
    expect(closeResult.code).toBe(1000)

    // Verify relationship in store
    const relationships = relationshipStore.findByPatient('patient-001')
    expect(relationships).toHaveLength(1)
    expect(relationships[0].status).toBe('active')
    expect(relationships[0].provider_npi).toBe(providerNpi)
    expect(relationships[0].patient_public_key).toBe(publicKeyBase64url)
  })

  it('should return existing relationship without challenge-response', async () => {
    // Pre-create an active relationship
    const now = new Date().toISOString()
    relationshipStore.create({
      relationship_id: 'existing-rel-001',
      patient_agent_id: 'patient-002',
      provider_npi: providerNpi,
      status: 'active',
      consented_actions: ['office_visit'],
      patient_public_key: publicKeyBase64url,
      created_at: now,
      updated_at: now,
    })

    const ws = await connectAndWaitOpen(serverPort)
    const closePromise = waitForClose(ws)

    // Send handshake.auth with matching consent
    const token = signConsentToken(validClaims('patient-002', providerNpi), privateKey)
    sendAuthMessage(ws, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-002',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Should receive handshake.complete directly (no challenge)
    const complete = await receiveMessage(ws)
    expect(complete.type).toBe('handshake.complete')
    expect(complete.relationship_id).toBe('existing-rel-001')
    expect(complete.status).toBe('existing')

    const closeResult = await closePromise
    expect(closeResult.code).toBe(1000)
  })

  it('should close connection with AUTH_TIMEOUT when no message is sent', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    // Receive error after authTimeoutMs (500ms in test config)
    const error = await receiveMessage(ws)
    expect(error.type).toBe('handshake.error')
    expect(error.code).toBe('AUTH_TIMEOUT')

    const closeResult = await waitForClose(ws)
    expect(closeResult.code).toBe(4001)
  })

  it('should reject invalid JSON message with INVALID_MESSAGE', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    ws.send('not json {{{')

    const error = await receiveMessage(ws)
    expect(error.type).toBe('handshake.error')
    expect(error.code).toBe('INVALID_MESSAGE')
    expect(error.message).toContain('not valid JSON')

    const closeResult = await waitForClose(ws)
    expect(closeResult.code).toBe(4002)
  })

  it('should reject binary frames with INVALID_MESSAGE', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    // Send a binary frame
    ws.send(Buffer.from([0x01, 0x02, 0x03]))

    const error = await receiveMessage(ws)
    expect(error.type).toBe('handshake.error')
    expect(error.code).toBe('INVALID_MESSAGE')
    expect(error.message).toContain('Binary frames')

    const closeResult = await waitForClose(ws)
    expect(closeResult.code).toBe(4002)
  })

  it('should reject tampered consent token signature with CONSENT_FAILED', async () => {
    // Generate a DIFFERENT key pair (tampered -- signed with wrong key)
    const { privateKey: wrongKey } = generateKeyPairSync('ed25519')

    const ws = await connectAndWaitOpen(serverPort)

    // Sign consent token with wrong private key but present original public key
    const claims = validClaims('patient-003', providerNpi)
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    const wrongSignature = sign(null, payload, wrongKey)

    sendAuthMessage(ws, {
      consentTokenPayload: payload.toString('base64url'),
      consentTokenSignature: wrongSignature.toString('base64url'),
      patientAgentId: 'patient-003',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Early consent verification catches the wrong signature
    const error = await receiveMessage(ws)
    expect(error.type).toBe('handshake.error')
    expect(error.code).toBe('CONSENT_FAILED')

    const closeResult = await waitForClose(ws)
    expect(closeResult.code).toBe(4003)
  })

  it('should reject expired consent token with CONSENT_FAILED', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    // Create token with expired claims
    const expiredClaims = {
      patient_agent_id: 'patient-004',
      provider_npi: providerNpi,
      consented_actions: ['office_visit'],
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
    }
    const token = signConsentToken(expiredClaims, privateKey)

    sendAuthMessage(ws, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-004',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Early consent verification catches the expiration
    const error = await receiveMessage(ws)
    expect(error.type).toBe('handshake.error')
    expect(error.code).toBe('CONSENT_FAILED')

    const closeResult = await waitForClose(ws)
    expect(closeResult.code).toBe(4003)
  })

  it('should queue connections beyond maxConcurrentHandshakes and process when slots open', async () => {
    // maxConcurrentHandshakes is 2 in test config

    // Open 2 connections (fill ceiling) -- don't send auth yet, they stay as sessions
    const ws1 = await connectAndWaitOpen(serverPort)
    const ws2 = await connectAndWaitOpen(serverPort)

    // Wait a moment to ensure sessions are tracked
    await new Promise((r) => setTimeout(r, 50))

    // Open 3rd connection -- should be queued (not rejected)
    const ws3Promise = connectAndWaitOpen(serverPort)

    // Complete one of the first 2 handshakes to free a slot
    const token = signConsentToken(validClaims('patient-ceil-1', providerNpi), privateKey)
    sendAuthMessage(ws1, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-ceil-1',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Receive challenge and complete handshake for ws1
    const challenge = await receiveMessage(ws1)
    const nonceBuffer = Buffer.from(challenge.nonce as string, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)
    ws1.send(JSON.stringify({
      type: 'handshake.challenge_response',
      signed_nonce: signedNonce.toString('base64url'),
    }))

    // Wait for ws1 to complete and close
    await receiveMessage(ws1) // handshake.complete
    await waitForClose(ws1)

    // 3rd connection should now be promoted from queue and connect
    const ws3 = await ws3Promise

    // Verify ws3 is actually working by checking it gets an auth timeout
    // (proving it's a live upgraded WebSocket connection, not destroyed)
    const error3 = await receiveMessage(ws3)
    expect(error3.type).toBe('handshake.error')
    expect(error3.code).toBe('AUTH_TIMEOUT')

    // Clean up ws2
    ws2.close()
    await waitForClose(ws2)
    await waitForClose(ws3)
  })

  it('should close active connections with code 1001 on graceful shutdown', async () => {
    const ws = await connectAndWaitOpen(serverPort)
    const closePromise = waitForClose(ws)

    // Trigger graceful shutdown
    await server.stop()

    // Connection should receive close code 1001
    const closeResult = await closePromise
    expect(closeResult.code).toBe(1001)
  })

  it('should reject connection to wrong path', async () => {
    // Try to connect to a different path
    const result = await new Promise<{ error: Error | null; closed: boolean }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/wrong`)
      let gotError = false
      ws.on('error', (err) => {
        gotError = true
        resolve({ error: err, closed: false })
      })
      ws.on('close', () => {
        if (!gotError) {
          resolve({ error: null, closed: true })
        }
      })
      // Timeout safety
      setTimeout(() => resolve({ error: new Error('timeout'), closed: false }), 3000)
    })

    // Should either get an error or close (socket destroyed before upgrade completes)
    expect(result.error !== null || result.closed).toBe(true)
  })

  it('should report active sessions during handshake', async () => {
    // Before any connection
    expect(server.activeSessions()).toHaveLength(0)

    const ws = await connectAndWaitOpen(serverPort)

    // Send auth to transition session to authenticating -> challenged
    const token = signConsentToken(validClaims('patient-session-1', providerNpi), privateKey)
    sendAuthMessage(ws, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-session-1',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Receive challenge (session should be tracked now)
    await receiveMessage(ws)

    const sessions = server.activeSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    const session = sessions.find((s) => s.patientAgentId === 'patient-session-1')
    expect(session).toBeDefined()
    expect(session!.status).toBe('active')

    // Close connection to clean up
    ws.close()
    await waitForClose(ws)

    // After close, session should be removed
    // Small delay for cleanup
    await new Promise((r) => setTimeout(r, 50))
    const afterClose = server.activeSessions()
    expect(afterClose.find((s) => s.patientAgentId === 'patient-session-1')).toBeUndefined()
  })

  it('should emit audit events for handshake flow', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    const token = signConsentToken(validClaims('patient-audit-1', providerNpi), privateKey)
    sendAuthMessage(ws, {
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      patientAgentId: 'patient-audit-1',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    // Complete the handshake
    const challenge = await receiveMessage(ws)
    const nonceBuffer = Buffer.from(challenge.nonce as string, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    ws.send(JSON.stringify({
      type: 'handshake.challenge_response',
      signed_nonce: signedNonce.toString('base64url'),
    }))

    const complete = await receiveMessage(ws)
    expect(complete.type).toBe('handshake.complete')

    await waitForClose(ws)

    // Read audit log
    const { readFileSync } = await import('node:fs')
    const auditPath = join(tempDir, 'audit.jsonl')
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>)

    // Find connection events
    const handshakeStarted = entries.find((e) => e.action === 'connection.handshake_started')
    expect(handshakeStarted).toBeDefined()
    expect(handshakeStarted!.actor).toBe('patient-audit-1')
    expect(handshakeStarted!.category).toBe('connection')

    const handshakeCompleted = entries.find((e) => e.action === 'connection.handshake_completed')
    expect(handshakeCompleted).toBeDefined()
    expect(handshakeCompleted!.actor).toBe('patient-audit-1')

    const details = handshakeCompleted!.details as Record<string, unknown>
    expect(details.status).toBe('new')
    expect(details.provider_npi).toBe(providerNpi)
    expect(details.relationship_id).toBeDefined()
  })

  it('should emit audit event for auth timeout', async () => {
    const ws = await connectAndWaitOpen(serverPort)

    // Wait for auth timeout
    const error = await receiveMessage(ws)
    expect(error.code).toBe('AUTH_TIMEOUT')
    await waitForClose(ws)

    // Wait for audit flush
    await new Promise((r) => setTimeout(r, 50))

    // Read audit log
    const { readFileSync } = await import('node:fs')
    const auditPath = join(tempDir, 'audit.jsonl')
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>)

    const timeoutEvent = entries.find((e) => e.action === 'connection.timeout')
    expect(timeoutEvent).toBeDefined()
    expect(timeoutEvent!.category).toBe('connection')
  })

  it('should emit audit event for failed handshake', async () => {
    const { privateKey: wrongKey } = generateKeyPairSync('ed25519')

    const ws = await connectAndWaitOpen(serverPort)

    const claims = validClaims('patient-fail-audit', providerNpi)
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    const wrongSignature = sign(null, payload, wrongKey)

    sendAuthMessage(ws, {
      consentTokenPayload: payload.toString('base64url'),
      consentTokenSignature: wrongSignature.toString('base64url'),
      patientAgentId: 'patient-fail-audit',
      patientPublicKey: publicKeyBase64url,
      patientEndpoint: 'http://patient.local/ws',
    })

    const error = await receiveMessage(ws)
    expect(error.code).toBe('CONSENT_FAILED')
    await waitForClose(ws)

    await new Promise((r) => setTimeout(r, 50))

    const { readFileSync } = await import('node:fs')
    const auditPath = join(tempDir, 'audit.jsonl')
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>)

    // handshake_started should be emitted (happens after auth parse, before consent verify)
    const started = entries.find(
      (e) => e.action === 'connection.handshake_started' &&
        (e as Record<string, unknown>).actor === 'patient-fail-audit',
    )
    expect(started).toBeDefined()

    // handshake_failed should be emitted for early consent verification failure
    const failed = entries.find(
      (e) => e.action === 'connection.handshake_failed' &&
        (e as Record<string, unknown>).actor === 'patient-fail-audit',
    )
    expect(failed).toBeDefined()
  })
})
