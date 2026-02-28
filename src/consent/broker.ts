/**
 * Consent broker — orchestrates the full consent flow.
 *
 * Wires together:
 * - WebSocket handshake (routing/handler.ts) for P2P transport
 * - Challenge-response verification (relationships/handshake.ts)
 * - Consent relationship store (consent/relationship-store.ts) for CRUD
 * - Hash-chained, Ed25519-signed audit log (consent/audit-log.ts)
 *
 * The broker is the convergence point of the consent subsystem. It provides
 * a clean API for the rest of the neuron:
 *
 * - handleConsentRequest(ws, message) — Full flow entry point
 * - revokeConsent(relationshipId, actorPublicKey) — Revoke with audit
 * - getAuditLog(relationshipId) — Get audit trail for a relationship
 * - verifyAuditChain(relationshipId) — Verify hash chain integrity
 *
 * Design decisions enforced:
 * - WebSocket for P2P transport (post-handshake communication)
 * - Provider-initiated message flow (provider agent initiates, patient agent responds)
 */

import { type KeyObject } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { StorageEngine } from '../storage/interface.js'
import { ConsentRelationshipStore } from './relationship-store.js'
import { ConsentAuditLog } from './audit-log.js'
import { verifyConsentToken, importPublicKey } from './verifier.js'
import { generateChallenge, verifyChallenge } from './challenge.js'
import { ConsentError } from './errors.js'
import type { ConsentAuditEntry, ConsentAuditAction } from './audit-schemas.js'
import type { ConsentRelationship } from './relationship-schemas.js'

/** Inbound consent request message from a patient agent */
export interface ConsentRequestMessage {
  type: 'consent.request'
  patientAgentId: string
  patientPublicKey: string
  providerPublicKey: string
  consentTokenPayload: string
  consentTokenSignature: string
  scope: string[]
  expiresAt: number
}

/** Challenge message sent to the patient */
export interface ConsentChallengeMessage {
  type: 'consent.challenge'
  nonce: string
}

/** Challenge response from the patient */
export interface ConsentChallengeResponseMessage {
  type: 'consent.challenge_response'
  signedNonce: string
}

/** Consent complete message sent to the patient */
export interface ConsentCompleteMessage {
  type: 'consent.complete'
  relationshipId: string
  status: 'pending' | 'active'
}

/** Consent error message sent to the patient */
export interface ConsentErrorMessage {
  type: 'consent.error'
  code: string
  message: string
}

/** Pending challenge entry with expiry */
interface PendingChallenge {
  request: ConsentRequestMessage
  nonce: string
  expiresAt: number
}

export class ConsentBroker {
  private readonly relationshipStore: ConsentRelationshipStore
  private readonly auditLog: ConsentAuditLog
  private readonly pendingChallenges = new Map<string, PendingChallenge>()

  constructor(
    private readonly storage: StorageEngine,
    private readonly neuronPrivateKey: KeyObject,
    private readonly neuronPublicKey: KeyObject,
  ) {
    this.relationshipStore = new ConsentRelationshipStore(storage)
    this.auditLog = new ConsentAuditLog(storage, neuronPrivateKey, neuronPublicKey)
  }

  /**
   * Full consent flow entry point.
   *
   * Handles a WebSocket consent request by:
   * 1. Parsing and validating the consent request message
   * 2. Verifying the consent token signature
   * 3. Sending a challenge nonce
   * 4. Waiting for the signed challenge response
   * 5. Verifying the challenge response
   * 6. Creating a relationship record (status: pending)
   * 7. Writing a consent.created audit entry
   * 8. Sending the consent complete message
   *
   * @param ws - The WebSocket connection to the patient agent
   * @param message - The parsed consent request message
   */
  handleConsentRequest(ws: WebSocket, message: ConsentRequestMessage): void {
    // Step 1: Verify the consent token signature
    let publicKey: KeyObject
    try {
      publicKey = importPublicKey(message.patientPublicKey)
      verifyConsentToken(
        {
          payload: Buffer.from(message.consentTokenPayload, 'base64url'),
          signature: Buffer.from(message.consentTokenSignature, 'base64url'),
        },
        publicKey,
      )
    } catch (err) {
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: err instanceof ConsentError ? err.code : 'SERVER_ERROR',
        message: err instanceof Error ? err.message : 'Consent token verification failed',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4003, 'Consent verification failed')
      return
    }

