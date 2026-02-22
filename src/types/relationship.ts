import { Type, type Static } from '@sinclair/typebox'
import { UuidString, NpiString, IsoDateString } from './common.js'

/** Relationship status enum */
export const RelationshipStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('terminated'),
])
export type RelationshipStatus = Static<typeof RelationshipStatus>

/** Relationship record schema */
export const RelationshipRecordSchema = Type.Object({
  relationship_id: UuidString,
  patient_agent_id: Type.String(),
  provider_npi: NpiString,
  status: RelationshipStatus,
  consented_actions: Type.Array(Type.String()),
  patient_public_key: Type.String(),
  created_at: IsoDateString,
  updated_at: IsoDateString,
})

export type RelationshipRecord = Static<typeof RelationshipRecordSchema>
