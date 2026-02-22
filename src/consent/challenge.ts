/**
 * Challenge-response utilities for identity verification (RELN-04).
 *
 * Generates random challenge nonces and verifies Ed25519 signatures
 * over those nonces to prove patient identity during the consent handshake.
 */

import { randomBytes, verify, type KeyObject } from 'node:crypto'

/**
 * Generate a cryptographically random challenge nonce.
 * Returns 32 bytes (256 bits of entropy) as a hex string.
 */
export function generateChallenge(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Verify an Ed25519 signature over a challenge nonce.
 *
 * @param nonce - The original hex-encoded challenge nonce
 * @param signedNonce - The Ed25519 signature over the nonce bytes
 * @param publicKey - The patient's Ed25519 public key
 * @returns true if the signature is valid
 *
 * CRITICAL: Algorithm parameter MUST be `null` for Ed25519.
 * Ed25519 uses SHA-512 internally and does not accept external algorithm.
 */
export function verifyChallenge(nonce: string, signedNonce: Buffer, publicKey: KeyObject): boolean {
  const nonceBuffer = Buffer.from(nonce, 'hex')
  return verify(null, nonceBuffer, publicKey, signedNonce)
}
