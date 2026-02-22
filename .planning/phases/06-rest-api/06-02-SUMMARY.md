---
phase: 06-rest-api
plan: 02
started: 2026-02-22
completed: 2026-02-22
duration: 8min
---

# Plan 06-02 Summary: REST API router, route handlers, OpenAPI spec, and tests

## What was built

Complete REST API router with authentication, rate limiting, CORS, all route handlers, and OpenAPI 3.1 specification:

- **API Router** (`src/api/router.ts`): Main request handler with inline auth/CORS/rate-limit pipeline following the Axon pattern (sequential inline checks, NOT middleware chain). Dispatches to 5 endpoints via regex matching. Ignores non-API paths so WebSocket upgrade etc. pass through.
- **Organization handler** (`src/api/routes/organization.ts`): GET /v1/organization returns org NPI, name, type, Axon registration status, and provider count
- **Relationships handler** (`src/api/routes/relationships.ts`): GET /v1/relationships with pagination (offset/limit), status and provider_npi filters. GET /v1/relationships/:id returns single record. Excludes patient_public_key (internal field) from responses.
- **Status handler** (`src/api/routes/status.ts`): GET /v1/status returns running status, uptime, organization info, Axon status, active sessions, and provider count
- **OpenAPI handler** (`src/api/routes/openapi.ts`): GET /openapi.json serves the spec without requiring authentication
- **OpenAPI specification** (`src/api/openapi-spec.ts`): Hand-written OpenAPI 3.1 spec object with response schemas for all endpoints, security scheme definition, and query parameter documentation
- **Comprehensive tests** (`src/api/api-router.test.ts`): 23 integration tests using real HTTP server on port 0 with in-memory SQLite

## Key decisions

- [06-02]: Router ignores non-API paths (no `/v1/` prefix and not `/openapi.json`) by returning without handling -- prevents conflict with WebSocket upgrade paths
- [06-02]: CORS headers set before any auth/error so preflight OPTIONS always works even without API key
- [06-02]: OpenAPI spec served at `/openapi.json` (no auth required) -- public documentation endpoint
- [06-02]: `ApiRouterDeps` includes `storage: StorageEngine` because RelationshipStore lacks findAll -- relationships handler uses `deps.storage.all()` directly for unfiltered queries
- [06-02]: Fixed organization route to use `status.neuron?.providers?.length` instead of incorrect `status.providers?.length` (getStatus returns `{ neuron, heartbeat }`, not direct fields)
- [06-02]: Rate limiting uses per-key token bucket via `keyRecord.key_id` as the bucket identifier
- [06-02]: All error responses follow Axon pattern: `{ error: "message" }` format
- [06-02]: Non-GET methods on valid paths return 404 (all endpoints are read-only GET per locked decision)

## Test results

23 new tests, all passing. 206 total tests across 14 files.

## Self-Check: PASSED

- [x] GET /v1/organization returns org info for authenticated requests
- [x] GET /v1/relationships returns paginated list with status/provider_npi filters
- [x] GET /v1/relationships/:id returns single relationship (excludes patient_public_key)
- [x] GET /v1/status returns operational status
- [x] GET /openapi.json returns valid OpenAPI 3.1 spec (no auth required)
- [x] Requests without X-API-Key receive 401
- [x] Requests exceeding rate limit receive 429 with Retry-After header
- [x] CORS preflight OPTIONS returns 204 with correct headers for allowed origins
- [x] Requests from disallowed origins get no Access-Control-Allow-Origin header
- [x] Unknown paths return 404 with { error: 'Not found' }
- [x] Non-API paths are ignored (not handled by router)
- [x] All existing tests still passing

## Artifacts

### key-files
created:
  - src/api/router.ts
  - src/api/routes/organization.ts
  - src/api/routes/relationships.ts
  - src/api/routes/status.ts
  - src/api/routes/openapi.ts
  - src/api/openapi-spec.ts
  - src/api/api-router.test.ts
modified:
  - src/api/index.ts
