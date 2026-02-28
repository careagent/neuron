import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, createHash, verify } from 'node:crypto'
import { SqliteStorage } from '../../src/storage/sqlite.js'
import { ConsentAuditLog, computeAuditHash } from '../../src/consent/audit-log.js'

describe('ConsentAuditLog', () => {
  let storage: SqliteStorage
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
  })

  describe('computeAuditHash', () => {
    it('should produce a deterministic SHA-256 hash', () => {
      const hash1 = computeAuditHash('genesis', 1000, 'consent.created', 'rel-1', '{}')
      const hash2 = computeAuditHash('genesis', 1000, 'consent.created', 'rel-1', '{}')
      expect(hash1).toBe(hash2)
    })

    it('should produce a 64-char hex string', () => {
      const hash = computeAuditHash('genesis', 1000, 'consent.created', 'rel-1', '{}')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeAuditHash('genesis', 1000, 'consent.created', 'rel-1', '{}')
      const hash2 = computeAuditHash('genesis', 1001, 'consent.created', 'rel-1', '{}')
      expect(hash1).not.toBe(hash2)
    })

    it('should match manual SHA-256 computation', () => {
      const data = 'genesis|1000|consent.created|rel-1|{}'
      const expected = createHash('sha256').update(data).digest('hex')
      const actual = computeAuditHash('genesis', 1000, 'consent.created', 'rel-1', '{}')
      expect(actual).toBe(expected)
    })
  })

  describe('append', () => {
    it('should create an audit entry with all required fields', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', { foo: 'bar' })

      expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(entry.timestamp).toBeTypeOf('number')
      expect(entry.action).toBe('consent.created')
      expect(entry.relationshipId).toBe('rel-1')
      expect(entry.actorPublicKey).toBe('actor-key')
      expect(entry.details).toBe('{"foo":"bar"}')
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.signature).toBeTruthy()
    })

    it('should set first entry previousHash to genesis', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', {})
      expect(entry.previousHash).toBe('genesis')
    })

    it('should chain entries: second entry previousHash = first entry hash', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const first = log.append('consent.created', 'rel-1', 'actor-key', {})
      const second = log.append('consent.activated', 'rel-1', 'actor-key', {})
      expect(second.previousHash).toBe(first.hash)
    })

    it('should compute hash correctly as SHA-256(previousHash|timestamp|action|relationshipId|details)', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', { test: true })

      const expectedHash = computeAuditHash(
        entry.previousHash,
        entry.timestamp,
        entry.action,
        entry.relationshipId,
        entry.details,
      )
      expect(entry.hash).toBe(expectedHash)
    })

    it('should sign the hash with Ed25519', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', {})

      const signatureBuffer = Buffer.from(entry.signature, 'base64')
      const valid = verify(null, Buffer.from(entry.hash, 'utf-8'), publicKey, signatureBuffer)
      expect(valid).toBe(true)
    })

    it('should persist entries in SQLite', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      log.append('consent.activated', 'rel-1', 'actor-key', {})

      const row = storage.get<{ count: number }>('SELECT COUNT(*) as count FROM audit_log')
      expect(row!.count).toBe(2)
    })

    it('should support all consent audit actions', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const actions: Array<'consent.created' | 'consent.activated' | 'consent.revoked' | 'consent.expired'> = [
        'consent.created',
        'consent.activated',
        'consent.revoked',
        'consent.expired',
      ]

      for (const action of actions) {
        const entry = log.append(action, `rel-${action}`, 'actor-key', {})
        expect(entry.action).toBe(action)
      }
    })
  })

  describe('getByRelationship', () => {
    it('should return entries for a specific relationship', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      log.append('consent.created', 'rel-2', 'actor-key', {})
      log.append('consent.activated', 'rel-1', 'actor-key', {})

      const entries = log.getByRelationship('rel-1')
      expect(entries).toHaveLength(2)
      entries.forEach((e) => expect(e.relationshipId).toBe('rel-1'))
    })

    it('should return entries ordered by timestamp', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      log.append('consent.activated', 'rel-1', 'actor-key', {})

      const entries = log.getByRelationship('rel-1')
      expect(entries[0].action).toBe('consent.created')
      expect(entries[1].action).toBe('consent.activated')
      expect(entries[0].timestamp).toBeLessThanOrEqual(entries[1].timestamp)
    })

    it('should return empty array for nonexistent relationship', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entries = log.getByRelationship('nonexistent')
      expect(entries).toEqual([])
    })
  })

  describe('verifyChain', () => {
    it('should pass for a valid chain', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      log.append('consent.activated', 'rel-1', 'actor-key', {})

      const result = log.verifyChain('rel-1')
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(2)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect tampered hash', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})

      // Tamper with the hash directly in SQLite
      storage.run(
        "UPDATE audit_log SET hash = 'tampered' WHERE relationship_id = 'rel-1'",
      )

      const result = log.verifyChain('rel-1')
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should detect tampered signature', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', {})

      // Tamper with the signature directly in SQLite (keep valid hash)
      storage.run(
        'UPDATE audit_log SET signature = ? WHERE id = ?',
        ['aW52YWxpZA==', entry.id],
      )

      const result = log.verifyChain('rel-1')
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('signature'))).toBe(true)
    })

    it('should pass for empty relationship', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const result = log.verifyChain('nonexistent')
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(0)
    })
  })

  describe('verifyGlobalChain', () => {
    it('should pass for a valid global chain', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      log.append('consent.created', 'rel-2', 'actor-key', {})
      log.append('consent.activated', 'rel-1', 'actor-key', {})

      const result = log.verifyGlobalChain()
      expect(result.valid).toBe(true)
      expect(result.entries).toBe(3)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect broken previousHash linkage', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      log.append('consent.created', 'rel-1', 'actor-key', {})
      const second = log.append('consent.activated', 'rel-1', 'actor-key', {})

      // Break the chain by changing previousHash
      storage.run(
        "UPDATE audit_log SET previous_hash = 'broken' WHERE id = ?",
        [second.id],
      )

      const result = log.verifyGlobalChain()
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('previousHash'))).toBe(true)
    })

    it('should verify first entry starts with genesis', () => {
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', {})

      // Verify first entry has genesis as previousHash
      const entries = log.getByRelationship('rel-1')
      expect(entries[0].previousHash).toBe('genesis')
    })
  })

  describe('chain resumption', () => {
    it('should resume chain from existing entries in SQLite', () => {
      const log1 = new ConsentAuditLog(storage, privateKey, publicKey)
      const last = log1.append('consent.created', 'rel-1', 'actor-key', {})

      // Create a new ConsentAuditLog instance reading the same DB
      const log2 = new ConsentAuditLog(storage, privateKey, publicKey)
      const resumed = log2.append('consent.activated', 'rel-1', 'actor-key', {})

      expect(resumed.previousHash).toBe(last.hash)
    })
  })

  describe('migration idempotency', () => {
    it('should create audit_log table with proper indexes', () => {
      const indexes = storage.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log'",
      )
      const indexNames = indexes.map((i) => i.name)

      expect(indexNames).toContain('idx_audit_relationship')
      expect(indexNames).toContain('idx_audit_timestamp')
    })

    it('should be safe to initialize storage multiple times', () => {
      storage.initialize()
      const log = new ConsentAuditLog(storage, privateKey, publicKey)
      const entry = log.append('consent.created', 'rel-1', 'actor-key', {})
      expect(entry.id).toBeDefined()
    })
  })
})
