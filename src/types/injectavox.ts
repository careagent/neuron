/**
 * TypeBox schemas for InjectaVox clinical data ingestion.
 *
 * InjectaVox is the mobile documentation app that pushes clinical visit
 * data (notes, summaries, vitals) to the neuron endpoint. The provider
 * agent consumes this data for clinical decision support.
 *
 * All fields follow HL7/FHIR-aligned naming where practical.
 */

import { Type, type Static } from '@sinclair/typebox'
import { NpiString, IsoDateString } from './common.js'

/** UUID validated with regex pattern (TypeBox format: 'uuid' is not enforced at runtime) */
const UuidPattern = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
})

/** Visit type enum */
export const VisitTypeSchema = Type.Union([
  Type.Literal('in_person'),
  Type.Literal('telehealth'),
  Type.Literal('follow_up'),
])
export type VisitType = Static<typeof VisitTypeSchema>

/** Vitals captured during a visit (all optional) */
export const VitalsSchema = Type.Object({
  blood_pressure: Type.Optional(Type.String()),
  heart_rate: Type.Optional(Type.Number()),
  temperature: Type.Optional(Type.Number()),
  weight: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
})
export type Vitals = Static<typeof VitalsSchema>

/** Medication entry */
export const MedicationSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  dosage: Type.String({ minLength: 1 }),
  frequency: Type.String({ minLength: 1 }),
  route: Type.String({ minLength: 1 }),
})
export type Medication = Static<typeof MedicationSchema>

/** Follow-up instructions */
export const FollowUpSchema = Type.Object({
  date: IsoDateString,
  instructions: Type.String(),
})
export type FollowUp = Static<typeof FollowUpSchema>

/** Full InjectaVox visit payload */
export const InjectaVoxPayloadSchema = Type.Object({
  visit_id: UuidPattern,
  provider_npi: NpiString,
  patient_id: Type.String({ minLength: 1 }),
  visit_type: VisitTypeSchema,
  visit_date: IsoDateString,
  chief_complaint: Type.String({ minLength: 1 }),
  clinical_notes: Type.String(),
  vitals: Type.Optional(VitalsSchema),
  assessment: Type.String(),
  plan: Type.String(),
  medications: Type.Optional(Type.Array(MedicationSchema)),
  follow_up: Type.Optional(FollowUpSchema),
})
export type InjectaVoxPayload = Static<typeof InjectaVoxPayloadSchema>

/** Stored visit row (payload + metadata) */
export const InjectaVoxVisitSchema = Type.Object({
  visit_id: UuidPattern,
  provider_npi: NpiString,
  patient_id: Type.String(),
  visit_type: VisitTypeSchema,
  visit_date: IsoDateString,
  chief_complaint: Type.String(),
  clinical_notes: Type.String(),
  vitals: Type.Optional(Type.String()),
  assessment: Type.String(),
  plan: Type.String(),
  medications: Type.Optional(Type.String()),
  follow_up: Type.Optional(Type.String()),
  processed: Type.Number(),
  ingested_at: IsoDateString,
})
export type InjectaVoxVisit = Static<typeof InjectaVoxVisitSchema>
