/**
 * GET /health -- unauthenticated health check endpoint.
 *
 * Returns basic liveness information. No API key required.
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'

export function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  })
}
