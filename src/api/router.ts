/**
 * REST API router with inline auth, CORS, and rate limiting pipeline.
 *
 * Follows the Axon pattern: sequential inline checks, NOT middleware chain.
 * Returns a standard (req, res) handler attachable to a Node.js HTTP server.
 *
 * Request flow:
 *   1. Parse URL
 *   2. Ignore non-API paths (let WebSocket upgrade etc. pass through)
 *   3. CORS headers (before auth/error so preflight always works)
 *   4. Public endpoint check (health, openapi.json -- no auth)
 *   5. Auth check (X-API-Key header)
 *   6. Rate limit check (per-key token bucket)
 *   7. Route dispatch (regex matching, Axon pattern)
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NeuronConfig } from '../types/config.js'
import type { StorageEngine } from '../storage/interface.js'
import type { ApiKeyStore } from './keys.js'
import type { TokenBucketRateLimiter } from './rate-limiter.js'
import type { RelationshipStore } from '../relationships/store.js'
import type { AxonRegistrationService } from '../registration/service.js'
import type { NeuronProtocolServer } from '../routing/server.js'
import type { AuditLogger } from '../audit/logger.js'
import type { ConsentRelationshipStore } from '../consent/relationship-store.js'
import { sendJson, readBody } from './http-utils.js'
import { openapiSpec } from './openapi-spec.js'
import { handleOrganization } from './routes/organization.js'
import { handleRelationships, handleRelationshipById } from './routes/relationships.js'
import { handleStatus } from './routes/status.js'
import { handleOpenApi } from './routes/openapi.js'
import { handleHealth } from './routes/health.js'
import { handleRegistrations, handleRegistrationById, handleCreateRegistration } from './routes/registrations.js'
import { handleConsentStatus } from './routes/consent-status.js'

/** Dependencies injected into the API router and route handlers */
export interface ApiRouterDeps {
  config: NeuronConfig
  storage: StorageEngine
  apiKeyStore: ApiKeyStore
  rateLimiter: TokenBucketRateLimiter
  relationshipStore: RelationshipStore
  registrationService: AxonRegistrationService
  protocolServer: NeuronProtocolServer
  auditLogger?: AuditLogger
  consentRelationshipStore?: ConsentRelationshipStore
}

/** Regex for GET /v1/relationships/:id */
const RELATIONSHIP_BY_ID_RE = /^\/v1\/relationships\/([^/]+)$/

/** Regex for GET /v1/registrations/:id */
const REGISTRATION_BY_ID_RE = /^\/v1\/registrations\/([^/]+)$/

/** Regex for GET /v1/consent/status/:relationship_id */
const CONSENT_STATUS_RE = /^\/v1\/consent\/status\/([^/]+)$/

/**
 * Set CORS headers on the response based on the request Origin and allowed origins config.
 *
 * If the origin is in the allowed list (or '*' is in the list), sets the
 * standard CORS response headers. Otherwise sets nothing (browser will block).
 */
function setCorsHeaders(
  res: ServerResponse,
  req: IncomingMessage,
  corsConfig: NeuronConfig['api']['cors'],
): void {
  const origin = req.headers.origin
  if (!origin) return

  const { allowedOrigins } = corsConfig

  if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    // Origin not allowed -- do NOT set any CORS headers
    return
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

/**
 * Create the REST API request handler.
 *
 * Returns a `(req, res) => void` function that can be attached to an HTTP
 * server's 'request' event. Non-API paths (not starting with /v1/, not
 * /openapi.json, and not /health) are silently ignored so WebSocket and
 * other handlers work.
 */
export function createApiRouter(
  deps: ApiRouterDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse): void => {
    try {
      // 1. Parse URL
      const url = new URL(req.url ?? '', `http://${req.headers.host}`)
      const { pathname, searchParams } = url
      const method = req.method ?? 'GET'

      // 2. Ignore non-API paths (let other handlers deal with them)
      if (
        !pathname.startsWith('/v1/') &&
        pathname !== '/openapi.json' &&
        pathname !== '/health'
      ) {
        return
      }

      // 3. CORS headers FIRST (before any auth/error)
      setCorsHeaders(res, req, deps.config.api.cors)

      // Handle CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // 4. Public endpoint checks -- health and openapi.json need no auth
      if (pathname === '/health') {
        handleHealth(res)
        return
      }

      if (pathname === '/openapi.json') {
        handleOpenApi(res, openapiSpec)
        return
      }

      // 5. Auth check
      const apiKeyHeader = req.headers['x-api-key']
      const rawKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader

      if (!rawKey) {
        sendJson(res, 401, { error: 'Missing API key' })
        if (deps.auditLogger) {
          deps.auditLogger.append({
            category: 'api_access',
            action: 'auth_failure',
            details: { method, path: pathname, reason: 'missing_key' },
          })
        }
        return
      }

      const keyRecord = deps.apiKeyStore.verify(rawKey)
      if (!keyRecord) {
        sendJson(res, 401, { error: 'Invalid API key' })
        if (deps.auditLogger) {
          deps.auditLogger.append({
            category: 'api_access',
            action: 'auth_failure',
            details: { method, path: pathname, reason: 'invalid_key' },
          })
        }
        return
      }

      // 6. Rate limit check
      if (!deps.rateLimiter.consume(keyRecord.key_id)) {
        res.setHeader('Retry-After', String(deps.rateLimiter.retryAfter(keyRecord.key_id)))
        sendJson(res, 429, { error: 'Rate limit exceeded' })
        if (deps.auditLogger) {
          deps.auditLogger.append({
            category: 'api_access',
            action: 'rate_limited',
            details: { method, path: pathname, key_id: keyRecord.key_id },
          })
        }
        return
      }

      // 7. Audit the request
      if (deps.auditLogger) {
        deps.auditLogger.append({
          category: 'api_access',
          action: 'api_request',
          details: { method, path: pathname, key_id: keyRecord.key_id },
        })
      }

      // 8. Route dispatch

      // POST /v1/registrations
      if (method === 'POST' && pathname === '/v1/registrations') {
        readBody(req).then(
          (body) => handleCreateRegistration(res, deps, body),
          () => sendJson(res, 400, { error: 'Failed to read request body' }),
        )
        return
      }

      // All remaining routes are GET-only
      if (method !== 'GET') {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      if (pathname === '/v1/organization') {
        handleOrganization(res, deps)
        return
      }

      if (pathname === '/v1/relationships') {
        handleRelationships(res, deps, searchParams)
        return
      }

      const relationshipMatch = RELATIONSHIP_BY_ID_RE.exec(pathname)
      if (relationshipMatch) {
        handleRelationshipById(res, deps, relationshipMatch[1])
        return
      }

      if (pathname === '/v1/registrations') {
        handleRegistrations(res, deps)
        return
      }

      const registrationMatch = REGISTRATION_BY_ID_RE.exec(pathname)
      if (registrationMatch) {
        handleRegistrationById(res, deps, registrationMatch[1])
        return
      }

      const consentMatch = CONSENT_STATUS_RE.exec(pathname)
      if (consentMatch) {
        handleConsentStatus(res, deps, consentMatch[1])
        return
      }

      if (pathname === '/v1/status') {
        handleStatus(res, deps)
        return
      }

      // Unknown path
      sendJson(res, 404, { error: 'Not found' })
    } catch {
      // Unexpected error -- return 500
      sendJson(res, 500, { error: 'Internal server error' })
    }
  }
}
