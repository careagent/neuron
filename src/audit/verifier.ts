import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { canonicalize } from './serialize.js'

/**
 * Result of audit chain verification.
 */
export interface VerificationResult {
  /** Whether the entire chain is valid */
  valid: boolean
  /** Total number of entries checked */
  entries: number
  /** List of errors found, with line number and description */
  errors: Array<{ line: number; error: string }>
}

const GENESIS_HASH = '0'.repeat(64)

/**
 * Verify the integrity of a hash-chained JSONL audit log.
 *
 * Reads the file line by line and for each entry:
 * 1. Verifies the hash matches the SHA-256 of the canonical JSON (without hash field)
 * 2. Verifies the prev_hash links to the previous entry's hash
 * 3. Verifies sequences are monotonically increasing
 *
 * @param auditPath - Path to the JSONL audit log file
 * @returns Verification result with error details
 */
export function verifyAuditChain(auditPath: string): VerificationResult {
  const errors: Array<{ line: number; error: string }> = []

  // Handle nonexistent or empty file
  if (!existsSync(auditPath)) {
    return { valid: true, entries: 0, errors: [] }
  }

  const content = readFileSync(auditPath, 'utf-8').trim()
  if (content.length === 0) {
    return { valid: true, entries: 0, errors: [] }
  }

  const lines = content.split('\n')
  let previousHash = GENESIS_HASH
  let previousSequence = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1

    // Parse JSON
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(lines[i]) as Record<string, unknown>
    } catch {
      errors.push({ line: lineNum, error: `Invalid JSON on line ${lineNum}` })
      continue
    }

    // Extract and verify hash
    const recordedHash = entry.hash as string
    const { hash: _hash, ...entryWithoutHash } = entry
    const canonical = canonicalize(entryWithoutHash)
    const computedHash = createHash('sha256').update(canonical).digest('hex')

    if (recordedHash !== computedHash) {
      errors.push({
        line: lineNum,
        error: `Hash mismatch on line ${lineNum}: recorded ${recordedHash}, computed ${computedHash}`,
      })
    }

    // Verify prev_hash linkage
    const prevHash = entry.prev_hash as string
    if (prevHash !== previousHash) {
      errors.push({
        line: lineNum,
        error: `prev_hash mismatch on line ${lineNum}: expected ${previousHash}, found ${prevHash}`,
      })
    }

    // Verify sequence monotonicity
    const sequence = entry.sequence as number
    if (sequence <= previousSequence) {
      errors.push({
        line: lineNum,
        error: `Sequence not monotonically increasing on line ${lineNum}: expected > ${previousSequence}, found ${sequence}`,
      })
    }

    previousHash = recordedHash
    previousSequence = sequence
  }

  return {
    valid: errors.length === 0,
    entries: lines.length,
    errors,
  }
}
