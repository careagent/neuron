import { Type, type Static } from '@sinclair/typebox'
import { UuidString, NpiString, IsoDateString } from './common.js'

/** Termination record schema */
export const TerminationRecordSchema = Type.Object({
  termination_id: UuidString,
  relationship_id: UuidString,
  provider_npi: NpiString,
  reason: Type.String(),
  terminated_at: IsoDateString,
  audit_entry_sequence: Type.Optional(Type.Number()),
})

export type TerminationRecord = Static<typeof TerminationRecordSchema>
