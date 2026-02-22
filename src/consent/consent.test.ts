import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyConsentToken, importPublicKey } from './verifier.js'
import { ConsentError } from './errors.js'
import type { ConsentToken, ConsentClaims } from './token.js'

describe('ConsentVerifier', () => {
  // Generate a test Ed25519 key pair
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  const publicKeyBase64url = jwk.x!

  /** Helper: create a signed consent token from claims */
  function makeToken(claims: Record<string, unknown>): ConsentToken {
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    const signature = sign(null, payload, privateKey)
    return { payload, signature }
  }

  /** Helper: create valid claims with future expiration */
  function validClaims(): Record<string, unknown> {
    return {
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      consented_actions: ['office_visit', 'lab_results'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    }
  }

  describe('importPublicKey', () => {
    it('should import an Ed25519 public key from base64url-encoded raw bytes', () => {
      const keyObject = importPublicKey(publicKeyBase64url)
      expect(keyObject).toBeDefined()
      expect(keyObject.type).toBe('public')
      expect(keyObject.asymmetricKeyType).toBe('ed25519')
    })
  })

  describe('verifyConsentToken', () => {
    it('should verify a valid consent token and return parsed claims', () => {
      const claims = validClaims()
      const token = makeToken(claims)
      const keyObject = importPublicKey(publicKeyBase64url)

      const result = verifyConsentToken(token, keyObject)

      expect(result.patient_agent_id).toBe('patient-001')
      expect(result.provider_npi).toBe('1234567893')
      expect(result.consented_actions).toEqual(['office_visit', 'lab_results'])
      expect(result.iat).toBe(claims.iat)
      expect(result.exp).toBe(claims.exp)
    })

    it('should reject an expired token with CONSENT_EXPIRED error code', () => {
      const token = makeToken({
        patient_agent_id: 'patient-001',
        provider_npi: '1234567893',
        consented_actions: [],
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
      })
      const keyObject = importPublicKey(publicKeyBase64url)

      expect(() => verifyConsentToken(token, keyObject)).toThrow(ConsentError)

      try {
        verifyConsentToken(token, keyObject)
      } catch (err) {
        expect(err).toBeInstanceOf(ConsentError)
        expect((err as ConsentError).code).toBe('CONSENT_EXPIRED')
        expect((err as ConsentError).name).toBe('ConsentError')
      }
    })

    it('should reject a tampered signature with INVALID_SIGNATURE error code', () => {
      const token = makeToken(validClaims())
      const keyObject = importPublicKey(publicKeyBase64url)

      // Tamper with the signature
      const tamperedSig = Buffer.from(token.signature)
      tamperedSig[0] ^= 0xff

      expect(() =>
        verifyConsentToken({ payload: token.payload, signature: tamperedSig }, keyObject),
      ).toThrow(ConsentError)

      try {
        verifyConsentToken({ payload: token.payload, signature: tamperedSig }, keyObject)
      } catch (err) {
        expect(err).toBeInstanceOf(ConsentError)
        expect((err as ConsentError).code).toBe('INVALID_SIGNATURE')
      }
    })

    it('should reject non-JSON payload with MALFORMED_TOKEN error code', () => {
      // Create a token with non-JSON payload, signed validly
      const nonJsonPayload = Buffer.from('this is not json', 'utf-8')
      const signature = sign(null, nonJsonPayload, privateKey)
      const keyObject = importPublicKey(publicKeyBase64url)

      expect(() =>
        verifyConsentToken({ payload: nonJsonPayload, signature }, keyObject),
      ).toThrow(ConsentError)

      try {
        verifyConsentToken({ payload: nonJsonPayload, signature }, keyObject)
      } catch (err) {
        expect(err).toBeInstanceOf(ConsentError)
        expect((err as ConsentError).code).toBe('MALFORMED_TOKEN')
      }
    })

    it('should return consented_actions as-is without interpretation (CSNT-04)', () => {
      const arbitraryActions = [
        'custom_action_xyz',
        'anything.goes/here',
        'read:medical_records',
        '',
      ]
      const token = makeToken({
        ...validClaims(),
        consented_actions: arbitraryActions,
      })
      const keyObject = importPublicKey(publicKeyBase64url)

      const result = verifyConsentToken(token, keyObject)
      expect(result.consented_actions).toEqual(arbitraryActions)
    })

    it('should be stateless -- no cached trust between calls (CSNT-02)', () => {
      const keyObject = importPublicKey(publicKeyBase64url)

      // First call: valid token succeeds
      const token1 = makeToken(validClaims())
      const result1 = verifyConsentToken(token1, keyObject)
      expect(result1.patient_agent_id).toBe('patient-001')

      // Second call with expired token: must fail (no cached trust)
      const expiredToken = makeToken({
        ...validClaims(),
        exp: Math.floor(Date.now() / 1000) - 1, // expired
      })

      expect(() => verifyConsentToken(expiredToken, keyObject)).toThrow(ConsentError)
    })

    it('should handle optional nonce field in claims', () => {
      const token = makeToken({
        ...validClaims(),
        nonce: 'unique-nonce-12345',
      })
      const keyObject = importPublicKey(publicKeyBase64url)

      const result = verifyConsentToken(token, keyObject)
      expect(result.nonce).toBe('unique-nonce-12345')
    })

    it('should reject a token signed with a different key', () => {
      const { privateKey: otherPrivateKey } = generateKeyPairSync('ed25519')
      const keyObject = importPublicKey(publicKeyBase64url) // original key

      // Sign with a different private key
      const payload = Buffer.from(JSON.stringify(validClaims()), 'utf-8')
      const signature = sign(null, payload, otherPrivateKey)

      expect(() =>
        verifyConsentToken({ payload, signature }, keyObject),
      ).toThrow(ConsentError)

      try {
        verifyConsentToken({ payload, signature }, keyObject)
      } catch (err) {
        expect((err as ConsentError).code).toBe('INVALID_SIGNATURE')
      }
    })
  })
})
