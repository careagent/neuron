/**
 * Hash-chained, Ed25519-signed consent audit log persisted in SQLite.
 *
 * Each entry contains:
 * - A SHA-256 hash linking it to the previous entry (genesis = "genesis")
 * - An Ed25519 signature of the hash, made with the neuron's private key
 *
 * The hash is computed as:
 *   SHA-256(previousHash|timestamp|action|relationshipId|details)
 *
 * The log is append-only. Entries are never modified or deleted.
 */

import { createHash, sign, verify, randomUUID, type KeyObject } from 'node:crypto'
import type { StorageEngine } from '../storage/interface.js'
import type { ConsentAuditAction, ConsentAuditEntry } from './audit-schemas.js'

const GENESIS_HASH = 'genesis'

/** Row shape returned by SQLite for audit_log table */
interface AuditLogRow {
  id: string
  timestamp: number
  action: string
  relationship_id: string
  actor_public_key: string
  details: string
  previous_hash: string
  hash: string
  signature: string
}

/**
 * Compute the SHA-256 hash for an audit entry.
 *
 * Hash covers: previousHash|timestamp|action|relationshipId|details
 */
export function computeAuditHash(
  previousHash: string,
  timestamp: number,
  action: string,
  relationshipId: string,
  details: string,
): string {
  const data = `${previousHash}|${timestamp}|${action}|${relationshipId}|${details}`
  return createHash('sha256').update(data).digest('hex')
}

export class ConsentAuditLog {
  private lastHash: string

  constructor(
    private readonly storage: StorageEngine,
    private readonly neuronPrivateKey: KeyObject,
    private readonly neuronPublicKey: KeyObject,
  ) {
    // Resume chain from last entry in DB
    const lastRow = this.storage.get<AuditLogRow>(
      'SELECT * FROM audit_log ORDER BY timestamp DESC, rowid DESC LIMIT 1',
    )
    this.lastHash = lastRow ? lastRow.hash : GENESIS_HASH
  }

  /**
   * Append a new audit entry to the log.
   *
   * Computes the hash chain, signs with the neuron's private key,
   * and persists to SQLite in a single synchronous operation.
   */
  append(
    action: ConsentAuditAction,
    relationshipId: string,
    actorPublicKey: string,
    details: Record<string, unknown>,
  ): ConsentAuditEntry {
    const id = randomUUID()
    const timestamp = Date.now()
    const detailsStr = JSON.stringify(details)
    const previousHash = this.lastHash

    const hash = computeAuditHash(previousHash, timestamp, action, relationshipId, detailsStr)

    // Ed25519 signature over the hash
    const signatureBuffer = sign(null, Buffer.from(hash, 'utf-8'), this.neuronPrivateKey)
    const signature = signatureBuffer.toString('base64')

    const entry: ConsentAuditEntry = {
      id,
      timestamp,
      action,
      relationshipId,
      actorPublicKey,
      details: detailsStr,
      previousHash,
      hash,
      signature,
    }

    this.storage.run(
      `INSERT INTO audit_log
        (id, timestamp, action, relationship_id, actor_public_key, details,
         previous_hash, hash, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, timestamp, action, relationshipId, actorPublicKey, detailsStr, previousHash, hash, signature],
    )

    this.lastHash = hash
    return entry
  }

  /**
   * Get all audit entries for a relationship, ordered by timestamp.
   */
  getByRelationship(relationshipId: string): ConsentAuditEntry[] {
    const rows = this.storage.all<AuditLogRow>(
      'SELECT * FROM audit_log WHERE relationship_id = ? ORDER BY timestamp ASC, rowid ASC',
      [relationshipId],
    )
    return rows.map((row) => this.rowToEntry(row))
  }

  /**
   * Verify the hash chain integrity for a specific relationship's audit trail.
   *
   * Walks all entries in timestamp order and verifies:
   * 1. Each hash matches the recomputed hash
   * 2. Each previousHash links to the prior entry's hash
   * 3. First entry's previousHash is "genesis" (for that relationship's sub-chain,
   *    or links to an entry from another relationship in the global chain)
   * 4. Each Ed25519 signature is valid
   *
   * For per-relationship verification, we verify hash correctness and signatures.
   * The previousHash linkage is verified against the global chain order.
   */
  verifyChain(relationshipId: string): { valid: boolean; entries: number; errors: string[] } {
    const rows = this.storage.all<AuditLogRow>(
      'SELECT * FROM audit_log WHERE relationship_id = ? ORDER BY timestamp ASC, rowid ASC',
      [relationshipId],
    )

    const errors: string[] = []

    for (const row of rows) {
      // Verify hash computation
      const expectedHash = computeAuditHash(
        row.previous_hash,
        row.timestamp,
        row.action,
        row.relationship_id,
        row.details,
      )
      if (row.hash !== expectedHash) {
        errors.push(`Entry ${row.id}: hash mismatch — expected ${expectedHash}, got ${row.hash}`)
      }

      // Verify Ed25519 signature
      const signatureBuffer = Buffer.from(row.signature, 'base64')
      const valid = verify(null, Buffer.from(row.hash, 'utf-8'), this.neuronPublicKey, signatureBuffer)
      if (!valid) {
        errors.push(`Entry ${row.id}: invalid Ed25519 signature`)
      }
    }

    return {
      valid: errors.length === 0,
      entries: rows.length,
      errors,
    }
  }

  /**
   * Verify the entire global audit chain (all relationships).
   */
  verifyGlobalChain(): { valid: boolean; entries: number; errors: string[] } {
    const rows = this.storage.all<AuditLogRow>(
      'SELECT * FROM audit_log ORDER BY timestamp ASC, rowid ASC',
    )

    const errors: string[] = []
    let expectedPreviousHash = GENESIS_HASH

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      // Verify previousHash linkage
      if (row.previous_hash !== expectedPreviousHash) {
        errors.push(
          `Entry ${row.id} (index ${i}): previousHash mismatch — expected ${expectedPreviousHash}, got ${row.previous_hash}`,
        )
      }

      // Verify hash computation
      const expectedHash = computeAuditHash(
        row.previous_hash,
        row.timestamp,
        row.action,
        row.relationship_id,
        row.details,
      )
      if (row.hash !== expectedHash) {
        errors.push(`Entry ${row.id} (index ${i}): hash mismatch — expected ${expectedHash}, got ${row.hash}`)
      }

      // Verify Ed25519 signature
      const signatureBuffer = Buffer.from(row.signature, 'base64')
      const valid = verify(null, Buffer.from(row.hash, 'utf-8'), this.neuronPublicKey, signatureBuffer)
      if (!valid) {
        errors.push(`Entry ${row.id} (index ${i}): invalid Ed25519 signature`)
      }

      expectedPreviousHash = row.hash
    }

    return {
      valid: errors.length === 0,
      entries: rows.length,
      errors,
    }
  }

  private rowToEntry(row: AuditLogRow): ConsentAuditEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      action: row.action as ConsentAuditAction,
      relationshipId: row.relationship_id,
      actorPublicKey: row.actor_public_key,
      details: row.details,
      previousHash: row.previous_hash,
      hash: row.hash,
      signature: row.signature,
    }
  }
}
