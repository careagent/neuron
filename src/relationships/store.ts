/**
 * SQLite read/write for relationship records.
 *
 * Provides CRUD and query methods for the relationships table
 * via the StorageEngine interface. Follows the RegistrationStateStore
 * pattern from src/registration/state.ts.
 */

import type { StorageEngine } from '../storage/interface.js'
import type { RelationshipRecord } from '../types/relationship.js'

/** Row shape for relationships table reads (SQLite returns all TEXT). */
interface RelationshipRow {
  relationship_id: string
  patient_agent_id: string
  provider_npi: string
  status: string
  consented_actions: string
  patient_public_key: string
  created_at: string
  updated_at: string
}

export class RelationshipStore {
  constructor(private readonly storage: StorageEngine) {}

  /**
   * Insert a new relationship record.
   * Serializes consented_actions as JSON string for storage.
   */
  create(record: RelationshipRecord): void {
    this.storage.run(
      `INSERT INTO relationships
        (relationship_id, patient_agent_id, provider_npi, status,
         consented_actions, patient_public_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.relationship_id,
        record.patient_agent_id,
        record.provider_npi,
        record.status,
        JSON.stringify(record.consented_actions),
        record.patient_public_key,
        record.created_at,
        record.updated_at,
      ],
    )
  }

  /**
   * Find a relationship by its unique ID.
   * Returns undefined if no matching record exists.
   */
  findById(relationshipId: string): RelationshipRecord | undefined {
    const row = this.storage.get<RelationshipRow>(
      'SELECT * FROM relationships WHERE relationship_id = ?',
      [relationshipId],
    )
    if (!row) return undefined
    return this.rowToRecord(row)
  }

  /**
   * Find all relationships for a given patient agent ID.
   */
  findByPatient(patientAgentId: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE patient_agent_id = ?',
      [patientAgentId],
    )
    return rows.map((row) => this.rowToRecord(row))
  }

  /**
   * Find all relationships for a given provider NPI.
   */
  findByProvider(providerNpi: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE provider_npi = ?',
      [providerNpi],
    )
    return rows.map((row) => this.rowToRecord(row))
  }

  /**
   * Find all relationships with a given status.
   */
  findByStatus(status: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE status = ?',
      [status],
    )
    return rows.map((row) => this.rowToRecord(row))
  }

  /**
   * Update the status of a relationship.
   *
   * CRITICAL: Rejects updates on terminated relationships (TERM-04 enforcement).
   * Throws if the current status is 'terminated'.
   */
  updateStatus(relationshipId: string, status: string): void {
    const current = this.findById(relationshipId)
    if (current && current.status === 'terminated') {
      throw new Error('Cannot update status of a terminated relationship')
    }
    this.storage.run(
      'UPDATE relationships SET status = ?, updated_at = ? WHERE relationship_id = ?',
      [status, new Date().toISOString(), relationshipId],
    )
  }

  /**
   * Convert a SQLite row to a typed RelationshipRecord.
   * Parses consented_actions from JSON string to string array.
   */
  private rowToRecord(row: RelationshipRow): RelationshipRecord {
    return {
      relationship_id: row.relationship_id,
      patient_agent_id: row.patient_agent_id,
      provider_npi: row.provider_npi,
      status: row.status as RelationshipRecord['status'],
      consented_actions: JSON.parse(row.consented_actions) as string[],
      patient_public_key: row.patient_public_key,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
}
