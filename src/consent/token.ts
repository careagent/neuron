/** Consent token: raw payload bytes and Ed25519 signature */
export interface ConsentToken {
  /** Raw payload bytes (the signed content) */
  payload: Buffer
  /** Ed25519 signature (64 bytes) */
  signature: Buffer
}

/** Verified consent claims extracted from a consent token payload */
export interface ConsentClaims {
  /** Patient's opaque agent identifier */
  patient_agent_id: string
  /** Target provider NPI */
  provider_npi: string
  /** Actions the patient consents to (opaque to Neuron per CSNT-04) */
  consented_actions: string[]
  /** Expiration Unix timestamp (seconds) */
  exp: number
  /** Issued-at Unix timestamp (seconds) */
  iat: number
  /** Optional nonce for replay prevention */
  nonce?: string
}
