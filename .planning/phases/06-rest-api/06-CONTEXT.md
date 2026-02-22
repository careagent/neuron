# Phase 6: REST API - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Third-party applications can access Neuron operational data through an authenticated, rate-limited HTTP API with OpenAPI documentation. Endpoints expose organization info, relationships (read-only), and status. Built on the existing Node.js `http` server from Phase 4 (noServer mode), consistent with Axon's HTTP patterns.

</domain>

<decisions>
## Implementation Decisions

### Route design
- All endpoints are read-only GET (no write operations via REST in v1)
- API key management is CLI-only (`neuron api-key create/revoke/list`), not exposed via REST
- URL versioning, response format, pagination, status endpoint detail level, relationship data depth, and content type handling are all Claude's discretion

### Auth & rate limiting
- API key format, storage approach, rate limiting strategy (per-key vs global), status endpoint auth requirement, and header format are all Claude's discretion

### OpenAPI spec
- OpenAPI 3.1 per TAPI-06 requirement (served at GET /openapi.json)
- Generation approach (hand-written vs TypeBox-generated), Swagger UI inclusion are Claude's discretion
- Note: Axon has no OpenAPI spec (types are source of truth), but Neuron's is third-party-facing so spec is warranted

### HTTP server sharing
- Route dispatch pattern, middleware composition pattern are Claude's discretion

### Axon consistency constraints (MUST follow)
- `/v1/` prefix on all routes (Axon uses this pattern)
- Native Node.js `http` module only (no Express/Fastify — matches Axon and project constraints)
- Error format: `{ error: "message" }` for client errors (matches Axon's `sendJson` pattern)
- `sendJson(res, statusCode, data)` utility function pattern (matches Axon)
- Manual `readBody(req)` Promise-based body reader (matches Axon)
- Simple URL regex matching for parameterized routes (matches Axon — no centralized router class)
- TypeBox for runtime request/response validation (matches Axon)
- No middleware framework — inline request handling (matches Axon)
- Status codes: 200 (success), 400 (bad request), 401 (missing/invalid key), 404 (not found), 429 (rate limited), 500 (internal error)
- Reuse existing HTTP server from Phase 4 NeuronProtocolServer (one port for WS + REST, per original noServer mode design intent)

### Claude's Discretion
- URL structure beyond /v1/ prefix (resource naming, nesting)
- Response envelope design for success responses
- Error detail level (simple message vs categorical codes)
- Pagination strategy (offset/limit vs cursor vs none)
- Status endpoint scope (health-only vs basic stats)
- Relationship response fields (IDs only vs including consent scope)
- API key format (prefixed like nrn_xxx vs plain random)
- API key storage (hashed in SQLite)
- Rate limit numbers and bucket strategy
- Auth header choice (Bearer vs X-API-Key)
- OpenAPI generation approach
- Whether to include Swagger UI
- Route dispatch implementation detail
- Middleware composition approach

</decisions>

<specifics>
## Specific Ideas

- Axon mock server at `/Users/medomatic/Documents/Projects/axon/src/mock/server.ts` is the reference implementation for HTTP patterns
- Axon uses offset/limit pagination for registry search — follow same convention if paginating
- Axon's `sendJson` and `readBody` utilities should be replicated in Neuron for consistency
- Phase 4's NeuronProtocolServer already exposes the HTTP server via getter — REST routes attach there

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-rest-api*
*Context gathered: 2026-02-22*
