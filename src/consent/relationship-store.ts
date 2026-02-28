/**
 * Consent relationship store — CRUD operations with status transition validation.
 *
 * Stores consent relationships in SQLite with public-key-based lookups,
 * enforced status transitions, and time-based expiry. All timestamps are
 * Unix epoch milliseconds.
 *
 * Follows the RelationshipStore pattern from src/relationships/store.ts
 * and the synchronous better-sqlite3 convention.
 */

import { randomUUID } from 'node:crypto'
import type { StorageEngine } from '../storage/interface.js'
import type { ConsentRelationship, ConsentRelationshipUpdate } from './relationship-schemas.js'
import { validateTransition } from './relationship-schemas.js'

/** Row shape returned by SQLite for consent_relationships table */
interface ConsentRelationshipRow {
  id: string
  patient_public_key: string
  provider_public_key: string
  scope: string
  status: string
  consent_token: string
  created_at: number
  updated_at: number
  expires_at: number
}

export class ConsentRelationshipStore {
  constructor(private readonly storage: StorageEngine) {}

  /**
   * Insert a new consent relationship with status 'pending'.
   *
   * Generates a UUID if `id` is not provided.
   * Forces status to 'pending' regardless of input.
   */
  create(
    relationship: Omit<ConsentRelationship, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
      id?: string
    },
  ): ConsentRelationship {
    const now = Date.now()
    const record: ConsentRelationship = {
      id: relationship.id ?? randomUUID(),
      patientPublicKey: relationship.patientPublicKey,
      providerPublicKey: relationship.providerPublicKey,
      scope: relationship.scope,
      status: 'pending',
      consentToken: relationship.consentToken,
      createdAt: now,
      updatedAt: now,
      expiresAt: relationship.expiresAt,
    }

    this.storage.run(
      `INSERT INTO consent_relationships
        (id, patient_public_key, provider_public_key, scope, status,
         consent_token, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.patientPublicKey,
        record.providerPublicKey,
        JSON.stringify(record.scope),
        record.status,
        record.consentToken,
        record.createdAt,
        record.updatedAt,
        record.expiresAt,
      ],
    )

    return record
  }

  /**
   * Retrieve a single consent relationship by ID.
   * Returns undefined if no matching record exists.
   */
  getById(id: string): ConsentRelationship | undefined {
    const row = this.storage.get<ConsentRelationshipRow>(
      'SELECT * FROM consent_relationships WHERE id = ?',
      [id],
    )
    if (!row) return undefined
    return this.rowToRecord(row)
  }

  /**
   * List all consent relationships for a patient public key.
   */
  getByPatient(publicKey: string): ConsentRelationship[] {
    const rows = this.storage.all<ConsentRelationshipRow>(
      'SELECT * FROM consent_relationships WHERE patient_public_key = ?',
      [publicKey],
    )
    return rows.map((row) => this.rowToRecord(row))
  }

  /**
   * List all consent relationships for a provider public key.
   */
  getByProvider(publicKey: string): ConsentRelationship[] {
    const rows = this.storage.all<ConsentRelationshipRow>(
      'SELECT * FROM consent_relationships WHERE provider_public_key = ?',
      [publicKey],
    )
    return rows.map((row) => this.rowToRecord(row))
  }

  /**
   * Update mutable fields on a consent relationship.
   *
   * If `status` is included, validates the transition is legal.
   * Automatically updates the `updatedAt` timestamp.
   *
   * @throws Error if the status transition is invalid
   * @throws Error if the relationship does not exist
   */
  update(id: string, fields: ConsentRelationshipUpdate): ConsentRelationship {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Consent relationship ${id} not found`)
    }

    if (fields.status !== undefined && fields.status !== existing.status) {
      if (!validateTransition(existing.status, fields.status)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${fields.status}`,
        )
      }
    }

    const now = Date.now()
    const setClauses: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    if (fields.status !== undefined) {
      setClauses.push('status = ?')
      params.push(fields.status)
    }
    if (fields.scope !== undefined) {
      setClauses.push('scope = ?')
      params.push(JSON.stringify(fields.scope))
    }
    if (fields.consentToken !== undefined) {
      setClauses.push('consent_token = ?')
      params.push(fields.consentToken)
    }
    if (fields.expiresAt !== undefined) {
      setClauses.push('expires_at = ?')
      params.push(fields.expiresAt)
    }

    params.push(id)

    this.storage.run(
      `UPDATE consent_relationships SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    )

    return this.getById(id)!
  }

  /**
   * Soft delete a consent relationship by setting status to 'revoked'.
   *
   * Does not remove the row — validates that the transition to 'revoked'
   * is legal from the current status.
   *
   * @throws Error if the transition to revoked is not allowed
   * @throws Error if the relationship does not exist
   */
  delete(id: string): void {
    const existing = this.getById(id)
    if (!existing) {
      throw new Error(`Consent relationship ${id} not found`)
    }
    if (!validateTransition(existing.status, 'revoked')) {
      throw new Error(
        `Invalid status transition: ${existing.status} → revoked`,
      )
    }
    this.update(id, { status: 'revoked' })
  }

  /**
   * Expire all active consent relationships past their expiresAt timestamp.
   *
   * Transitions status from 'active' to 'expired' for any relationship
   * where `expiresAt <= now`. Returns the number of relationships expired.
   */
  expireStale(now?: number): number {
    const timestamp = now ?? Date.now()
    const result = this.storage.run(
      `UPDATE consent_relationships
       SET status = 'expired', updated_at = ?
       WHERE status = 'active' AND expires_at <= ?`,
      [timestamp, timestamp],
    )
    return result.changes
  }

  /**
   * Convert a SQLite row to a typed ConsentRelationship.
   * Parses scope from JSON string to string array.
   */
  private rowToRecord(row: ConsentRelationshipRow): ConsentRelationship {
    return {
      id: row.id,
      patientPublicKey: row.patient_public_key,
      providerPublicKey: row.provider_public_key,
      scope: JSON.parse(row.scope) as string[],
      status: row.status as ConsentRelationship['status'],
      consentToken: row.consent_token,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    }
  }
}
