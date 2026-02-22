import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { SqliteStorage } from '../storage/sqlite.js'
import { RelationshipStore } from './store.js'
import { ConsentHandshakeHandler } from './handshake.js'
import { ConsentError } from '../consent/errors.js'
import type { RelationshipRecord } from '../types/relationship.js'

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

describe('RelationshipStore', () => {
  let storage: SqliteStorage
  let store: RelationshipStore

  const now = new Date().toISOString()

  function makeRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
    return {
      relationship_id: 'rel-001',
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      status: 'active',
      consented_actions: ['office_visit', 'lab_results'],
      patient_public_key: 'test-key-base64url',
      created_at: now,
      updated_at: now,
      ...overrides,
    }
  }

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
    store = new RelationshipStore(storage)
  })

  it('should create and findById round-trip', () => {
    const record = makeRecord()
    store.create(record)

    const found = store.findById('rel-001')
    expect(found).toBeDefined()
    expect(found!.relationship_id).toBe('rel-001')
    expect(found!.patient_agent_id).toBe('patient-001')
    expect(found!.provider_npi).toBe('1234567893')
    expect(found!.status).toBe('active')
    expect(found!.patient_public_key).toBe('test-key-base64url')
    expect(found!.created_at).toBe(now)
    expect(found!.updated_at).toBe(now)
  })

  it('should findByPatient and return matching records', () => {
    store.create(makeRecord({ relationship_id: 'rel-001', patient_agent_id: 'patient-A' }))
    store.create(makeRecord({ relationship_id: 'rel-002', patient_agent_id: 'patient-A' }))
    store.create(makeRecord({ relationship_id: 'rel-003', patient_agent_id: 'patient-B' }))

    const results = store.findByPatient('patient-A')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.relationship_id)).toEqual(['rel-001', 'rel-002'])
  })

  it('should findByProvider and return matching records', () => {
    store.create(makeRecord({ relationship_id: 'rel-001', provider_npi: '1111111111' }))
    store.create(makeRecord({ relationship_id: 'rel-002', provider_npi: '1111111111' }))
    store.create(makeRecord({ relationship_id: 'rel-003', provider_npi: '2222222222' }))

    const results = store.findByProvider('1111111111')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.relationship_id)).toEqual(['rel-001', 'rel-002'])
  })

  it('should findByStatus and return matching records', () => {
    store.create(makeRecord({ relationship_id: 'rel-001', status: 'active' }))
    store.create(makeRecord({ relationship_id: 'rel-002', status: 'pending' }))
    store.create(makeRecord({ relationship_id: 'rel-003', status: 'active' }))

    const results = store.findByStatus('active')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.relationship_id)).toEqual(['rel-001', 'rel-003'])
  })

  it('should updateStatus and change the status', () => {
    store.create(makeRecord({ relationship_id: 'rel-001', status: 'pending' }))

    store.updateStatus('rel-001', 'active')

    const found = store.findById('rel-001')
    expect(found!.status).toBe('active')
  })

  it('should reject updateStatus on a terminated relationship', () => {
    store.create(makeRecord({ relationship_id: 'rel-001', status: 'terminated' }))

    expect(() => store.updateStatus('rel-001', 'active')).toThrow(
      'Cannot update status of a terminated relationship',
    )
  })

  it('should return undefined for nonexistent findById', () => {
    const found = store.findById('nonexistent')
    expect(found).toBeUndefined()
  })

  it('should serialize and deserialize consented_actions correctly as JSON array', () => {
    const actions = ['read:records', 'write:notes', 'schedule:appointments', '']
    store.create(makeRecord({ consented_actions: actions }))

    const found = store.findById('rel-001')
    expect(found!.consented_actions).toEqual(actions)
    expect(Array.isArray(found!.consented_actions)).toBe(true)
  })
})

