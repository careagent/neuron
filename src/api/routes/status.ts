/**
 * GET /v1/status -- returns Neuron operational status.
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'
import type { ApiRouterDeps } from '../router.js'

export function handleStatus(res: ServerResponse, deps: ApiRouterDeps): void {
  const regStatus = deps.registrationService.getStatus()
  const sessions = deps.protocolServer.activeSessions()

  sendJson(res, 200, {
    status: 'running',
    uptime_seconds: Math.floor(process.uptime()),
    organization: {
      npi: deps.config.organization.npi,
      name: deps.config.organization.name,
    },
    axon: {
      status: regStatus.neuron?.status ?? 'unregistered',
    },
    active_sessions: sessions.length,
    providers: regStatus.neuron?.providers?.length ?? 0,
  })
}
