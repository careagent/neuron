import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { SqliteStorage } from '../../src/storage/sqlite.js'
import { ConsentBroker, type ConsentRequestMessage } from '../../src/consent/broker.js'
import type { WebSocket } from 'ws'

/** Create a mock WebSocket for testing */
function createMockWs(): WebSocket & {
  sentMessages: string[]
  closeCode: number | null
  closeReason: string | null
  messageHandlers: Array<(data: Buffer, isBinary: boolean) => void>
} {
  const sentMessages: string[] = []
  let closeCode: number | null = null
  let closeReason: string | null = null
  const messageHandlers: Array<(data: Buffer, isBinary: boolean) => void> = []

  const ws = {
    sentMessages,
    closeCode,
    closeReason,
    messageHandlers,
    send: vi.fn((data: string) => {
      sentMessages.push(data)
    }),
    close: vi.fn((code: number, reason: string) => {
      ws.closeCode = code
      ws.closeReason = reason
    }),
    once: vi.fn((event: string, handler: (data: Buffer, isBinary: boolean) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler)
      }
    }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    readyState: 1,
  } as unknown as WebSocket & {
    sentMessages: string[]
    closeCode: number | null
    closeReason: string | null
    messageHandlers: Array<(data: Buffer, isBinary: boolean) => void>
  }

  return ws
}

