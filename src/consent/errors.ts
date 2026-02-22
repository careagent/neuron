/** Typed consent error codes for downstream error handling */
export type ConsentErrorCode = 'INVALID_SIGNATURE' | 'CONSENT_EXPIRED' | 'MALFORMED_TOKEN'

/** Consent verification error with typed error code */
export class ConsentError extends Error {
  readonly code: ConsentErrorCode

  constructor(code: ConsentErrorCode, message: string) {
    super(message)
    this.name = 'ConsentError'
    this.code = code
  }
}
