/**
 * Provider-initiated relationship termination handler (TERM-01).
 *
 * Terminates care relationships with transactional safety: status update,
 * termination record creation, and audit trail linkage all happen atomically
 * within a single database transaction. Enforces the "terminated is permanent"
 * invariant (TERM-02).
 */

import { randomUUID } from 'node:crypto'
import type { StorageEngine } from '../storage/interface.js'
import type { RelationshipStore } from './store.js'
import type { AuditLogger } from '../audit/logger.js'

export class TerminationHandler {
  constructor(
    private readonly storage: StorageEngine,
    private readonly relationshipStore: RelationshipStore,
    private readonly auditLogger?: AuditLogger,
  ) {}

  /**
   * Terminate a care relationship permanently.
   *
   * All operations execute inside a single transaction for atomic consistency:
   * 1. Load and validate the relationship
   * 2. Reject if already terminated (TERM-02)
   * 3. Validate provider NPI ownership
   * 4. Log audit event (captures sequence number for linkage)
   * 5. Update relationship status to 'terminated'
   * 6. Create termination record with audit linkage (TERM-03)
   *
   * @param relationshipId - The relationship to terminate
   * @param providerNpi - NPI of the provider requesting termination
   * @param reason - Human-readable termination reason
   */
  terminate(relationshipId: string, providerNpi: string, reason: string): void {
    this.storage.transaction(() => {
      // (a) Load relationship
      const relationship = this.relationshipStore.findById(relationshipId)
      if (!relationship) {
        throw new Error(`Relationship ${relationshipId} not found`)
      }

      // (b) Check if already terminated (TERM-02)
      if (relationship.status === 'terminated') {
        throw new Error(`Relationship ${relationshipId} is already terminated`)
      }

      // (c) Validate provider NPI matches
      if (relationship.provider_npi !== providerNpi) {
        throw new Error('Provider NPI does not match relationship')
      }

      // (d) Log audit event first (to capture sequence number for linkage)
      const auditEntry = this.auditLogger?.append({
        category: 'termination',
        action: 'termination.relationship_terminated',
        actor: providerNpi,
        details: {
          relationship_id: relationshipId,
          reason,
        },
      })

      // (e) Update relationship status directly via SQL
      // Bypasses RelationshipStore.updateStatus to avoid double-validation inside transaction
      const now = new Date().toISOString()
      this.storage.run(
        'UPDATE relationships SET status = ?, updated_at = ? WHERE relationship_id = ?',
        ['terminated', now, relationshipId],
      )

      // (f) Create termination record (TERM-03)
      this.storage.run(
        'INSERT INTO termination_records (termination_id, relationship_id, provider_npi, reason, terminated_at, audit_entry_sequence) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), relationshipId, providerNpi, reason, now, auditEntry?.sequence ?? null],
      )
    })
  }
}
