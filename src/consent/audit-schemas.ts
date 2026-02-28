/**
 * TypeBox schemas for consent audit log entries.
 *
 * The consent audit log is a hash-chained, Ed25519-signed append-only log
 * stored in SQLite. Each entry records a consent lifecycle event
 * (created, activated, revoked, expired) with a cryptographic hash chain
 * linking it to the previous entry and an Ed25519 signature from the neuron.
 */

import { Type, type Static } from '@sinclair/typebox'

/** Consent audit action types */
export const ConsentAuditActionSchema = Type.Union([
  Type.Literal('consent.created'),
  Type.Literal('consent.activated'),
  Type.Literal('consent.revoked'),
  Type.Literal('consent.expired'),
])
export type ConsentAuditAction = Static<typeof ConsentAuditActionSchema>

/** Consent audit log entry schema */
export const ConsentAuditEntrySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  timestamp: Type.Number(),
  action: ConsentAuditActionSchema,
  relationshipId: Type.String(),
  actorPublicKey: Type.String(),
  details: Type.String(),
  previousHash: Type.String(),
  hash: Type.String(),
  signature: Type.String(),
})
export type ConsentAuditEntry = Static<typeof ConsentAuditEntrySchema>
