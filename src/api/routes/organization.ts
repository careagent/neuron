/**
 * GET /v1/organization — returns organization info.
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'
import type { ApiRouterDeps } from '../router.js'

export function handleOrganization(res: ServerResponse, deps: ApiRouterDeps): void {
  const { config, registrationService } = deps
  const status = registrationService.getStatus()

  sendJson(res, 200, {
    npi: config.organization.npi,
    name: config.organization.name,
    type: config.organization.type,
    axon_status: status.neuron?.status ?? 'unregistered',
    providers: status.neuron?.providers?.length ?? 0,
  })
}
