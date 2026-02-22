import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SqliteStorage } from '../storage/index.js'
import { ApiKeyStore, generateApiKey, hashApiKey } from './keys.js'
import { TokenBucketRateLimiter } from './rate-limiter.js'

// ---------------------------------------------------------------------------
// ApiKeyStore Tests
// ---------------------------------------------------------------------------

describe('generateApiKey', () => {
  it('returns raw key with nrn_ prefix and 64-char hex hash', () => {
    const { raw, hash } = generateApiKey()
    expect(raw).toMatch(/^nrn_/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('hashApiKey', () => {
  it('produces same hash as generateApiKey returned', () => {
    const { raw, hash } = generateApiKey()
    expect(hashApiKey(raw)).toBe(hash)
  })

  it('produces different hashes for different keys', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(key1.hash).not.toBe(key2.hash)
  })
})

describe('ApiKeyStore', () => {
  let storage: SqliteStorage
  let store: ApiKeyStore

  beforeEach(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
    store = new ApiKeyStore(storage)
  })

  afterEach(() => {
    storage.close()
  })

  describe('create', () => {
    it('inserts a key and returns keyId, raw, name, createdAt', () => {
      const result = store.create('test-key')
      expect(result.keyId).toBeTruthy()
      expect(result.raw).toMatch(/^nrn_/)
      expect(result.name).toBe('test-key')
      expect(result.createdAt).toBeTruthy()
    })

    it('stores key as hash (not raw)', () => {
      const result = store.create('my-key')
      // Direct SQL check: key_hash exists, matches hash of raw
      const row = storage.get<{ key_hash: string }>(
        'SELECT key_hash FROM api_keys WHERE key_id = ?',
        [result.keyId],
      )
      expect(row).toBeDefined()
      expect(row!.key_hash).toBe(hashApiKey(result.raw))
    })
  })

  describe('verify', () => {
    it('returns key record for valid key', () => {
      const { raw } = store.create('valid-key')
      const record = store.verify(raw)
      expect(record).toBeDefined()
      expect(record!.name).toBe('valid-key')
      expect(record!.key_id).toBeTruthy()
    })

    it('updates last_used_at on successful verify', () => {
      const { raw, keyId } = store.create('used-key')

      // Initially no last_used_at
      const before = storage.get<{ last_used_at: string | null }>(
        'SELECT last_used_at FROM api_keys WHERE key_id = ?',
        [keyId],
      )
      expect(before!.last_used_at).toBeNull()

      store.verify(raw)

      const after = storage.get<{ last_used_at: string | null }>(
        'SELECT last_used_at FROM api_keys WHERE key_id = ?',
        [keyId],
      )
      expect(after!.last_used_at).toBeTruthy()
    })

    it('returns undefined for unknown key', () => {
      const result = store.verify('nrn_nonexistent')
      expect(result).toBeUndefined()
    })

    it('returns undefined for revoked key', () => {
      const { raw, keyId } = store.create('revoked-key')
      store.revoke(keyId)
      const result = store.verify(raw)
      expect(result).toBeUndefined()
    })
  })

  describe('revoke', () => {
    it('sets revoked_at, subsequent verify returns undefined', () => {
      const { raw, keyId } = store.create('to-revoke')
      expect(store.verify(raw)).toBeDefined()

      store.revoke(keyId)

      expect(store.verify(raw)).toBeUndefined()
      const row = storage.get<{ revoked_at: string | null }>(
        'SELECT revoked_at FROM api_keys WHERE key_id = ?',
        [keyId],
      )
      expect(row!.revoked_at).toBeTruthy()
    })
  })

  describe('list', () => {
    it('returns all keys without raw key or hash', () => {
      store.create('key-a')
      store.create('key-b')

      const keys = store.list()
      expect(keys).toHaveLength(2)

      for (const key of keys) {
        expect(key.key_id).toBeTruthy()
        expect(key.name).toBeTruthy()
        expect(key.created_at).toBeTruthy()
        // Ensure no raw key or hash is exposed
        expect((key as Record<string, unknown>).raw).toBeUndefined()
        expect((key as Record<string, unknown>).key_hash).toBeUndefined()
      }
    })

    it('includes revoked status', () => {
      const { keyId } = store.create('revoke-me')
      store.revoke(keyId)

      const keys = store.list()
      const revoked = keys.find((k) => k.key_id === keyId)
      expect(revoked!.revoked_at).toBeTruthy()
    })
  })
})

// ---------------------------------------------------------------------------
// TokenBucketRateLimiter Tests
// ---------------------------------------------------------------------------

describe('TokenBucketRateLimiter', () => {
  it('consume returns true for first request', () => {
    const limiter = new TokenBucketRateLimiter(5, 5, 60000)
    expect(limiter.consume('key-1')).toBe(true)
  })

  it('consume returns false after maxTokens exhausted', () => {
    const limiter = new TokenBucketRateLimiter(3, 3, 60000)
    expect(limiter.consume('key-1')).toBe(true)
    expect(limiter.consume('key-1')).toBe(true)
    expect(limiter.consume('key-1')).toBe(true)
    expect(limiter.consume('key-1')).toBe(false)
  })

  it('different keyIds have independent buckets', () => {
    const limiter = new TokenBucketRateLimiter(1, 1, 60000)
    expect(limiter.consume('key-a')).toBe(true)
    expect(limiter.consume('key-a')).toBe(false)
    // key-b is independent
    expect(limiter.consume('key-b')).toBe(true)
  })

  it('tokens refill after window elapses', () => {
    const limiter = new TokenBucketRateLimiter(2, 2, 1000)
    expect(limiter.consume('key-1')).toBe(true)
    expect(limiter.consume('key-1')).toBe(true)
    expect(limiter.consume('key-1')).toBe(false)

    // Simulate time passing by manipulating internal state
    vi.useFakeTimers()
    vi.advanceTimersByTime(1100) // > 1 window

    // After refill, tokens should be available
    // Need to actually call consume to trigger refill calculation
    expect(limiter.consume('key-1')).toBe(true)

    vi.useRealTimers()
  })

  it('retryAfter returns seconds until next token', () => {
    const limiter = new TokenBucketRateLimiter(1, 1, 60000)
    limiter.consume('key-1')
    limiter.consume('key-1') // exhausted
    const retryAfter = limiter.retryAfter('key-1')
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('retryAfter returns 0 for unknown key', () => {
    const limiter = new TokenBucketRateLimiter(5, 5, 60000)
    expect(limiter.retryAfter('unknown')).toBe(0)
  })

  it('cleanup removes stale buckets', () => {
    const limiter = new TokenBucketRateLimiter(5, 5, 60000)
    limiter.consume('stale-key')

    // Access the cleanup method
    vi.useFakeTimers()
    vi.advanceTimersByTime(11 * 60 * 1000) // 11 minutes

    limiter.cleanup()

    // After cleanup, the stale bucket should be gone
    // Consuming again creates a fresh bucket
    expect(limiter.consume('stale-key')).toBe(true)

    vi.useRealTimers()
  })
})