    // Step 2: Generate and send challenge
    const nonce = generateChallenge()

    // Hard cap on pending challenges to prevent memory exhaustion
    if (this.pendingChallenges.size >= 1000) {
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: 'SERVER_BUSY',
        message: 'Too many pending handshakes',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4003, 'Server busy')
      return
    }

    this.pendingChallenges.set(nonce, {
      request: message,
      nonce,
      expiresAt: Date.now() + 30_000,
    })

    // Clean up expired challenges
    this.cleanExpiredChallenges()

    const challengeMsg: ConsentChallengeMessage = {
      type: 'consent.challenge',
      nonce,
    }
    ws.send(JSON.stringify(challengeMsg))

    // Step 3: Wait for challenge response
    ws.once('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const errorMsg: ConsentErrorMessage = {
          type: 'consent.error',
          code: 'INVALID_MESSAGE',
          message: 'Binary frames are not supported',
        }
        ws.send(JSON.stringify(errorMsg))
        ws.close(4002, 'Binary not supported')
        return
      }

      this.handleChallengeResponse(ws, nonce, data.toString())
    })
  }

  /**
   * Revoke a consent relationship with audit logging.
   *
   * Transitions the relationship to 'revoked' status and writes
   * a consent.revoked audit entry.
   *
   * @param relationshipId - The relationship to revoke
   * @param actorPublicKey - Public key of the actor performing the revocation
   * @returns The updated relationship
   * @throws Error if relationship not found or transition invalid
   */
  revokeConsent(relationshipId: string, actorPublicKey: string): ConsentRelationship {
    const relationship = this.relationshipStore.getById(relationshipId)
    if (!relationship) {
      throw new Error(`Consent relationship ${relationshipId} not found`)
    }

    const updated = this.relationshipStore.update(relationshipId, { status: 'revoked' })

    this.auditLog.append(
      'consent.revoked',
      relationshipId,
      actorPublicKey,
      {
        previousStatus: relationship.status,
        patientPublicKey: relationship.patientPublicKey,
        providerPublicKey: relationship.providerPublicKey,
      },
    )

    return updated
  }

  /**
   * Activate a pending consent relationship with audit logging.
   *
   * Transitions the relationship from 'pending' to 'active' and writes
   * a consent.activated audit entry.
   *
   * @param relationshipId - The relationship to activate
   * @param actorPublicKey - Public key of the actor performing the activation
   * @returns The updated relationship
   * @throws Error if relationship not found or transition invalid
   */
  activateConsent(relationshipId: string, actorPublicKey: string): ConsentRelationship {
    const relationship = this.relationshipStore.getById(relationshipId)
    if (!relationship) {
      throw new Error(`Consent relationship ${relationshipId} not found`)
    }

    const updated = this.relationshipStore.update(relationshipId, { status: 'active' })

    this.auditLog.append(
      'consent.activated',
      relationshipId,
      actorPublicKey,
      {
        previousStatus: relationship.status,
        patientPublicKey: relationship.patientPublicKey,
        providerPublicKey: relationship.providerPublicKey,
      },
    )

    return updated
  }

  /**
   * Expire stale relationships and write audit entries for each.
   *
   * Finds all active relationships past their expiresAt timestamp,
   * transitions them to 'expired', and writes consent.expired audit entries.
   *
   * @returns The number of relationships expired
   */
  expireStaleConsents(): number {
    const now = Date.now()

    // Find active relationships that should be expired (before bulk update)
    const candidates = this.storage.all<{
      id: string
      patient_public_key: string
      provider_public_key: string
    }>(
      "SELECT id, patient_public_key, provider_public_key FROM consent_relationships WHERE status = 'active' AND expires_at <= ?",
      [now],
    )

    if (candidates.length === 0) return 0

    // Perform the bulk status update
    const count = this.relationshipStore.expireStale(now)

    // Write audit entries for each expired relationship
    for (const candidate of candidates) {
      this.auditLog.append(
        'consent.expired',
        candidate.id,
        'system',
        {
          reason: 'TTL exceeded',
          patientPublicKey: candidate.patient_public_key,
          providerPublicKey: candidate.provider_public_key,
        },
      )
    }

    return count
  }

  /**
   * Get the audit trail for a relationship.
   *
   * @param relationshipId - The relationship to get the audit trail for
   * @returns Array of audit entries ordered by timestamp
   */
  getAuditLog(relationshipId: string): ConsentAuditEntry[] {
    return this.auditLog.getByRelationship(relationshipId)
  }

  /**
   * Verify the hash chain integrity for a relationship's audit trail.
   *
   * Checks that each entry's hash matches the recomputed hash and
   * that each Ed25519 signature is valid.
   *
   * @param relationshipId - The relationship to verify
   * @returns Verification result with error details
   */
  verifyAuditChain(relationshipId: string): { valid: boolean; entries: number; errors: string[] } {
    return this.auditLog.verifyChain(relationshipId)
  }

  /**
   * Verify the entire global audit chain.
   */
  verifyGlobalAuditChain(): { valid: boolean; entries: number; errors: string[] } {
    return this.auditLog.verifyGlobalChain()
  }

  /**
   * Get a relationship by ID.
   */
  getRelationship(id: string): ConsentRelationship | undefined {
    return this.relationshipStore.getById(id)
  }

  /**
   * Handle the challenge response from the patient agent.
   */
  private handleChallengeResponse(ws: WebSocket, nonce: string, raw: string): void {
    // Look up pending challenge
    const pending = this.pendingChallenges.get(nonce)
    if (!pending) {
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: 'INVALID_NONCE',
        message: 'Unknown or already-used challenge nonce',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4003, 'Invalid nonce')
      return
    }

    // Check TTL
    if (Date.now() > pending.expiresAt) {
      this.pendingChallenges.delete(nonce)
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: 'CHALLENGE_EXPIRED',
        message: 'Challenge nonce has expired',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4003, 'Challenge expired')
      return
    }

    // Delete from map (single-use)
    this.pendingChallenges.delete(nonce)

    // Parse challenge response
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: 'INVALID_MESSAGE',
        message: 'Message is not valid JSON',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4002, 'Invalid JSON')
      return
    }

    const response = parsed as ConsentChallengeResponseMessage

    // Verify challenge-response signature
    const publicKey = importPublicKey(pending.request.patientPublicKey)
    const signedNonce = Buffer.from(response.signedNonce, 'base64url')
    const challengeValid = verifyChallenge(nonce, signedNonce, publicKey)

    if (!challengeValid) {
      const errorMsg: ConsentErrorMessage = {
        type: 'consent.error',
        code: 'INVALID_SIGNATURE',
        message: 'Challenge-response signature verification failed',
      }
      ws.send(JSON.stringify(errorMsg))
      ws.close(4003, 'Signature verification failed')
      return
    }

    // Create relationship record (status: pending per the consent flow)
    const relationship = this.relationshipStore.create({
      patientPublicKey: pending.request.patientPublicKey,
      providerPublicKey: pending.request.providerPublicKey,
      scope: pending.request.scope,
      consentToken: `${pending.request.consentTokenPayload}.${pending.request.consentTokenSignature}`,
      expiresAt: pending.request.expiresAt,
    })

    // Write audit entry: consent.created
    this.auditLog.append(
      'consent.created',
      relationship.id,
      pending.request.patientPublicKey,
      {
        patientPublicKey: pending.request.patientPublicKey,
        providerPublicKey: pending.request.providerPublicKey,
        scope: pending.request.scope,
      },
    )

    // Send consent complete message
    const completeMsg: ConsentCompleteMessage = {
      type: 'consent.complete',
      relationshipId: relationship.id,
      status: 'pending',
    }
    ws.send(JSON.stringify(completeMsg))
    ws.close(1000, 'Consent handshake complete')
  }

  /**
   * Remove expired challenges from the pending map.
   */
  private cleanExpiredChallenges(): void {
    const now = Date.now()
    for (const [nonce, challenge] of this.pendingChallenges) {
      if (now > challenge.expiresAt) {
        this.pendingChallenges.delete(nonce)
      }
    }
  }
}
