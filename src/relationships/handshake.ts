/**
 * Consent handshake handler (Neuron side).
 *
 * Orchestrates the multi-step handshake protocol to establish care
 * relationships. Coordinates challenge-response identity verification
 * with consent token validation to create new relationships securely.
 */

import { randomUUID } from 'node:crypto'
import { verifyConsentToken, importPublicKey } from '../consent/verifier.js'
import { ConsentError } from '../consent/errors.js'
import type { ConsentClaims } from '../consent/token.js'
import { generateChallenge, verifyChallenge } from '../consent/challenge.js'
import type { RelationshipStore } from './store.js'
import type { AuditLogger, AuditEvent } from '../audit/logger.js'

/** Handshake initiation from the patient's CareAgent */
export interface HandshakeInit {
  patient_agent_id: string
  provider_npi: string
  patient_public_key: string
}

/** Challenge sent back to the patient for identity proof */
export interface HandshakeChallenge {
  nonce: string
  provider_npi: string
  organization_npi: string
}

/** Patient's response to the challenge with signed nonce and consent token */
export interface ChallengeResponse {
  /** Base64url-encoded Ed25519 signature over the challenge nonce */
  signed_nonce: string
  /** Base64url-encoded consent token payload */
  consent_token_payload: string
  /** Base64url-encoded consent token signature */
  consent_token_signature: string
}

/** Pending challenge entry with expiry */
interface PendingChallenge {
  init: HandshakeInit
  expiresAt: number
}

export class ConsentHandshakeHandler {
  private readonly pendingChallenges: Map<string, PendingChallenge> = new Map()

  constructor(
    private readonly store: RelationshipStore,
    private readonly organizationNpi: string,
    private readonly auditLogger?: AuditLogger,
  ) {}

  /**
   * Start a handshake by generating a challenge nonce.
   *
   * The nonce has a 30-second TTL. A hard cap of 1000 pending challenges
   * prevents memory exhaustion from unanswered handshakes.
   */
  startHandshake(init: HandshakeInit): HandshakeChallenge {
    // Hard cap to prevent memory exhaustion
    if (this.pendingChallenges.size >= 1000) {
      throw new Error('Too many pending handshakes')
    }

    const nonce = generateChallenge()

    this.pendingChallenges.set(nonce, {
      init,
      expiresAt: Date.now() + 30_000,
    })

    // Clean up expired challenges on each new handshake start
    this.cleanExpiredChallenges()

    return {
      nonce,
      provider_npi: init.provider_npi,
      organization_npi: this.organizationNpi,
    }
  }

  /**
   * Complete a handshake by verifying the challenge response and consent token.
   *
   * Steps:
   * 1. Look up pending challenge by nonce
   * 2. Check TTL expiry
   * 3. Verify Ed25519 challenge-response signature
   * 4. Verify consent token signature and claims
   * 5. Validate provider NPI matches between token and init
   * 6. Create active relationship record
   * 7. Log audit event
   *
   * @returns The new relationship_id
   */
  completeHandshake(nonce: string, response: ChallengeResponse): string {
    // (a) Look up nonce in pending challenges
    const pending = this.pendingChallenges.get(nonce)
    if (!pending) {
      throw new ConsentError('MALFORMED_TOKEN', 'Unknown or already-used challenge nonce')
    }

    // (b) Check TTL
    if (Date.now() > pending.expiresAt) {
      this.pendingChallenges.delete(nonce)
      throw new ConsentError('CONSENT_EXPIRED', 'Challenge nonce has expired')
    }

    // (c) Delete from map (nonce is single-use)
    this.pendingChallenges.delete(nonce)

    const { init } = pending

    // (d) Import patient public key
    const publicKey = importPublicKey(init.patient_public_key)

    // (e) Verify challenge-response signature
    const signedNonce = Buffer.from(response.signed_nonce, 'base64url')
    const challengeValid = verifyChallenge(nonce, signedNonce, publicKey)
    if (!challengeValid) {
      throw new ConsentError('INVALID_SIGNATURE', 'Challenge-response signature verification failed')
    }

    // (f) Verify consent token
    const claims: ConsentClaims = verifyConsentToken(
      {
        payload: Buffer.from(response.consent_token_payload, 'base64url'),
        signature: Buffer.from(response.consent_token_signature, 'base64url'),
      },
      publicKey,
    )

    // (g) Validate provider NPI matches
    if (claims.provider_npi !== init.provider_npi) {
      throw new ConsentError(
        'MALFORMED_TOKEN',
        `Provider NPI mismatch: token claims ${claims.provider_npi}, handshake init ${init.provider_npi}`,
      )
    }

    // (h) Create relationship record
    const relationshipId = randomUUID()
    const now = new Date().toISOString()

    this.store.create({
      relationship_id: relationshipId,
      patient_agent_id: init.patient_agent_id,
      provider_npi: init.provider_npi,
      status: 'active',
      consented_actions: claims.consented_actions,
      patient_public_key: init.patient_public_key,
      created_at: now,
      updated_at: now,
    })

    // (i) Log audit event
    if (this.auditLogger) {
      this.auditLogger.append({
        category: 'consent',
        action: 'consent.relationship_established',
        actor: init.patient_agent_id,
        details: {
          relationship_id: relationshipId,
          provider_npi: init.provider_npi,
          consented_actions: claims.consented_actions,
        },
      } satisfies AuditEvent)
    }

    // (j) Return relationship ID
    return relationshipId
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
