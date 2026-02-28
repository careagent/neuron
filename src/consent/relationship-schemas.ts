/**
 * TypeBox schemas for consent relationship data model.
 *
 * Consent relationships are created as the output of the WebSocket consent
 * handshake. They track the consent lifecycle between a patient and provider
 * using public keys as identifiers, with proper status transitions and
 * time-based expiry.
 */

import { Type, type Static } from '@sinclair/typebox'

/** Consent relationship status enum */
export const ConsentRelationshipStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('active'),
  Type.Literal('revoked'),
  Type.Literal('expired'),
])
export type ConsentRelationshipStatus = Static<typeof ConsentRelationshipStatus>

/** Consent relationship record schema */
export const ConsentRelationshipSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  patientPublicKey: Type.String(),
  providerPublicKey: Type.String(),
  scope: Type.Array(Type.String()),
  status: ConsentRelationshipStatus,
  consentToken: Type.String(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  expiresAt: Type.Number(),
})
export type ConsentRelationship = Static<typeof ConsentRelationshipSchema>

/** Fields that can be updated on an existing consent relationship */
export const ConsentRelationshipUpdateSchema = Type.Partial(
  Type.Object({
    status: ConsentRelationshipStatus,
    scope: Type.Array(Type.String()),
    consentToken: Type.String(),
    expiresAt: Type.Number(),
  }),
)
export type ConsentRelationshipUpdate = Static<typeof ConsentRelationshipUpdateSchema>

/**
 * Valid status transitions for consent relationships.
 *
 * - pending → active (consent confirmed)
 * - active → revoked (consent withdrawn by patient or provider)
 * - active → expired (TTL exceeded)
 * - No other transitions allowed (revoked/expired are terminal)
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['active'],
  active: ['revoked', 'expired'],
  revoked: [],
  expired: [],
}

/**
 * Validate a status transition is allowed.
 *
 * @param current - The current status
 * @param next - The desired next status
 * @returns true if the transition is valid
 */
export function validateTransition(current: string, next: string): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false
}
