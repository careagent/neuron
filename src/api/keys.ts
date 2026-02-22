/**
 * API key generation, hashing, and SQLite-backed store.
 *
 * Keys use nrn_ prefix for easy identification. Only SHA-256 hashes
 * are stored -- raw keys are shown once at creation time.
 * Verification uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * Follows RegistrationStateStore pattern from src/registration/state.ts.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type { StorageEngine } from '../storage/interface.js'

/** Public API key record (never includes raw key or hash) */
export interface ApiKeyRecord {
  key_id: string
  name: string
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
}

/** Result of creating a new API key */
export interface CreateApiKeyResult {
  keyId: string
  raw: string
  name: string
  createdAt: string
}

/** Internal row shape for api_keys table reads */
interface ApiKeyRow {
  key_id: string
  key_hash: string
  name: string
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
}

/**
 * Generate a new API key with nrn_ prefix and its SHA-256 hash.
 */
export function generateApiKey(): { raw: string; hash: string } {
  const bytes = randomBytes(32)
  const raw = `nrn_${bytes.toString('base64url')}`
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

/**
 * Hash a raw API key with SHA-256.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export class ApiKeyStore {
  constructor(private readonly storage: StorageEngine) {}

  /**
   * Create a new API key.
   * Returns the raw key (shown ONCE to user) and metadata.
   */
  create(name: string): CreateApiKeyResult {
    const keyId = randomUUID()
    const { raw, hash } = generateApiKey()
    const createdAt = new Date().toISOString()

    this.storage.run(
      `INSERT INTO api_keys (key_id, key_hash, name, created_at)
       VALUES (?, ?, ?, ?)`,
      [keyId, hash, name, createdAt],
    )

    return { keyId, raw, name, createdAt }
  }

  /**
   * Verify an API key and return its record if valid.
   *
   * Uses timing-safe comparison to prevent timing attacks.
   * Returns undefined for unknown, revoked, or invalid keys.
   * Updates last_used_at on successful verification.
   */
  verify(rawKey: string): ApiKeyRecord | undefined {
    const presentedHash = hashApiKey(rawKey)

    const row = this.storage.get<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE key_hash = ?',
      [presentedHash],
    )

    if (!row) return undefined

    // Timing-safe comparison of hash buffers
    const storedBuffer = Buffer.from(row.key_hash, 'hex')
    const presentedBuffer = Buffer.from(presentedHash, 'hex')

    if (storedBuffer.length !== presentedBuffer.length) return undefined
    if (!timingSafeEqual(storedBuffer, presentedBuffer)) return undefined

    // Reject revoked keys
    if (row.revoked_at !== null) return undefined

    // Update last_used_at
    this.storage.run(
      'UPDATE api_keys SET last_used_at = ? WHERE key_id = ?',
      [new Date().toISOString(), row.key_id],
    )

    return {
      key_id: row.key_id,
      name: row.name,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      last_used_at: row.last_used_at,
    }
  }

  /**
   * Revoke an API key by setting revoked_at timestamp.
   */
  revoke(keyId: string): void {
    this.storage.run(
      'UPDATE api_keys SET revoked_at = ? WHERE key_id = ?',
      [new Date().toISOString(), keyId],
    )
  }

  /**
   * List all API keys (without raw key or hash).
   */
  list(): ApiKeyRecord[] {
    const rows = this.storage.all<ApiKeyRow>(
      'SELECT key_id, name, created_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC',
    )
    return rows.map((row) => ({
      key_id: row.key_id,
      name: row.name,
      created_at: row.created_at,
      revoked_at: row.revoked_at ?? null,
      last_used_at: row.last_used_at ?? null,
    }))
  }
}
