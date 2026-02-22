# Phase 6: REST API - Research

**Researched:** 2026-02-22
**Domain:** HTTP REST API with authentication, rate limiting, CORS, and OpenAPI 3.1
**Confidence:** HIGH

## Summary

Phase 6 adds a third-party REST API to the existing Neuron HTTP server (created in Phase 4's `NeuronProtocolServer`). The CONTEXT.md locks this to native Node.js `http` module with Axon-consistent patterns (`sendJson`, `readBody`, simple URL regex matching, `{ error: "message" }` format, TypeBox validation, `/v1/` prefix). No Express/Fastify.

The implementation is straightforward because: (1) Axon's mock server at `/Users/medomatic/Documents/Projects/axon/src/mock/server.ts` provides a complete reference implementation of all HTTP patterns, (2) the existing `NeuronProtocolServer` already exposes `.server` getter for HTTP server reuse, and (3) all endpoints are read-only GET with simple data queries against existing stores.

**Primary recommendation:** Follow Axon's `sendJson`/`readBody`/regex-match pattern exactly. API key auth via SHA-256 hashed keys in SQLite. Token bucket rate limiting per key. CORS via manual header injection. OpenAPI 3.1 spec generated from TypeBox schemas at build time, served statically.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- All endpoints are read-only GET (no write operations via REST in v1)
- API key management is CLI-only (`neuron api-key create/revoke/list`), not exposed via REST
- OpenAPI 3.1 per TAPI-06 requirement (served at GET /openapi.json)
- `/v1/` prefix on all routes (Axon uses this pattern)
- Native Node.js `http` module only (no Express/Fastify)
- Error format: `{ error: "message" }` for client errors (matches Axon's `sendJson` pattern)
- `sendJson(res, statusCode, data)` utility function pattern (matches Axon)
- Manual `readBody(req)` Promise-based body reader (matches Axon)
- Simple URL regex matching for parameterized routes (matches Axon -- no centralized router class)
- TypeBox for runtime request/response validation (matches Axon)
- No middleware framework -- inline request handling (matches Axon)
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TAPI-01 | HTTP server on Node.js built-in `http` module with manual route dispatch | Axon mock server pattern provides exact implementation reference; Phase 4 HTTP server already exists via `NeuronProtocolServer.server` getter |
| TAPI-02 | API key authentication for all endpoints (generated/revoked via CLI) | SHA-256 hashing with `nrn_` prefix format; SQLite storage in `api_keys` table; `X-API-Key` header extraction |
| TAPI-03 | Rate limiting per API key with configurable limits and 429 responses | Token bucket algorithm (simple, per-key, in-memory); configurable via `api.rateLimit` config section |
| TAPI-04 | CORS handling with configurable allowed origins | Manual `Access-Control-*` headers on every response; preflight OPTIONS handler; configurable `api.cors.allowedOrigins` |
| TAPI-05 | All routes: organization, relationships (read-only), status | Three route groups querying existing stores (NeuronRegistrationState, RelationshipStore, ProtocolServer) |
| TAPI-06 | OpenAPI 3.1 specification served at `GET /openapi.json` | Hand-written spec object (manageable with ~5 endpoints); TypeBox schema references for consistency |
| TAPI-07 | API key management via CLI (`neuron api-key create/revoke/list`) | Commander subcommands using IPC to running Neuron server or direct SQLite access |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:http | built-in | HTTP server | Project constraint -- matches Axon, no external frameworks |
| node:crypto | built-in | API key generation + hashing | `randomBytes` for key generation, `createHash('sha256')` for storage hashing |
| @sinclair/typebox | ^0.34.48 | Request/response validation | Already in project; matches Axon pattern |
| better-sqlite3 | ^12.6.2 | API key persistence | Already in project; consistent with all other stores |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| commander | ^14.0.3 | CLI subcommands for api-key | Already in project; api-key create/revoke/list commands |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written OpenAPI | typebox-openapi or similar | Extra dependency for ~5 endpoints; hand-written is simpler and version-controlled |
| In-memory rate limiting | Redis/external store | Overkill for single-process Neuron; in-memory token bucket is sufficient |
| Express/Fastify | Node.js http | Locked out by project constraints -- consistency with Axon |

**Installation:**
```bash
# No new dependencies required -- everything needed is already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── api/                     # NEW: REST API module
│   ├── index.ts             # Public exports
│   ├── router.ts            # Route dispatch (request handler attached to HTTP server)
│   ├── middleware.ts         # Auth, CORS, rate limiting inline functions
│   ├── routes/              # Route handlers grouped by resource
│   │   ├── organization.ts  # GET /v1/organization
│   │   ├── relationships.ts # GET /v1/relationships, GET /v1/relationships/:id
│   │   ├── status.ts        # GET /v1/status
│   │   └── openapi.ts       # GET /openapi.json
│   ├── keys.ts              # ApiKeyStore (SQLite CRUD for api_keys table)
│   ├── rate-limiter.ts      # TokenBucketRateLimiter (per-key in-memory)
│   ├── openapi-spec.ts      # OpenAPI 3.1 spec object
│   └── api.test.ts          # Tests
├── cli/
│   └── commands/
│       └── api-key.ts       # NEW: neuron api-key create/revoke/list
```

### Pattern 1: HTTP Request Handler Attachment (Shared Server)
**What:** Attach a `request` event handler to the existing HTTP server from NeuronProtocolServer
**When to use:** Phase 6 REST routes sharing the same port as WebSocket
**Example:**
```typescript
// The HTTP server from NeuronProtocolServer handles 'upgrade' for WebSocket
// and 'request' for regular HTTP. REST routes attach to 'request'.
// Source: Phase 4 NeuronProtocolServer.server getter

const httpServer = protocolServer.server
httpServer.on('request', (req, res) => {
  handleApiRequest(req, res, deps).catch(() => {
    sendJson(res, 500, { error: 'Internal server error' })
  })
})
```

### Pattern 2: Axon-Style Route Dispatch (Regex Matching)
**What:** Sequential regex matching on pathname, exactly like Axon mock server
**When to use:** All REST route dispatch
**Example:**
```typescript
// Source: /Users/medomatic/Documents/Projects/axon/src/mock/server.ts

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// Route matching pattern:
const url = new URL(req.url ?? '', `http://${req.headers.host}`)
const { pathname } = url

if (req.method === 'GET' && pathname === '/v1/organization') {
  // handle organization endpoint
  return
}

const relMatch = pathname.match(/^\/v1\/relationships\/([^/]+)$/)
if (req.method === 'GET' && relMatch) {
  const id = relMatch[1]!
  // handle single relationship lookup
  return
}

// Default: 404
sendJson(res, 404, { error: 'Not found' })
```

### Pattern 3: Inline Auth/CORS/Rate-Limit Pipeline
**What:** Sequential checks at the top of the request handler, not middleware chain
**When to use:** Every API request
**Example:**
```typescript
async function handleApiRequest(req, res, deps) {
  // 1. CORS headers (always set, even on errors)
  setCorsHeaders(res, req, deps.config.api.cors)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // 2. Skip auth for /openapi.json (public)
  if (pathname === '/openapi.json') { /* serve spec */ return }

  // 3. Auth check
  const apiKey = req.headers['x-api-key'] as string | undefined
  if (!apiKey) { sendJson(res, 401, { error: 'Missing API key' }); return }
  const keyRecord = deps.apiKeyStore.verify(apiKey)
  if (!keyRecord) { sendJson(res, 401, { error: 'Invalid API key' }); return }

  // 4. Rate limit check
  if (!deps.rateLimiter.consume(keyRecord.key_id)) {
    res.setHeader('Retry-After', String(deps.rateLimiter.retryAfter(keyRecord.key_id)))
    sendJson(res, 429, { error: 'Rate limit exceeded' })
    return
  }

  // 5. Route dispatch
  // ...
}
```

### Pattern 4: API Key Generation with Prefix
**What:** `nrn_` prefixed API keys for easy identification, SHA-256 hashed for storage
**When to use:** API key creation
**Example:**
```typescript
import { randomBytes, createHash } from 'node:crypto'

function generateApiKey(): { raw: string; hash: string } {
  const bytes = randomBytes(32)
  const raw = `nrn_${bytes.toString('base64url')}`
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

// Store hash only. Verify by hashing presented key and comparing.
function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
```

### Anti-Patterns to Avoid
- **Express/Fastify import:** Locked out -- use native `http` only
- **Centralized router class:** Axon doesn't have one -- keep it simple regex matching
- **Storing raw API keys:** Always hash with SHA-256 before storage
- **Middleware chain pattern:** Use inline sequential checks, not `.use()` chains
- **Async route handlers without catch:** Must wrap in `.catch()` for 500 fallback (Axon pattern)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cryptographic random keys | Custom PRNG | `crypto.randomBytes(32)` | Must be cryptographically secure |
| Key hashing | Custom hash | `crypto.createHash('sha256')` | Standard, constant-time comparison needed |
| Request body reading | Custom stream reader | `readBody(req)` utility (Axon pattern) | Already proven pattern in project |
| JSON response | Custom serialization | `sendJson(res, status, data)` utility (Axon pattern) | Already proven pattern in project |

**Key insight:** Axon's mock server already implements every HTTP pattern needed. Copy the utilities (`sendJson`, `readBody`, URL parsing) rather than inventing new patterns.

## Common Pitfalls

### Pitfall 1: Race Between WebSocket Upgrade and HTTP Request
**What goes wrong:** Both WebSocket `upgrade` and REST `request` fire for the same HTTP server. If not careful, a regular HTTP request to `/ws/handshake` could be handled by both.
**Why it happens:** Node.js `http.Server` emits `request` for all incoming HTTP requests, and `upgrade` only for Upgrade requests. They don't conflict for WebSocket connections (which are `upgrade` only), but a regular GET to `/ws/handshake` would hit the `request` handler.
**How to avoid:** REST handler should ignore/404 paths under `/ws/` prefix. WebSocket paths are the `upgrade` handler's domain.
**Warning signs:** Unexpected 404s or double-handling on WebSocket paths.

### Pitfall 2: Timing-Safe API Key Comparison
**What goes wrong:** Using `===` to compare hashed keys is vulnerable to timing attacks.
**Why it happens:** String comparison short-circuits on first difference, leaking information about the hash.
**How to avoid:** Use `crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))` for hash comparison.
**Warning signs:** Direct `===` on hash strings in auth code.

### Pitfall 3: CORS Preflight Missing on Error Responses
**What goes wrong:** Browser gets CORS error instead of the actual 401/429 error.
**Why it happens:** CORS headers are only set on success paths, not on early-return error paths.
**How to avoid:** Set CORS headers FIRST, before any auth or rate-limit checks. Even error responses must include CORS headers.
**Warning signs:** Browser console shows CORS error but server logs show 401/429.

### Pitfall 4: Rate Limiter Memory Leak
**What goes wrong:** Token buckets accumulate for revoked or inactive API keys.
**Why it happens:** Buckets are created on first request and never cleaned up.
**How to avoid:** Periodic sweep (every 60s) removing buckets not seen in 10 minutes. Or lazy cleanup on next request.
**Warning signs:** Growing memory usage proportional to number of unique API keys ever used.

### Pitfall 5: HTTP Server Request Handler Registration Order
**What goes wrong:** The `request` handler is registered before the server starts listening, or after -- either can cause missed requests.
**Why it happens:** Phase 4's `NeuronProtocolServer.start()` creates and starts the HTTP server. If REST handler is attached before `.start()`, the server reference may be null.
**How to avoid:** Attach REST request handler AFTER `protocolServer.start()` completes, using the `.server` getter.
**Warning signs:** REST endpoints return nothing (no handler attached) or crash (null server).

### Pitfall 6: OpenAPI.json Not Matching Actual API
**What goes wrong:** OpenAPI spec drifts from actual endpoint behavior.
**Why it happens:** Spec is maintained separately from route code.
**How to avoid:** Define TypeBox schemas once, use for both validation and OpenAPI generation. Keep spec and routes in proximity.
**Warning signs:** Consumers get unexpected responses compared to documented spec.

## Code Examples

### sendJson and readBody Utilities (from Axon)
```typescript
// Source: /Users/medomatic/Documents/Projects/axon/src/mock/server.ts lines 79-97

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
```

### Token Bucket Rate Limiter
```typescript
// Simple in-memory token bucket per API key

interface Bucket {
  tokens: number
  lastRefill: number
}

class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>()

  constructor(
    private readonly maxTokens: number = 100,     // requests
    private readonly refillRate: number = 100,     // tokens per window
    private readonly windowMs: number = 60_000,    // 1 minute
  ) {}

  consume(keyId: string): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(keyId)
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now }
      this.buckets.set(keyId, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    const refill = Math.floor((elapsed / this.windowMs) * this.refillRate)
    if (refill > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill)
      bucket.lastRefill = now
    }

    if (bucket.tokens > 0) {
      bucket.tokens--
      return true
    }
    return false
  }

  retryAfter(keyId: string): number {
    const bucket = this.buckets.get(keyId)
    if (!bucket) return 0
    const msUntilToken = this.windowMs / this.refillRate
    return Math.ceil(msUntilToken / 1000)
  }
}
```

### CORS Header Injection
```typescript
interface CorsConfig {
  allowedOrigins: string[]
}

