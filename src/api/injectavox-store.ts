/**
 * InjectaVox visit store — SQLite-backed storage for clinical visit data.
 *
 * Follows the same pattern as RelationshipStore and ApiKeyStore:
 * synchronous better-sqlite3 access via the StorageEngine interface.
 */

import type { StorageEngine } from '../storage/interface.js'
import type { InjectaVoxPayload } from '../types/injectavox.js'

/** Row shape returned from injectavox_visits table */
export interface InjectaVoxVisitRow {
  visit_id: string
  provider_npi: string
  patient_id: string
  visit_type: string
  visit_date: string
  chief_complaint: string
  clinical_notes: string
  vitals: string | null
  assessment: string
  plan: string
  medications: string | null
  follow_up: string | null
  processed: number
  ingested_at: string
}

export class InjectaVoxStore {
  constructor(private readonly storage: StorageEngine) {}

  /**
   * Insert a validated InjectaVox payload into the visits table.
   * Serializes vitals, medications, and follow_up as JSON strings.
   */
  insert(payload: InjectaVoxPayload): InjectaVoxVisitRow {
    const ingestedAt = new Date().toISOString()

    this.storage.run(
      `INSERT INTO injectavox_visits
        (visit_id, provider_npi, patient_id, visit_type, visit_date,
         chief_complaint, clinical_notes, vitals, assessment, plan,
         medications, follow_up, processed, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        payload.visit_id,
        payload.provider_npi,
        payload.patient_id,
        payload.visit_type,
        payload.visit_date,
        payload.chief_complaint,
        payload.clinical_notes,
        payload.vitals ? JSON.stringify(payload.vitals) : null,
        payload.assessment,
        payload.plan,
        payload.medications ? JSON.stringify(payload.medications) : null,
        payload.follow_up ? JSON.stringify(payload.follow_up) : null,
        ingestedAt,
      ],
    )

    return {
      visit_id: payload.visit_id,
      provider_npi: payload.provider_npi,
      patient_id: payload.patient_id,
      visit_type: payload.visit_type,
      visit_date: payload.visit_date,
      chief_complaint: payload.chief_complaint,
      clinical_notes: payload.clinical_notes,
      vitals: payload.vitals ? JSON.stringify(payload.vitals) : null,
      assessment: payload.assessment,
      plan: payload.plan,
      medications: payload.medications ? JSON.stringify(payload.medications) : null,
      follow_up: payload.follow_up ? JSON.stringify(payload.follow_up) : null,
      processed: 0,
      ingested_at: ingestedAt,
    }
  }

  /**
   * Get a visit by its ID.
   */
  getById(visitId: string): InjectaVoxVisitRow | undefined {
    return this.storage.get<InjectaVoxVisitRow>(
      'SELECT * FROM injectavox_visits WHERE visit_id = ?',
      [visitId],
    )
  }

  /**
   * List unprocessed visits for a given provider NPI.
   * Ordered by ingested_at ascending (oldest first).
   */
  listUnprocessed(providerNpi: string, limit = 50, offset = 0): InjectaVoxVisitRow[] {
    return this.storage.all<InjectaVoxVisitRow>(
      `SELECT * FROM injectavox_visits
       WHERE provider_npi = ? AND processed = 0
       ORDER BY ingested_at ASC
       LIMIT ? OFFSET ?`,
      [providerNpi, limit, offset],
    )
  }

  /**
   * Count unprocessed visits for a given provider NPI.
   */
  countUnprocessed(providerNpi: string): number {
    const row = this.storage.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM injectavox_visits WHERE provider_npi = ? AND processed = 0',
      [providerNpi],
    )
    return row?.count ?? 0
  }

  /**
   * Mark a visit as processed.
   */
  markProcessed(visitId: string): boolean {
    const result = this.storage.run(
      'UPDATE injectavox_visits SET processed = 1 WHERE visit_id = ? AND processed = 0',
      [visitId],
    )
    return result.changes > 0
  }
}
