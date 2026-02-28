/**
 * TypeBox schemas for REST API request/response validation.
 *
 * Used for runtime validation of incoming POST bodies.
 */

import { Type, type Static } from '@sinclair/typebox'

/** Request body for POST /v1/registrations */
export const CreateRegistrationRequestSchema = Type.Object({
  provider_npi: Type.String({ pattern: '^\\d{10}$' }),
  provider_name: Type.String({ minLength: 1 }),
  provider_types: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  specialty: Type.Optional(Type.String()),
})
export type CreateRegistrationRequest = Static<typeof CreateRegistrationRequestSchema>