function setCorsHeaders(
  res: http.ServerResponse,
  req: http.IncomingMessage,
  cors: CorsConfig,
): void {
  const origin = req.headers.origin
  if (origin && cors.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
}
```

### SQLite Migration for API Keys Table
```sql
-- Migration v4: API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| API key in query string | API key in header (X-API-Key or Authorization) | Long-standing best practice | Prevents key leakage in logs and browser history |
| Global rate limiting | Per-key rate limiting | Standard practice | Fair usage, prevents one consumer from blocking others |
| OpenAPI 2.0 (Swagger) | OpenAPI 3.1 | 2021 | JSON Schema alignment, webhooks support |
| Storing raw API keys | Hash-only storage (SHA-256) | Security best practice | Prevents key exposure from database breach |

**Deprecated/outdated:**
- OpenAPI 2.0: Superseded by 3.0/3.1, use 3.1 per TAPI-06 requirement
- `X-Forwarded-For` for rate limiting: Not relevant for Neuron (single-process, direct connections)

## Open Questions

1. **Should `/openapi.json` require authentication?**
   - What we know: Common practice is to serve OpenAPI specs publicly for developer discovery
   - What's unclear: Whether Neuron operators want to restrict spec access
   - Recommendation: Serve publicly (no auth). This aligns with standard practice and TAPI-06 wording.

2. **Should `/v1/status` require authentication?**
   - What we know: Health check endpoints are often public for monitoring tools
   - What's unclear: Whether status reveals sensitive operational data
   - Recommendation: Require auth. Status may include session counts and provider info. Health probes can use a dedicated key.

## Sources

### Primary (HIGH confidence)
- Axon mock server (`/Users/medomatic/Documents/Projects/axon/src/mock/server.ts`) -- complete HTTP pattern reference
- Phase 4 NeuronProtocolServer (`src/routing/server.ts`) -- HTTP server reuse via `.server` getter
- Phase 4 CONTEXT.md decisions -- locked patterns and constraints
- Node.js `node:crypto` built-in -- `randomBytes`, `createHash`, `timingSafeEqual`
- OpenAPI 3.1 specification (https://spec.openapis.org/oas/v3.1.0)

### Secondary (MEDIUM confidence)
- Token bucket algorithm -- well-established rate limiting pattern, widely documented
- `nrn_` prefix convention -- modeled after Stripe's `sk_`/`pk_` prefix pattern

### Tertiary (LOW confidence)
- None -- all findings verified against project source code and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, patterns already proven in Axon
- Architecture: HIGH -- direct extension of Phase 4's HTTP server with Axon-proven patterns
- Pitfalls: HIGH -- based on concrete code analysis of existing server.ts and Axon mock

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable -- all dependencies are locked, patterns are project-internal)
