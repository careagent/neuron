import { describe, it, expect, beforeEach } from 'vitest'
import { SqliteStorage } from '../storage/sqlite.js'
import { ConsentRelationshipStore } from './relationship-store.js'
import { validateTransition, VALID_TRANSITIONS } from './relationship-schemas.js'

describe('ConsentRelationshipStore', () => {
  let storage: SqliteStorage
  let store: ConsentRelationshipStore

  const baseRelationship = {
    patientPublicKey: 'abc123def456patient',
    providerPublicKey: 'abc123def456provider',
    scope: ['office_visit', 'lab_results'],
    consentToken: 'eyJhbGciOiJFZERTQSJ9.test-token',
    expiresAt: Date.now() + 3600_000,
  }

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
    store = new ConsentRelationshipStore(storage)
  })

  describe('create', () => {
    it('should create a relationship with status pending', () => {
      const result = store.create(baseRelationship)

      expect(result.id).toBeDefined()
      expect(result.status).toBe('pending')
      expect(result.patientPublicKey).toBe(baseRelationship.patientPublicKey)
      expect(result.providerPublicKey).toBe(baseRelationship.providerPublicKey)
      expect(result.scope).toEqual(['office_visit', 'lab_results'])
      expect(result.consentToken).toBe(baseRelationship.consentToken)
      expect(result.createdAt).toBeTypeOf('number')
      expect(result.updatedAt).toBeTypeOf('number')
      expect(result.expiresAt).toBe(baseRelationship.expiresAt)
    })

    it('should generate a UUID if none provided', () => {
      const result = store.create(baseRelationship)
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    })

    it('should use a provided id', () => {
      const result = store.create({ ...baseRelationship, id: 'custom-id-001' })
      expect(result.id).toBe('custom-id-001')
    })

    it('should set createdAt and updatedAt to current time', () => {
      const before = Date.now()
      const result = store.create(baseRelationship)
      const after = Date.now()

      expect(result.createdAt).toBeGreaterThanOrEqual(before)
      expect(result.createdAt).toBeLessThanOrEqual(after)
      expect(result.updatedAt).toBe(result.createdAt)
    })
  })

  describe('getById', () => {
    it('should retrieve a created relationship by ID', () => {
      const created = store.create(baseRelationship)
      const found = store.getById(created.id)

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.patientPublicKey).toBe(baseRelationship.patientPublicKey)
      expect(found!.providerPublicKey).toBe(baseRelationship.providerPublicKey)
      expect(found!.scope).toEqual(['office_visit', 'lab_results'])
      expect(found!.status).toBe('pending')
      expect(found!.consentToken).toBe(baseRelationship.consentToken)
      expect(found!.expiresAt).toBe(baseRelationship.expiresAt)
    })

    it('should return undefined for nonexistent ID', () => {
      const found = store.getById('nonexistent-id')
      expect(found).toBeUndefined()
    })

    it('should correctly deserialize scope from JSON', () => {
      const complex = ['read:records', 'write:notes', 'schedule:appointments']
      const created = store.create({ ...baseRelationship, scope: complex })
      const found = store.getById(created.id)

      expect(found!.scope).toEqual(complex)
      expect(Array.isArray(found!.scope)).toBe(true)
    })
  })

  describe('getByPatient', () => {
    it('should return all relationships for a patient', () => {
      store.create({ ...baseRelationship, patientPublicKey: 'patient-A' })
      store.create({ ...baseRelationship, patientPublicKey: 'patient-A' })
      store.create({ ...baseRelationship, patientPublicKey: 'patient-B' })

      const results = store.getByPatient('patient-A')
      expect(results).toHaveLength(2)
      results.forEach((r) => expect(r.patientPublicKey).toBe('patient-A'))
    })

    it('should return empty array for nonexistent patient', () => {
      const results = store.getByPatient('nonexistent')
      expect(results).toEqual([])
    })
  })

  describe('getByProvider', () => {
    it('should return all relationships for a provider', () => {
      store.create({ ...baseRelationship, providerPublicKey: 'provider-X' })
      store.create({ ...baseRelationship, providerPublicKey: 'provider-X' })
      store.create({ ...baseRelationship, providerPublicKey: 'provider-Y' })

      const results = store.getByProvider('provider-X')
      expect(results).toHaveLength(2)
      results.forEach((r) => expect(r.providerPublicKey).toBe('provider-X'))
    })

    it('should return empty array for nonexistent provider', () => {
      const results = store.getByProvider('nonexistent')
      expect(results).toEqual([])
    })
  })

  describe('update', () => {
    it('should update status with valid transition pending → active', () => {
      const created = store.create(baseRelationship)
      const updated = store.update(created.id, { status: 'active' })

      expect(updated.status).toBe('active')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    })

    it('should update status with valid transition active → revoked', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      const revoked = store.update(created.id, { status: 'revoked' })

      expect(revoked.status).toBe('revoked')
    })

    it('should update status with valid transition active → expired', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      const expired = store.update(created.id, { status: 'expired' })

      expect(expired.status).toBe('expired')
    })

    it('should reject invalid transition pending → revoked', () => {
      const created = store.create(baseRelationship)
      expect(() => store.update(created.id, { status: 'revoked' })).toThrow(
        'Invalid status transition: pending → revoked',
      )
    })

    it('should reject invalid transition revoked → active', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      store.update(created.id, { status: 'revoked' })

      expect(() => store.update(created.id, { status: 'active' })).toThrow(
        'Invalid status transition: revoked → active',
      )
    })

    it('should reject invalid transition expired → active', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      store.update(created.id, { status: 'expired' })

      expect(() => store.update(created.id, { status: 'active' })).toThrow(
        'Invalid status transition: expired → active',
      )
    })

    it('should reject invalid transition pending → expired', () => {
      const created = store.create(baseRelationship)
      expect(() => store.update(created.id, { status: 'expired' })).toThrow(
        'Invalid status transition: pending → expired',
      )
    })

    it('should update scope', () => {
      const created = store.create(baseRelationship)
      const updated = store.update(created.id, {
        scope: ['new_action'],
      })

      expect(updated.scope).toEqual(['new_action'])
    })

    it('should update consentToken', () => {
      const created = store.create(baseRelationship)
      const updated = store.update(created.id, {
        consentToken: 'new-token-value',
      })

      expect(updated.consentToken).toBe('new-token-value')
    })

    it('should update expiresAt', () => {
      const created = store.create(baseRelationship)
      const newExpiry = Date.now() + 7200_000
      const updated = store.update(created.id, { expiresAt: newExpiry })

      expect(updated.expiresAt).toBe(newExpiry)
    })

    it('should throw for nonexistent relationship', () => {
      expect(() => store.update('nonexistent', { status: 'active' })).toThrow(
        'Consent relationship nonexistent not found',
      )
    })

    it('should allow same status update without error', () => {
      const created = store.create(baseRelationship)
      const updated = store.update(created.id, { status: 'pending' })
      expect(updated.status).toBe('pending')
    })

    it('should update updatedAt timestamp on every update', () => {
      const created = store.create(baseRelationship)
      const updated = store.update(created.id, { status: 'active' })

      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    })
  })

  describe('delete (soft delete)', () => {
    it('should set status to revoked for an active relationship', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })

      store.delete(created.id)

      const found = store.getById(created.id)
      expect(found).toBeDefined()
      expect(found!.status).toBe('revoked')
    })

    it('should not remove the row', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })

      store.delete(created.id)

      const found = store.getById(created.id)
      expect(found).toBeDefined()
    })

    it('should reject delete on a pending relationship', () => {
      const created = store.create(baseRelationship)
      expect(() => store.delete(created.id)).toThrow(
        'Invalid status transition: pending → revoked',
      )
    })

    it('should reject delete on an already revoked relationship', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      store.delete(created.id)

      expect(() => store.delete(created.id)).toThrow(
        'Invalid status transition: revoked → revoked',
      )
    })

    it('should reject delete on an expired relationship', () => {
      const created = store.create(baseRelationship)
      store.update(created.id, { status: 'active' })
      store.update(created.id, { status: 'expired' })

      expect(() => store.delete(created.id)).toThrow(
        'Invalid status transition: expired → revoked',
      )
    })
  })

  describe('expireStale', () => {
    it('should expire active relationships past their expiresAt', () => {
      const pastExpiry = Date.now() - 1000
      const rel = store.create({ ...baseRelationship, expiresAt: pastExpiry })
      store.update(rel.id, { status: 'active' })

      const count = store.expireStale()
      expect(count).toBe(1)

      const found = store.getById(rel.id)
      expect(found!.status).toBe('expired')
    })

    it('should not expire pending relationships', () => {
      const pastExpiry = Date.now() - 1000
      store.create({ ...baseRelationship, expiresAt: pastExpiry })

      const count = store.expireStale()
      expect(count).toBe(0)
    })

    it('should not expire relationships with future expiresAt', () => {
      const futureExpiry = Date.now() + 3600_000
      const rel = store.create({ ...baseRelationship, expiresAt: futureExpiry })
      store.update(rel.id, { status: 'active' })

      const count = store.expireStale()
      expect(count).toBe(0)

      const found = store.getById(rel.id)
      expect(found!.status).toBe('active')
    })

    it('should expire multiple stale relationships at once', () => {
      const pastExpiry = Date.now() - 1000
      const rel1 = store.create({ ...baseRelationship, expiresAt: pastExpiry })
      const rel2 = store.create({ ...baseRelationship, expiresAt: pastExpiry })
      const rel3 = store.create({
        ...baseRelationship,
        expiresAt: Date.now() + 3600_000,
      })
      store.update(rel1.id, { status: 'active' })
      store.update(rel2.id, { status: 'active' })
      store.update(rel3.id, { status: 'active' })

      const count = store.expireStale()
      expect(count).toBe(2)

      expect(store.getById(rel1.id)!.status).toBe('expired')
      expect(store.getById(rel2.id)!.status).toBe('expired')
      expect(store.getById(rel3.id)!.status).toBe('active')
    })

    it('should accept a custom timestamp for expiry check', () => {
      const futureExpiry = Date.now() + 3600_000
      const rel = store.create({ ...baseRelationship, expiresAt: futureExpiry })
      store.update(rel.id, { status: 'active' })

      // Simulate time far in the future
      const count = store.expireStale(futureExpiry + 1)
      expect(count).toBe(1)
      expect(store.getById(rel.id)!.status).toBe('expired')
    })

    it('should not touch already revoked or expired relationships', () => {
      const pastExpiry = Date.now() - 1000
      const rel1 = store.create({ ...baseRelationship, expiresAt: pastExpiry })
      const rel2 = store.create({ ...baseRelationship, expiresAt: pastExpiry })
      store.update(rel1.id, { status: 'active' })
      store.update(rel1.id, { status: 'revoked' })
      store.update(rel2.id, { status: 'active' })
      store.update(rel2.id, { status: 'expired' })

      const count = store.expireStale()
      expect(count).toBe(0)
    })
  })
})

