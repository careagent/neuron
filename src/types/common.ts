import { Type, type Static } from '@sinclair/typebox'

/** 10-digit NPI string */
export const NpiString = Type.String({ pattern: '^\\d{10}$' })
export type NpiString = Static<typeof NpiString>

/** UUID string identifier */
export const UuidString = Type.String({ format: 'uuid' })
export type UuidString = Static<typeof UuidString>

/** ISO 8601 timestamp string */
export const IsoDateString = Type.String()
export type IsoDateString = Static<typeof IsoDateString>

/** Organization type enum */
export const OrganizationType = Type.Union([
  Type.Literal('practice'),
  Type.Literal('hospital'),
  Type.Literal('pharmacy'),
  Type.Literal('imaging_center'),
  Type.Literal('laboratory'),
  Type.Literal('urgent_care'),
  Type.Literal('specialty_clinic'),
  Type.Literal('other'),
])
export type OrganizationType = Static<typeof OrganizationType>
