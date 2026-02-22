/**
 * GET /openapi.json -- returns the OpenAPI 3.1 specification.
 *
 * This endpoint does NOT require authentication.
 */

import type { ServerResponse } from 'node:http'
import { sendJson } from '../http-utils.js'
import type { OpenapiSpec } from '../openapi-spec.js'

export function handleOpenApi(res: ServerResponse, spec: OpenapiSpec): void {
  sendJson(res, 200, spec)
}
