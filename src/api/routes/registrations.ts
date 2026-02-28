/**
 * GET /v1/registrations -- list registered entities (neuron + providers).
 * GET /v1/registrations/:id -- get specific provider registration by NPI.
 * POST /v1/registrations -- register a new provider.
 */

import type { ServerResponse } from 'node:http'
import { Value } from '@sinclair/typebox/value'
import { sendJson, readBody } from '../http-utils.js'
import type { ApiRouterDeps } from '../router.js'
import { CreateRegistrationRequestSchema } from '../schemas.js'

export function handleRegistrations(
  res: ServerResponse,
  deps: ApiRouterDeps,
): void {
  const status = deps.registrationService.getStatus()
  const providers = deps.registrationService.listProviders()

  sendJson(res, 200, {
    neuron: status.neuron
      ? {
          organization_npi: status.neuron.organization_npi,
          organization_name: status.neuron.organization_name,
          organization_type: status.neuron.organization_type,
          status: status.neuron.status,
          registration_id: status.neuron.registration_id,
          first_registered_at: status.neuron.first_registered_at,
        }
      : null,
    providers: providers.map((p) => ({
      provider_npi: p.provider_npi,
      provider_name: p.provider_name,
      provider_types: p.provider_types,
      specialty: p.specialty,
      registration_status: p.registration_status,
      axon_provider_id: p.axon_provider_id,
      first_registered_at: p.first_registered_at,
    })),
    total_providers: providers.length,
  })
}

export function handleRegistrationById(
  res: ServerResponse,
  deps: ApiRouterDeps,
  npi: string,
): void {
  const providers = deps.registrationService.listProviders()
  const provider = providers.find((p) => p.provider_npi === npi)

  if (!provider) {
    sendJson(res, 404, { error: 'Registration not found' })
    return
  }

  sendJson(res, 200, {
    provider_npi: provider.provider_npi,
    provider_name: provider.provider_name,
    provider_types: provider.provider_types,
    specialty: provider.specialty,
    registration_status: provider.registration_status,
    axon_provider_id: provider.axon_provider_id,
    first_registered_at: provider.first_registered_at,
  })
}

export async function handleCreateRegistration(
  res: ServerResponse,
  deps: ApiRouterDeps,
  body: string,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!Value.Check(CreateRegistrationRequestSchema, parsed)) {
    const errors = [...Value.Errors(CreateRegistrationRequestSchema, parsed)]
    sendJson(res, 400, {
      error: 'Validation failed',
      details: errors.map((e) => ({ path: e.path, message: e.message })),
    })
    return
  }

  try {
    await deps.registrationService.addProvider(
      parsed.provider_npi,
      parsed.provider_name,
      parsed.provider_types,
      parsed.specialty,
    )

    sendJson(res, 201, {
      provider_npi: parsed.provider_npi,
      provider_name: parsed.provider_name,
      provider_types: parsed.provider_types,
      specialty: parsed.specialty,
      registration_status: 'registered',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed'
    sendJson(res, 500, { error: message })
  }
}