describe('validateTransition', () => {
  it('should allow pending → active', () => {
    expect(validateTransition('pending', 'active')).toBe(true)
  })

  it('should allow active → revoked', () => {
    expect(validateTransition('active', 'revoked')).toBe(true)
  })

  it('should allow active → expired', () => {
    expect(validateTransition('active', 'expired')).toBe(true)
  })

  it('should reject pending → revoked', () => {
    expect(validateTransition('pending', 'revoked')).toBe(false)
  })

  it('should reject pending → expired', () => {
    expect(validateTransition('pending', 'expired')).toBe(false)
  })

  it('should reject revoked → active', () => {
    expect(validateTransition('revoked', 'active')).toBe(false)
  })

  it('should reject revoked → pending', () => {
    expect(validateTransition('revoked', 'pending')).toBe(false)
  })

  it('should reject expired → active', () => {
    expect(validateTransition('expired', 'active')).toBe(false)
  })

  it('should reject expired → pending', () => {
    expect(validateTransition('expired', 'pending')).toBe(false)
  })

  it('should reject unknown status', () => {
    expect(validateTransition('unknown', 'active')).toBe(false)
  })

  it('should define no outgoing transitions from revoked', () => {
    expect(VALID_TRANSITIONS['revoked']).toEqual([])
  })

  it('should define no outgoing transitions from expired', () => {
    expect(VALID_TRANSITIONS['expired']).toEqual([])
  })
})

describe('migration idempotency', () => {
  it('should be safe to run migrations multiple times', () => {
    const storage1 = new SqliteStorage(':memory:')
    storage1.initialize()
    // Run again — should not throw
    storage1.initialize()

    const store1 = new ConsentRelationshipStore(storage1)
    const created = store1.create({
      patientPublicKey: 'key-a',
      providerPublicKey: 'key-b',
      scope: ['test'],
      consentToken: 'token',
      expiresAt: Date.now() + 1000,
    })
    expect(created.id).toBeDefined()
    storage1.close()
  })

  it('should create indexes on patientPublicKey, providerPublicKey, and status', () => {
    const storage2 = new SqliteStorage(':memory:')
    storage2.initialize()

    // Verify indexes exist by querying sqlite_master
    const indexes = storage2.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'consent_relationships'",
    )
    const indexNames = indexes.map((i) => i.name)

    expect(indexNames).toContain('idx_consent_rel_patient')
    expect(indexNames).toContain('idx_consent_rel_provider')
    expect(indexNames).toContain('idx_consent_rel_status')

    storage2.close()
  })
})
