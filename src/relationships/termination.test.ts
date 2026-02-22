import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteStorage } from '../storage/sqlite.js'
import { RelationshipStore } from './store.js'
import { TerminationHandler } from './termination.js'
import { ConsentHandshakeHandler } from './handshake.js'
import { AuditLogger } from '../audit/logger.js'
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

describe('TerminationHandler', () => {
  let storage: SqliteStorage
  let store: RelationshipStore
  let handler: TerminationHandler
  let auditLogger: AuditLogger
  let tmpDir: string

  const now = new Date().toISOString()
  const providerNpi = '1234567893'

  function makeRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
    return {
      relationship_id: 'rel-001',
      patient_agent_id: 'patient-001',
      provider_npi: providerNpi,
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

    tmpDir = mkdtempSync(join(tmpdir(), 'neuron-term-test-'))
    auditLogger = new AuditLogger(join(tmpDir, 'audit.jsonl'))

    handler = new TerminationHandler(storage, store, auditLogger)

    // Create an active relationship for most tests
    store.create(makeRecord())
  })

  it('should terminate an active relationship with status, record, and audit entry', () => {
    handler.terminate('rel-001', providerNpi, 'Patient transferred to another provider')

    // Verify relationship status is terminated
    const relationship = store.findById('rel-001')
    expect(relationship).toBeDefined()
    expect(relationship!.status).toBe('terminated')

    // Verify termination_records table has an entry
    const termRecord = storage.get<{
      termination_id: string
      relationship_id: string
      provider_npi: string
      reason: string
      terminated_at: string
      audit_entry_sequence: number | null
    }>('SELECT * FROM termination_records WHERE relationship_id = ?', ['rel-001'])
    expect(termRecord).toBeDefined()
    expect(termRecord!.relationship_id).toBe('rel-001')
    expect(termRecord!.provider_npi).toBe(providerNpi)
    expect(termRecord!.reason).toBe('Patient transferred to another provider')
    expect(termRecord!.terminated_at).toBeDefined()
    expect(termRecord!.audit_entry_sequence).toBe(1)
  })

  it('should reject termination of an already terminated relationship', () => {
    handler.terminate('rel-001', providerNpi, 'First termination')

    expect(() =>
      handler.terminate('rel-001', providerNpi, 'Second termination'),
    ).toThrow('already terminated')
  })

  it('should reject termination with wrong provider NPI', () => {
    expect(() =>
      handler.terminate('rel-001', '9999999999', 'Wrong provider'),
    ).toThrow('does not match')
  })

  it('should reject termination of a nonexistent relationship', () => {
    expect(() =>
      handler.terminate('nonexistent-id', providerNpi, 'Does not exist'),
    ).toThrow('not found')
  })

  it('should maintain atomicity: failed termination leaves status unchanged', () => {
    // Attempt termination with wrong NPI (should fail at validation step)
    expect(() =>
      handler.terminate('rel-001', '9999999999', 'Wrong provider'),
    ).toThrow('does not match')

    // Relationship should still be active
    const relationship = store.findById('rel-001')
    expect(relationship!.status).toBe('active')

    // No termination record should exist
    const termRecord = storage.get<{ termination_id: string }>(
      'SELECT * FROM termination_records WHERE relationship_id = ?',
      ['rel-001'],
    )
    expect(termRecord).toBeUndefined()
  })

  it('should reject status updates on terminated relationship via store', () => {
    handler.terminate('rel-001', providerNpi, 'Terminating')

    // Store-level TERM-04 enforcement
    expect(() => store.updateStatus('rel-001', 'active')).toThrow(
      'Cannot update status of a terminated relationship',
    )
  })

  it('should allow new handshake after termination creating a new relationship', () => {
    const { privateKey, publicKeyBase64url } = makeTestKeyPair()
    const orgNpi = '9999999999'

    // Create a relationship using store directly (with proper public key)
    const existingRelId = 'rel-existing'
    store.create(makeRecord({
      relationship_id: existingRelId,
      patient_agent_id: 'patient-handshake',
      provider_npi: providerNpi,
      patient_public_key: publicKeyBase64url,
    }))

    // Terminate the existing relationship
    handler.terminate(existingRelId, providerNpi, 'Terminating for re-establishment test')

    // Verify it is terminated
    const terminated = store.findById(existingRelId)
    expect(terminated!.status).toBe('terminated')

    // Create a new relationship via handshake for the same patient-provider pair
    const handshakeHandler = new ConsentHandshakeHandler(store, orgNpi)

    const init = {
      patient_agent_id: 'patient-handshake',
      provider_npi: providerNpi,
      patient_public_key: publicKeyBase64url,
    }

    // Start handshake
    const challenge = handshakeHandler.startHandshake(init)

    // Sign the nonce
    const nonceBuffer = Buffer.from(challenge.nonce, 'hex')
    const signedNonce = sign(null, nonceBuffer, privateKey)

    // Create consent token
    const claims = {
      patient_agent_id: 'patient-handshake',
      provider_npi: providerNpi,
      consented_actions: ['office_visit'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const token = signConsentToken(claims, privateKey)

    // Complete handshake
    const newRelId = handshakeHandler.completeHandshake(challenge.nonce, {
      signed_nonce: signedNonce.toString('base64url'),
      consent_token_payload: token.payload,
      consent_token_signature: token.signature,
    })

    // Verify new relationship has different ID and is active
    expect(newRelId).not.toBe(existingRelId)

    const newRel = store.findById(newRelId)
    expect(newRel).toBeDefined()
    expect(newRel!.status).toBe('active')
    expect(newRel!.patient_agent_id).toBe('patient-handshake')
    expect(newRel!.provider_npi).toBe(providerNpi)

    // Verify old relationship is still terminated
    const oldRel = store.findById(existingRelId)
    expect(oldRel!.status).toBe('terminated')
  })
})
