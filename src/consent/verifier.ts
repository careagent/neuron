import { verify, createPublicKey, type KeyObject } from 'node:crypto'
import type { ConsentToken, ConsentClaims } from './token.js'
import { ConsentError } from './errors.js'

/**
 * Import an Ed25519 public key from its raw 32-byte base64url representation.
 * Uses JWK format for clean import without manual DER prefix construction.
 */
export function importPublicKey(rawKeyBase64url: string): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rawKeyBase64url },
    format: 'jwk',
  })
}

/**
 * Verify a consent token's Ed25519 signature and claims.
 *
 * Stateless -- no internal cache or trust state. Re-verifies fully
 * on every call per CSNT-02. Consent scope (consented_actions) is
 * extracted and returned without interpretation per CSNT-04.
 *
 * Verification order: signature -> JSON parse -> expiration check.
 *
 * CRITICAL: Algorithm parameter MUST be `null` for Ed25519
 * (not 'sha256' or 'ed25519'). Ed25519 uses SHA-512 internally.
 */
export function verifyConsentToken(token: ConsentToken, publicKey: KeyObject): ConsentClaims {
  // 1. Verify Ed25519 signature
  const valid = verify(null, token.payload, publicKey, token.signature)
  if (!valid) {
    throw new ConsentError('INVALID_SIGNATURE', 'Ed25519 signature verification failed')
  }

  // 2. Parse claims from payload
  let claims: ConsentClaims
  try {
    claims = JSON.parse(token.payload.toString('utf-8')) as ConsentClaims
  } catch {
    throw new ConsentError('MALFORMED_TOKEN', 'Token payload is not valid JSON')
  }

  // 3. Check expiration (CSNT-03)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (claims.exp <= nowSeconds) {
    throw new ConsentError(
      'CONSENT_EXPIRED',
      `Token expired at ${new Date(claims.exp * 1000).toISOString()}`,
    )
  }

  return claims
}
