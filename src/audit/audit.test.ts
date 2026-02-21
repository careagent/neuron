import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { canonicalize } from './serialize.js'
import { AuditLogger } from './logger.js'
import { verifyAuditChain } from './verifier.js'
import type { AuditCategory } from '../types/audit.js'

describe('canonicalize', () => {
  it('should produce identical output for objects with different key insertion order', () => {
    const obj1 = { b: 2, a: 1 }
    const obj2 = { a: 1, b: 2 }
    expect(canonicalize(obj1)).toBe(canonicalize(obj2))
  })

  it('should sort nested object keys recursively', () => {
    const obj = { z: { b: 2, a: 1 }, a: 0 }
    const result = canonicalize(obj)
    expect(result).toBe('{"a":0,"z":{"a":1,"b":2}}')
  })

  it('should maintain array element order (not sorted)', () => {
    const arr = [3, 1, 2]
    expect(canonicalize(arr)).toBe('[3,1,2]')
  })

  it('should handle null correctly', () => {
    expect(canonicalize(null)).toBe('null')
  })

  it('should handle numbers correctly', () => {
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize(3.14)).toBe('3.14')
  })

  it('should handle booleans correctly', () => {
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(false)).toBe('false')
  })

  it('should handle strings correctly', () => {
    expect(canonicalize('hello')).toBe('"hello"')
  })

  it('should handle empty objects and arrays', () => {
    expect(canonicalize({})).toBe('{}')
    expect(canonicalize([])).toBe('[]')
  })

  it('should handle arrays of objects with sorted keys', () => {
    const arr = [{ b: 2, a: 1 }]
    expect(canonicalize(arr)).toBe('[{"a":1,"b":2}]')
  })
})

describe('AuditLogger', () => {
  let tempDir: string
  let auditPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-audit-test-'))
    auditPath = join(tempDir, 'audit.jsonl')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('hash chain', () => {
    it('should set first entry prev_hash to 64 zeros (genesis)', () => {
      const logger = new AuditLogger(auditPath)
      const entry = logger.append({
        category: 'admin' as AuditCategory,
        action: 'test_action',
      })
      expect(entry.prev_hash).toBe('0'.repeat(64))
    })

    it('should set second entry prev_hash to first entry hash', () => {
      const logger = new AuditLogger(auditPath)
      const first = logger.append({
        category: 'admin' as AuditCategory,
        action: 'first_action',
      })
      const second = logger.append({
        category: 'admin' as AuditCategory,
        action: 'second_action',
      })
      expect(second.prev_hash).toBe(first.hash)
    })

    it('should compute hash as SHA-256 of canonical JSON excluding hash field', () => {
      const logger = new AuditLogger(auditPath)
      const entry = logger.append({
        category: 'admin' as AuditCategory,
        action: 'test_action',
      })

      // Recompute: canonicalize the entry without the hash field
      const { hash: _hash, ...entryWithoutHash } = entry
      const canonical = canonicalize(entryWithoutHash)
      const expectedHash = createHash('sha256').update(canonical).digest('hex')
      expect(entry.hash).toBe(expectedHash)
    })

    it('should increment sequence numbers monotonically', () => {
      const logger = new AuditLogger(auditPath)
      const first = logger.append({ category: 'admin' as AuditCategory, action: 'a1' })
      const second = logger.append({ category: 'admin' as AuditCategory, action: 'a2' })
      const third = logger.append({ category: 'admin' as AuditCategory, action: 'a3' })
      expect(first.sequence).toBe(1)
      expect(second.sequence).toBe(2)
      expect(third.sequence).toBe(3)
    })

    it('should support all audit category types', () => {
      const categories: AuditCategory[] = [
        'registration',
        'connection',
        'consent',
        'api_access',
        'sync',
        'admin',
        'termination',
      ]
      const logger = new AuditLogger(auditPath)
      for (const category of categories) {
        const entry = logger.append({ category, action: `test_${category}` })
        expect(entry.category).toBe(category)
      }
    })

    it('should include actor and details when provided', () => {
      const logger = new AuditLogger(auditPath)
      const entry = logger.append({
        category: 'admin' as AuditCategory,
        action: 'test_action',
        actor: 'system',
        details: { key: 'value' },
      })
      expect(entry.actor).toBe('system')
      expect(entry.details).toEqual({ key: 'value' })
    })

    it('should resume chain from existing file', () => {
      const logger1 = new AuditLogger(auditPath)
      const last = logger1.append({ category: 'admin' as AuditCategory, action: 'first' })

      // Create a new logger instance reading the same file
      const logger2 = new AuditLogger(auditPath)
      const resumed = logger2.append({ category: 'admin' as AuditCategory, action: 'second' })
      expect(resumed.prev_hash).toBe(last.hash)
      expect(resumed.sequence).toBe(2)
    })
  })
})

describe('verifyAuditChain', () => {
  let tempDir: string
  let auditPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-audit-verify-'))
    auditPath = join(tempDir, 'audit.jsonl')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should pass for a valid chain', () => {
    const logger = new AuditLogger(auditPath)
    logger.append({ category: 'admin' as AuditCategory, action: 'a1' })
    logger.append({ category: 'admin' as AuditCategory, action: 'a2' })
    logger.append({ category: 'admin' as AuditCategory, action: 'a3' })

    const result = verifyAuditChain(auditPath)
    expect(result.valid).toBe(true)
    expect(result.entries).toBe(3)
    expect(result.errors).toHaveLength(0)
  })

  it('should detect tampered entry (modified content)', () => {
    const logger = new AuditLogger(auditPath)
    logger.append({ category: 'admin' as AuditCategory, action: 'a1' })
    logger.append({ category: 'admin' as AuditCategory, action: 'a2' })

    // Tamper with the first entry
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    entry.action = 'tampered_action'
    lines[0] = JSON.stringify(entry)
    writeFileSync(auditPath, lines.join('\n') + '\n')

    const result = verifyAuditChain(auditPath)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should detect broken prev_hash linkage', () => {
    const logger = new AuditLogger(auditPath)
    logger.append({ category: 'admin' as AuditCategory, action: 'a1' })
    logger.append({ category: 'admin' as AuditCategory, action: 'a2' })

    // Break prev_hash of second entry
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[1])
    entry.prev_hash = '0'.repeat(64)
    entry.hash = createHash('sha256')
      .update(canonicalize({ ...entry, hash: undefined }))
      .digest('hex')
    lines[1] = JSON.stringify(entry)
    writeFileSync(auditPath, lines.join('\n') + '\n')

    const result = verifyAuditChain(auditPath)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.error.includes('prev_hash'))).toBe(true)
  })

  it('should pass for an empty log file', () => {
    writeFileSync(auditPath, '')
    const result = verifyAuditChain(auditPath)
    expect(result.valid).toBe(true)
    expect(result.entries).toBe(0)
  })

  it('should pass for a single entry with genesis prev_hash', () => {
    const logger = new AuditLogger(auditPath)
    logger.append({ category: 'admin' as AuditCategory, action: 'solo' })

    const result = verifyAuditChain(auditPath)
    expect(result.valid).toBe(true)
    expect(result.entries).toBe(1)
  })

  it('should pass for nonexistent file (no audit log yet)', () => {
    const result = verifyAuditChain(join(tempDir, 'nonexistent.jsonl'))
    expect(result.valid).toBe(true)
    expect(result.entries).toBe(0)
  })
})
