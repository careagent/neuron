import { Type, type Static } from '@sinclair/typebox'
import { UuidString, NpiString, IsoDateString } from './common.js'

/** CPT code entry schema */
export const CptEntrySchema = Type.Object({
  code: Type.String(),
  description: Type.String(),
  modifiers: Type.Optional(Type.Array(Type.String())),
  units: Type.Number({ minimum: 1, default: 1 }),
})

export type CptEntry = Static<typeof CptEntrySchema>

/** Billing status lifecycle */
export const BillingStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('submitted'),
  Type.Literal('accepted'),
  Type.Literal('denied'),
  Type.Literal('appealed'),
])
export type BillingStatus = Static<typeof BillingStatus>

/** Billing record schema */
export const BillingRecordSchema = Type.Object({
  billing_id: UuidString,
  relationship_id: UuidString,
  provider_npi: NpiString,
  appointment_id: Type.Optional(UuidString),
  cpt_entries: Type.Array(CptEntrySchema),
  icd10_codes: Type.Array(Type.String()),
  status: BillingStatus,
  total_amount: Type.Optional(Type.Number()),
  created_at: IsoDateString,
  updated_at: IsoDateString,
})

export type BillingRecord = Static<typeof BillingRecordSchema>
