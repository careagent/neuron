import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteStorage } from './sqlite.js'

describe('SqliteStorage', () => {
  let storage: SqliteStorage

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
  })

  afterEach(() => {
    try {
      storage.close()
    } catch {
      // Already closed
    }
  })

  describe('initialization', () => {
    it('should create all expected tables on initialize()', () => {
      storage.initialize()
      const tables = storage
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map((t) => t.name)

      expect(tables).toContain('schema_version')
      expect(tables).toContain('relationships')
      expect(tables).toContain('appointments')
      expect(tables).toContain('billing_records')
      expect(tables).toContain('termination_records')
      expect(tables).toContain('cached_chart_entries')
      expect(tables).toContain('sync_state')
      expect(tables).toContain('neuron_registration')
      expect(tables).toContain('provider_registrations')
    })

    it('should be idempotent (calling initialize() twice does not error)', () => {
      storage.initialize()
      expect(() => storage.initialize()).not.toThrow()
    })

    it('should enable WAL mode on file-backed databases', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'neuron-wal-test-'))
      const dbPath = join(tempDir, 'wal-test.db')
      try {
        const fileStore = new SqliteStorage(dbPath)
        const row = fileStore.get<{ journal_mode: string }>('PRAGMA journal_mode')
        expect(row?.journal_mode).toBe('wal')
        fileStore.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('should record migration version', () => {
      storage.initialize()
      const row = storage.get<{ version: number }>('SELECT MAX(version) as version FROM schema_version')
      expect(row?.version).toBe(4)
    })
  })

  describe('CRUD operations', () => {
    beforeEach(() => {
      storage.initialize()
    })

    it('should execute INSERT and return changes count', () => {
      const now = new Date().toISOString()
      const result = storage.run(
        'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['rel-001', 'patient-agent-1', '1234567893', 'pending', now, now],
      )
      expect(result.changes).toBe(1)
    })

    it('should return single row with get()', () => {
      const now = new Date().toISOString()
      storage.run(
        'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['rel-001', 'patient-agent-1', '1234567893', 'pending', now, now],
      )
      const row = storage.get<{ relationship_id: string; status: string }>(
        'SELECT relationship_id, status FROM relationships WHERE relationship_id = ?',
        ['rel-001'],
      )
      expect(row).toBeDefined()
      expect(row?.relationship_id).toBe('rel-001')
      expect(row?.status).toBe('pending')
    })

    it('should return undefined for missing row with get()', () => {
      const row = storage.get('SELECT * FROM relationships WHERE relationship_id = ?', ['nonexistent'])
      expect(row).toBeUndefined()
    })

    it('should return all matching rows with all()', () => {
      const now = new Date().toISOString()
      storage.run(
        'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['rel-001', 'patient-1', '1234567893', 'pending', now, now],
      )
      storage.run(
        'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['rel-002', 'patient-2', '1234567893', 'active', now, now],
      )
      const rows = storage.all<{ relationship_id: string }>('SELECT relationship_id FROM relationships ORDER BY relationship_id')
      expect(rows).toHaveLength(2)
      expect(rows[0].relationship_id).toBe('rel-001')
      expect(rows[1].relationship_id).toBe('rel-002')
    })
  })

  describe('transactions', () => {
    beforeEach(() => {
      storage.initialize()
    })

    it('should commit on success', () => {
      const now = new Date().toISOString()
      storage.transaction(() => {
        storage.run(
          'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['rel-tx-1', 'patient-1', '1234567893', 'pending', now, now],
        )
        storage.run(
          'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['rel-tx-2', 'patient-2', '1234567893', 'active', now, now],
        )
      })
      const rows = storage.all('SELECT * FROM relationships')
      expect(rows).toHaveLength(2)
    })

    it('should roll back on error', () => {
      const now = new Date().toISOString()
      expect(() => {
        storage.transaction(() => {
          storage.run(
            'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ['rel-tx-1', 'patient-1', '1234567893', 'pending', now, now],
          )
          throw new Error('Simulated failure')
        })
      }).toThrow('Simulated failure')
      const rows = storage.all('SELECT * FROM relationships')
      expect(rows).toHaveLength(0)
    })
  })

  describe('persistence', () => {
    it('should persist data across close/reopen cycles with file-backed DB', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'neuron-storage-test-'))
      const dbPath = join(tempDir, 'test.db')
      const now = new Date().toISOString()

      try {
        // Write data
        const store1 = new SqliteStorage(dbPath)
        store1.initialize()
        store1.run(
          'INSERT INTO relationships (relationship_id, patient_agent_id, provider_npi, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ['rel-persist', 'patient-1', '1234567893', 'active', now, now],
        )
        store1.close()

        // Reopen and verify
        const store2 = new SqliteStorage(dbPath)
        store2.initialize()
        const row = store2.get<{ relationship_id: string; status: string }>(
          'SELECT relationship_id, status FROM relationships WHERE relationship_id = ?',
          ['rel-persist'],
        )
        expect(row).toBeDefined()
        expect(row?.status).toBe('active')
        store2.close()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
