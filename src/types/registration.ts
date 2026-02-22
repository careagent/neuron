import { Type, type Static } from '@sinclair/typebox'
import { NpiString, IsoDateString } from './common.js'

/** Provider registration status with Axon */
export const ProviderRegistrationStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('registered'),
  Type.Literal('failed'),
])
export type ProviderRegistrationStatus = Static<typeof ProviderRegistrationStatus>

/** Per-provider registration record */
export const ProviderRegistrationSchema = Type.Object({
  provider_npi: NpiString,
  axon_provider_id: Type.Optional(Type.String()),
  registration_status: ProviderRegistrationStatus,
  first_registered_at: Type.Optional(IsoDateString),
  last_heartbeat_at: Type.Optional(IsoDateString),
  last_axon_response_at: Type.Optional(IsoDateString),
})
export type ProviderRegistration = Static<typeof ProviderRegistrationSchema>

/** Neuron-level registration status with Axon */
export const NeuronRegistrationStatus = Type.Union([
  Type.Literal('unregistered'),
  Type.Literal('pending'),
  Type.Literal('registered'),
  Type.Literal('suspended'),
])
export type NeuronRegistrationStatus = Static<typeof NeuronRegistrationStatus>

/** Full neuron registration state including all providers */
export const NeuronRegistrationStateSchema = Type.Object({
  organization_npi: NpiString,
  organization_name: Type.String(),
  organization_type: Type.String(),
  axon_registry_url: Type.String(),
  neuron_endpoint_url: Type.String(),
  registration_id: Type.Optional(Type.String()),
  axon_bearer_token: Type.Optional(Type.String()),
  status: NeuronRegistrationStatus,
  first_registered_at: Type.Optional(IsoDateString),
  last_heartbeat_at: Type.Optional(IsoDateString),
  last_axon_response_at: Type.Optional(IsoDateString),
  providers: Type.Array(ProviderRegistrationSchema),
})
export type NeuronRegistrationState = Static<typeof NeuronRegistrationStateSchema>
