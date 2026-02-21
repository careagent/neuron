import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { canonicalize } from './serialize.js'
import type { AuditEntry, AuditCategory } from '../types/audit.js'

/**
 * Event data for an audit log entry.
 */
export interface AuditEvent {
  category: AuditCategory
  action: string
  actor?: string
  details?: Record<string, unknown>
}

const GENESIS_HASH = '0'.repeat(64)

/**
 * Append-only hash-chained JSONL audit logger.
 *
 * Each entry contains a SHA-256 hash linking it to the previous entry,
 * forming a tamper-evident chain. The hash is computed over the canonical
 * JSON representation of the entry (excluding the hash field itself).
 *
 * The first entry uses a genesis prev_hash of 64 zeros.
 */
export class AuditLogger {
  private lastHash: string
  private sequence: number
  private readonly auditPath: string

  /**
   * @param auditPath - Path to the JSONL audit log file
   */
  constructor(auditPath: string) {
    this.auditPath = auditPath
    this.lastHash = GENESIS_HASH
    this.sequence = 0

    // Resume from existing file if present
    if (existsSync(auditPath)) {
      const content = readFileSync(auditPath, 'utf-8').trim()
      if (content.length > 0) {
        const lines = content.split('\n')
        // Find last valid JSON line
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]) as AuditEntry
            this.lastHash = entry.hash
            this.sequence = entry.sequence
            break
          } catch {
            // Skip invalid lines (crash recovery)
            continue
          }
        }
      }
    }
  }

  /**
   * Append an audit event to the log.
   *
   * Builds the entry, computes its SHA-256 hash over the canonical JSON
   * (excluding the hash field), appends to file, and returns the full entry.
   *
   * @param event - The audit event to log
   * @returns The complete audit entry with hash and sequence
   */
  append(event: AuditEvent): AuditEntry {
    this.sequence++

    // Build entry without hash
    const entryWithoutHash: Omit<AuditEntry, 'hash'> = {
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      category: event.category,
      action: event.action,
      prev_hash: this.lastHash,
    }

    if (event.actor !== undefined) {
      ;(entryWithoutHash as Record<string, unknown>).actor = event.actor
    }

    if (event.details !== undefined) {
      ;(entryWithoutHash as Record<string, unknown>).details = event.details
    }

    // Compute hash over canonical JSON of entry (without hash field)
    const canonical = canonicalize(entryWithoutHash)
    const hash = createHash('sha256').update(canonical).digest('hex')

    // Build full entry
    const entry: AuditEntry = {
      ...entryWithoutHash,
      hash,
    }

    // Append to file
    appendFileSync(this.auditPath, JSON.stringify(entry) + '\n')

    // Update state
    this.lastHash = hash

    return entry
  }
}