describe('ConsentBroker', () => {
  let storage: SqliteStorage
  const neuronKeys = generateKeyPairSync('ed25519')
  const patientKeys = generateKeyPairSync('ed25519')
  const patientJwk = patientKeys.publicKey.export({ format: 'jwk' })
  const patientPublicKeyBase64url = patientJwk.x!

  function makeConsentToken() {
    const claims = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      consented_actions: ['office_visit', 'lab_results'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    const signature = sign(null, payload, patientKeys.privateKey)
    return {
      payload: payload.toString('base64url'),
      signature: signature.toString('base64url'),
    }
  }

  function makeConsentRequest(overrides: Partial<ConsentRequestMessage> = {}): ConsentRequestMessage {
    const token = makeConsentToken()
    return {
      type: 'consent.request',
      patientAgentId: 'patient-001',
      patientPublicKey: patientPublicKeyBase64url,
      providerPublicKey: 'provider-public-key-abc',
      consentTokenPayload: token.payload,
      consentTokenSignature: token.signature,
      scope: ['office_visit', 'lab_results'],
      expiresAt: Date.now() + 3600_000,
      ...overrides,
    }
  }

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
  })

  describe('handleConsentRequest', () => {
    it('should send a challenge nonce in response to a valid request', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      expect(ws.sentMessages).toHaveLength(1)
      const challengeMsg = JSON.parse(ws.sentMessages[0])
      expect(challengeMsg.type).toBe('consent.challenge')
      expect(challengeMsg.nonce).toBeTruthy()
      expect(challengeMsg.nonce).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should reject invalid consent token with error message', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest({
        consentTokenSignature: 'invalid-base64url-signature',
      })

      broker.handleConsentRequest(ws, request)

      expect(ws.sentMessages).toHaveLength(1)
      const errorMsg = JSON.parse(ws.sentMessages[0])
      expect(errorMsg.type).toBe('consent.error')
      expect(ws.closeCode).toBe(4003)
    })

    it('should complete full flow with valid challenge response', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      // Extract nonce from challenge
      const challengeMsg = JSON.parse(ws.sentMessages[0])
      const nonce = challengeMsg.nonce

      // Sign the nonce with patient's private key
      const nonceBuffer = Buffer.from(nonce, 'hex')
      const signedNonce = sign(null, nonceBuffer, patientKeys.privateKey)

      // Simulate the patient's challenge response
      const responseMsg = JSON.stringify({
        type: 'consent.challenge_response',
        signedNonce: signedNonce.toString('base64url'),
      })

      // Trigger the message handler
      expect(ws.messageHandlers).toHaveLength(1)
      ws.messageHandlers[0](Buffer.from(responseMsg), false)

      // Should have: challenge + complete messages
      expect(ws.sentMessages).toHaveLength(2)
      const completeMsg = JSON.parse(ws.sentMessages[1])
      expect(completeMsg.type).toBe('consent.complete')
      expect(completeMsg.relationshipId).toBeTruthy()
      expect(completeMsg.status).toBe('pending')
      expect(ws.closeCode).toBe(1000)
    })

    it('should create a relationship record after successful handshake', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      const challengeMsg = JSON.parse(ws.sentMessages[0])
      const nonce = challengeMsg.nonce
      const nonceBuffer = Buffer.from(nonce, 'hex')
      const signedNonce = sign(null, nonceBuffer, patientKeys.privateKey)

      const responseMsg = JSON.stringify({
        type: 'consent.challenge_response',
        signedNonce: signedNonce.toString('base64url'),
      })
      ws.messageHandlers[0](Buffer.from(responseMsg), false)

      const completeMsg = JSON.parse(ws.sentMessages[1])
      const relationship = broker.getRelationship(completeMsg.relationshipId)
      expect(relationship).toBeDefined()
      expect(relationship!.status).toBe('pending')
      expect(relationship!.patientPublicKey).toBe(patientPublicKeyBase64url)
      expect(relationship!.providerPublicKey).toBe('provider-public-key-abc')
      expect(relationship!.scope).toEqual(['office_visit', 'lab_results'])
    })

    it('should write consent.created audit entry after successful handshake', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      const challengeMsg = JSON.parse(ws.sentMessages[0])
      const nonce = challengeMsg.nonce
      const nonceBuffer = Buffer.from(nonce, 'hex')
      const signedNonce = sign(null, nonceBuffer, patientKeys.privateKey)

      const responseMsg = JSON.stringify({
        type: 'consent.challenge_response',
        signedNonce: signedNonce.toString('base64url'),
      })
      ws.messageHandlers[0](Buffer.from(responseMsg), false)

      const completeMsg = JSON.parse(ws.sentMessages[1])
      const auditEntries = broker.getAuditLog(completeMsg.relationshipId)
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].action).toBe('consent.created')
      expect(auditEntries[0].actorPublicKey).toBe(patientPublicKeyBase64url)
    })

    it('should reject binary frames', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      // Simulate binary message
      ws.messageHandlers[0](Buffer.from('binary data'), true)

      expect(ws.sentMessages).toHaveLength(2) // challenge + error
      const errorMsg = JSON.parse(ws.sentMessages[1])
      expect(errorMsg.type).toBe('consent.error')
      expect(errorMsg.code).toBe('INVALID_MESSAGE')
      expect(ws.closeCode).toBe(4002)
    })

    it('should reject invalid challenge response signature', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const ws = createMockWs()
      const request = makeConsentRequest()

      broker.handleConsentRequest(ws, request)

      // Send a response with a wrong signature
      const responseMsg = JSON.stringify({
        type: 'consent.challenge_response',
        signedNonce: Buffer.from('not-a-real-signature-at-all-needs-64-bytes-total-padding-here!!').toString('base64url'),
      })
      ws.messageHandlers[0](Buffer.from(responseMsg), false)

      expect(ws.sentMessages).toHaveLength(2) // challenge + error
      const errorMsg = JSON.parse(ws.sentMessages[1])
      expect(errorMsg.type).toBe('consent.error')
      expect(errorMsg.code).toBe('INVALID_SIGNATURE')
    })
  })

  describe('revokeConsent', () => {
    it('should revoke an active relationship and write audit entry', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      // Create a relationship directly
      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'active',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      const updated = broker.revokeConsent('rel-1', 'patient-key')
      expect(updated.status).toBe('revoked')

      const auditEntries = broker.getAuditLog('rel-1')
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].action).toBe('consent.revoked')
      expect(auditEntries[0].actorPublicKey).toBe('patient-key')
    })

    it('should throw for nonexistent relationship', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      expect(() => broker.revokeConsent('nonexistent', 'key')).toThrow('not found')
    })

    it('should throw for invalid status transition', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      expect(() => broker.revokeConsent('rel-1', 'key')).toThrow('Invalid status transition')
    })
  })

  describe('activateConsent', () => {
    it('should activate a pending relationship and write audit entry', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      const updated = broker.activateConsent('rel-1', 'provider-key')
      expect(updated.status).toBe('active')

      const auditEntries = broker.getAuditLog('rel-1')
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].action).toBe('consent.activated')
      expect(auditEntries[0].actorPublicKey).toBe('provider-key')
    })

    it('should throw for nonexistent relationship', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      expect(() => broker.activateConsent('nonexistent', 'key')).toThrow('not found')
    })
  })

  describe('expireStaleConsents', () => {
    it('should expire stale consents and write audit entries for each', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)
      const pastExpiry = Date.now() - 1000

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key-1', 'provider-key', '["office_visit"]', 'active',
         'token', Date.now(), Date.now(), pastExpiry],
      )
      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-2', 'patient-key-2', 'provider-key', '["lab_results"]', 'active',
         'token', Date.now(), Date.now(), pastExpiry],
      )

      const count = broker.expireStaleConsents()
      expect(count).toBe(2)

      const audit1 = broker.getAuditLog('rel-1')
      expect(audit1).toHaveLength(1)
      expect(audit1[0].action).toBe('consent.expired')

      const audit2 = broker.getAuditLog('rel-2')
      expect(audit2).toHaveLength(1)
      expect(audit2[0].action).toBe('consent.expired')
    })

    it('should not expire relationships with future expiresAt', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'active',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      const count = broker.expireStaleConsents()
      expect(count).toBe(0)
    })
  })

  describe('getAuditLog', () => {
    it('should return audit entries for a relationship', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      // Create relationship and trigger some audited actions
      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      broker.activateConsent('rel-1', 'provider-key')
      broker.revokeConsent('rel-1', 'patient-key')

      const entries = broker.getAuditLog('rel-1')
      expect(entries).toHaveLength(2)
      expect(entries[0].action).toBe('consent.activated')
      expect(entries[1].action).toBe('consent.revoked')
    })
  })

  describe('verifyAuditChain', () => {
    it('should verify chain integrity for a relationship', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      broker.activateConsent('rel-1', 'provider-key')

      const result = broker.verifyAuditChain('rel-1')
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(1)
    })

    it('should return valid for empty audit trail', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      const result = broker.verifyAuditChain('nonexistent')
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(0)
    })
  })

  describe('verifyGlobalAuditChain', () => {
    it('should verify the entire global chain across relationships', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-1', 'patient-key-1', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )
      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-2', 'patient-key-2', 'provider-key', '["lab_results"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      broker.activateConsent('rel-1', 'provider-key')
      broker.activateConsent('rel-2', 'provider-key')

      const result = broker.verifyGlobalAuditChain()
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(2)
    })
  })

  describe('full lifecycle flow', () => {
    it('should track complete consent lifecycle: created → activated → revoked', () => {
      const broker = new ConsentBroker(storage, neuronKeys.privateKey, neuronKeys.publicKey)

      // Create relationship
      storage.run(
        `INSERT INTO consent_relationships
          (id, patient_public_key, provider_public_key, scope, status,
           consent_token, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['rel-lifecycle', 'patient-key', 'provider-key', '["office_visit"]', 'pending',
         'token', Date.now(), Date.now(), Date.now() + 3600_000],
      )

      // Activate
      broker.activateConsent('rel-lifecycle', 'provider-key')

      // Revoke
      broker.revokeConsent('rel-lifecycle', 'patient-key')

      // Check full audit trail
      const entries = broker.getAuditLog('rel-lifecycle')
      expect(entries).toHaveLength(2)
      expect(entries[0].action).toBe('consent.activated')
      expect(entries[1].action).toBe('consent.revoked')

      // Verify chain
      const verification = broker.verifyAuditChain('rel-lifecycle')
      expect(verification.valid).toBe(true)
      expect(verification.entries).toBe(2)

      // Verify global chain
      const globalVerification = broker.verifyGlobalAuditChain()
      expect(globalVerification.valid).toBe(true)
    })
  })
})
