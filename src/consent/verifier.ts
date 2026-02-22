import type { KeyObject } from 'node:crypto'
import type { ConsentToken, ConsentClaims } from './token.js'

/**
 * Import an Ed25519 public key from its raw 32-byte base64url representation.
 */
export function importPublicKey(_rawKeyBase64url: string): KeyObject {
  throw new Error('Not implemented')
}

/**
 * Verify a consent token's Ed25519 signature and claims.
 * Stateless -- no internal cache or trust state (CSNT-02).
 */
export function verifyConsentToken(_token: ConsentToken, _publicKey: KeyObject): ConsentClaims {
  throw new Error('Not implemented')
}
