export type RoutingErrorCode =
  | 'AUTH_TIMEOUT'
  | 'INVALID_MESSAGE'
  | 'CONSENT_FAILED'
  | 'PROVIDER_NOT_FOUND'
  | 'RELATIONSHIP_EXISTS'
  | 'CEILING_TIMEOUT'
  | 'SERVER_ERROR'

export class RoutingError extends Error {
  constructor(
    public readonly code: RoutingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RoutingError'
  }
}