describe('ConsentHandshakeHandler', () => {
  let storage: SqliteStorage
  let store: RelationshipStore
  let handler: ConsentHandshakeHandler
  const orgNpi = '9999999999'

  const { privateKey, publicKeyBase64url } = makeTestKeyPair()

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
    store = new RelationshipStore(storage)
    handler = new ConsentHandshakeHandler(store, orgNpi)
  })

  /** Helper: create valid consent claims */
  function validClaims(providerNpi: string): Record<string, unknown> {
    return {
      patient_agent_id: 'patient-001',
      provider_npi: providerNpi,
      consented_actions: ['office_visit', 'lab_results'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
  }

  it('should complete a full handshake flow and create an active relationship', () => {
    const init = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      patient_public_key: publicKeyBase64url,
    }

    // Step 1: Start handshake
    const challenge = handler.startHandshake(init)
    expect(challenge.nonce).toBeDefined()
    expect(challenge.nonce).toHaveLength(64) // 32 bytes hex
    expect(challenge.provider_npi).toBe('1234567893')
    expect(challenge.organization_npi).toBe(orgNpi)

    // Step 2: Sign the nonce (patient side)
    const nonceBuffer = Buffer.from(challenge.nonce, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    // Step 3: Create consent token (patient side)
    const claims = validClaims('1234567893')
    const token = signConsentToken(claims, privateKey)

    // Step 4: Complete handshake
    const relationshipId = handler.completeHandshake(challenge.nonce, {
      signed_nonce: signedNonce.toString('base64url'),
      consent_token_payload: token.payload,
      consent_token_signature: token.signature,
    })

    expect(relationshipId).toBeDefined()
    expect(typeof relationshipId).toBe('string')

    // Step 5: Verify relationship was persisted
    const record = store.findById(relationshipId)
    expect(record).toBeDefined()
    expect(record!.status).toBe('active')
    expect(record!.patient_agent_id).toBe('patient-001')
    expect(record!.provider_npi).toBe('1234567893')
    expect(record!.consented_actions).toEqual(['office_visit', 'lab_results'])
    expect(record!.patient_public_key).toBe(publicKeyBase64url)
  })

  it('should reject an expired challenge nonce with CONSENT_EXPIRED', () => {
    const init = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      patient_public_key: publicKeyBase64url,
    }

    const challenge = handler.startHandshake(init)

    // Simulate time passing beyond 30s TTL
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31_000)

    const nonceBuffer = Buffer.from(challenge.nonce, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)
    const token = signConsentToken(validClaims('1234567893'), privateKey)

    expect(() =>
      handler.completeHandshake(challenge.nonce, {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      }),
    ).toThrow(ConsentError)

    try {
      // Re-start to get a fresh nonce for the error check
      const challenge2 = handler.startHandshake(init)
      vi.setSystemTime(Date.now() + 31_000)
      handler.completeHandshake(challenge2.nonce, {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ConsentError)
      expect((err as ConsentError).code).toBe('CONSENT_EXPIRED')
    }

    vi.useRealTimers()
  })

  it('should reject an unknown nonce with MALFORMED_TOKEN', () => {
    const nonceBuffer = Buffer.from('a'.repeat(64), 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)
    const token = signConsentToken(validClaims('1234567893'), privateKey)

    expect(() =>
      handler.completeHandshake('unknown-nonce', {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      }),
    ).toThrow(ConsentError)

    try {
      handler.completeHandshake('unknown-nonce-2', {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ConsentError)
      expect((err as ConsentError).code).toBe('MALFORMED_TOKEN')
    }
  })

  it('should reject an invalid challenge signature with INVALID_SIGNATURE', () => {
    const init = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      patient_public_key: publicKeyBase64url,
    }

    const challenge = handler.startHandshake(init)

    // Sign the wrong data (not the nonce)
    const wrongData = Buffer.from('wrong-data', 'utf-8')
    const badSignature = sign(null, wrongData, privateKey)
    const token = signConsentToken(validClaims('1234567893'), privateKey)

    expect(() =>
      handler.completeHandshake(challenge.nonce, {
        signed_nonce: badSignature.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      }),
    ).toThrow(ConsentError)

    // Verify the error code
    const challenge2 = handler.startHandshake(init)
    try {
      handler.completeHandshake(challenge2.nonce, {
        signed_nonce: badSignature.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ConsentError)
      expect((err as ConsentError).code).toBe('INVALID_SIGNATURE')
    }
  })

  it('should reject provider NPI mismatch between token and init with MALFORMED_TOKEN', () => {
    const init = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      patient_public_key: publicKeyBase64url,
    }

    const challenge = handler.startHandshake(init)

    const nonceBuffer = Buffer.from(challenge.nonce, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    // Create token with different provider NPI
    const token = signConsentToken(validClaims('9876543210'), privateKey)

    expect(() =>
      handler.completeHandshake(challenge.nonce, {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      }),
    ).toThrow(ConsentError)

    // Verify the error code
    const challenge2 = handler.startHandshake(init)
    const nonceBuffer2 = Buffer.from(challenge2.nonce, 'hex')
    const signedNonce2 = sign(null, nonceBuffer2, privateKey)
    try {
      handler.completeHandshake(challenge2.nonce, {
        signed_nonce: signedNonce2.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ConsentError)
      expect((err as ConsentError).code).toBe('MALFORMED_TOKEN')
    }
  })

  it('should clean up expired challenges from the pending map', () => {
    const init = {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      patient_public_key: publicKeyBase64url,
    }

    vi.useFakeTimers()

    // Create a challenge
    const challenge1 = handler.startHandshake(init)

    // Advance time past 30s TTL
    vi.setSystemTime(Date.now() + 31_000)

    // Start a new handshake (triggers cleanup)
    handler.startHandshake(init)

    // The expired challenge should no longer be usable
    const nonceBuffer = Buffer.from(challenge1.nonce, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)
    const token = signConsentToken(validClaims('1234567893'), privateKey)

    expect(() =>
      handler.completeHandshake(challenge1.nonce, {
        signed_nonce: signedNonce.toString('base64url'),
        consent_token_payload: token.payload,
        consent_token_signature: token.signature,
      }),
    ).toThrow(ConsentError)

    vi.useRealTimers()
  })
})
