import { Type, type Static } from '@sinclair/typebox'
import { UuidString, NpiString, IsoDateString } from './common.js'

/** Appointment status lifecycle */
export const AppointmentStatus = Type.Union([
  Type.Literal('scheduled'),
  Type.Literal('confirmed'),
  Type.Literal('checked_in'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
  Type.Literal('no_show'),
])
export type AppointmentStatus = Static<typeof AppointmentStatus>

/** Appointment schema */
export const AppointmentSchema = Type.Object({
  appointment_id: UuidString,
  relationship_id: UuidString,
  provider_npi: NpiString,
  scheduled_at: IsoDateString,
  duration_minutes: Type.Number({ minimum: 1 }),
  status: AppointmentStatus,
  notes: Type.Optional(Type.String()),
  created_at: IsoDateString,
  updated_at: IsoDateString,
})

export type Appointment = Static<typeof AppointmentSchema>

/** Provider availability type */
export const AvailabilityType = Type.Union([
  Type.Literal('recurring'),
  Type.Literal('one_time'),
  Type.Literal('block'),
])
export type AvailabilityType = Static<typeof AvailabilityType>

/** Provider availability schema */
export const ProviderAvailabilitySchema = Type.Object({
  availability_id: UuidString,
  provider_npi: NpiString,
  type: AvailabilityType,
  day_of_week: Type.Optional(Type.Number({ minimum: 0, maximum: 6 })),
  start_time: Type.String(),
  end_time: Type.String(),
  effective_date: Type.Optional(IsoDateString),
  expiry_date: Type.Optional(IsoDateString),
})

export type ProviderAvailability = Static<typeof ProviderAvailabilitySchema>
