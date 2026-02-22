# Phase 7: Integration and Documentation - Research

**Researched:** 2026-02-22
**Domain:** End-to-end integration testing and technical documentation
**Confidence:** HIGH

## Summary

Phase 7 has two distinct workstreams: (1) three E2E test suites validating the full Neuron lifecycle, local mDNS discovery, and REST API with rate limiting; and (2) three documentation artifacts (API reference, architecture guide, configuration reference) written for AI-agent consumption.

The codebase is mature -- Phases 1-6 are complete with all subsystems built, tested individually, and wired into the `neuron start` lifecycle. The E2E tests need to compose these subsystems into realistic flows: starting a mock Axon server, initializing storage, starting the Neuron protocol server with REST API and discovery, connecting via WebSocket to complete consent handshakes, and verifying state via the REST API. The existing `routing.test.ts` already demonstrates the core integration pattern (real SQLite, real WebSocket, ephemeral ports) that the E2E tests should extend.

Documentation must be AI-agent optimized with structured, predictable formatting. The OpenAPI 3.1 spec already exists in `src/api/openapi-spec.ts` and should serve as the source of truth for API documentation. The TypeBox config schema in `src/types/config.ts` is the definitive reference for configuration documentation. Architecture documentation requires Mermaid diagrams showing data flow across subsystems.

**Primary recommendation:** Build E2E tests as composable helper functions (setup/teardown) in `tests/` directory, using the same real-component approach as `routing.test.ts`. Write documentation by extracting from the actual code (OpenAPI spec, TypeBox schema, start command lifecycle) rather than hand-writing from memory.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Three distinct E2E test suites required: full lifecycle, mDNS discovery flow, REST API with rate limiting
- Tests must validate the success criteria from ROADMAP.md exactly
- API documentation must be AI-agent optimized -- structured, predictable formatting that AI agents can easily parse and navigate
- Audience: both external integrators and internal operators (self-contained, assume no prior context)
- Must cover all REST endpoints with request/response examples
- Architecture guide uses Mermaid diagrams for data flow visualizations
- Architecture guide uses layered structure -- high-level overview first, then drill into each subsystem
- Architecture guide has dedicated security section covering trust model, consent verification, API key auth, and audit chain integrity
- Architecture guide is AI-agent optimized
- Configuration reference is AI-agent optimized -- consistent with API and architecture docs
- Must document all config options and environment variables
- Check Axon's test patterns at `/Users/medomatic/Documents/Projects/axon` for consistency

### Claude's Discretion
- E2E test storage (real SQLite vs in-memory) -- informed by Axon patterns
- E2E test shape (orchestrated vs composable steps)
- Network layer approach (real vs mock) for WebSocket/mDNS tests
- Rate limit testing strategy (real timing vs accelerated clock)
- API docs format (OpenAPI + Markdown vs hand-written Markdown)
- Request/response example depth (curl examples vs JSON-only)
- Error documentation structure (per-endpoint vs centralized)
- Configuration format (tables per category vs flat list)
- Whether to include example config files
- Config validation rule documentation depth

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTG-01 | E2E test: full lifecycle (init -> register -> add provider -> patient connects -> consent -> session -> terminate) | Full lifecycle test uses mock Axon server + real SQLite + real WebSocket. Compose from existing patterns in `routing.test.ts` and `test/mock-axon/server.ts`. The `start.ts` command shows the exact initialization order to replicate. |
| INTG-02 | E2E test: local discovery flow (mDNS advertise -> discover -> connect -> consent) | Discovery test must use `bonjour-service` browser to find the advertised service, extract TXT records, then connect via the discovered endpoint. Same consent handshake flow as INTG-01 but entry via mDNS. Note: mDNS tests are inherently slower and may be flaky in CI -- consider marking as integration-only. |
| INTG-03 | E2E test: REST API key creation, organization/relationship endpoints, rate limiting | REST API test creates API key via `ApiKeyStore.create()`, makes authenticated HTTP requests, and exhausts the token bucket to verify 429 responses. Uses low `maxRequests` (e.g., 3) and short `windowMs` for fast rate limit testing. |
| INTG-04 | REST API documentation (`docs/api.md`) with endpoint reference and request/response examples | Source of truth: `src/api/openapi-spec.ts` (OpenAPI 3.1). Document each endpoint with curl examples, request/response JSON, error codes, and authentication requirements. AI-agent optimized formatting. |
| INTG-05 | Architecture guide (`docs/architecture.md`) with data flow diagrams | Layered approach: system overview Mermaid diagram, then per-subsystem deep-dives (registration, consent, routing, discovery, REST API). Dedicated security section. Source: `start.ts` lifecycle orchestration and inter-module dependency graph. |
| INTG-06 | Configuration reference (`docs/configuration.md`) with all options and environment variables | Source of truth: `NeuronConfigSchema` in `src/types/config.ts` and `DEFAULT_CONFIG` in `src/config/defaults.ts`. Document NEURON_ env var override pattern from `src/config/loader.ts`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ~4.0.18 | Test runner for E2E tests | Already the project test runner; E2E tests go in `tests/` (already in vitest include config) |
| ws | ^8.19.0 | WebSocket client for E2E connection tests | Already a project dependency; used in `routing.test.ts` integration tests |
| better-sqlite3 | ^12.6.2 | Real SQLite storage for E2E tests | Already a project dependency; E2E tests use real storage to test full data lifecycle |
| bonjour-service | ^1.3.0 | mDNS browser for discovery E2E tests | Already a project dependency; needed to verify mDNS advertisement |
| node:crypto | built-in | Ed25519 key generation and consent token signing in tests | Already used in `routing.test.ts` for test key pair generation |
| node:http | built-in | HTTP client for REST API E2E tests | Native fetch() for API requests; node:http for mock Axon server |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| msw | ^2.12.10 | Mock Service Worker for HTTP mocking | Already in devDependencies; used by registration tests for Axon mocking |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real mock Axon HTTP server (`test/mock-axon/server.ts`) | MSW (already in devDeps) | Mock Axon server gives more realistic test -- real HTTP, real port, real `fetch()`. MSW intercepts at fetch level. E2E should use real mock server for maximum fidelity. |
| In-memory SQLite (`:memory:`) | File-based SQLite in tmpdir | In-memory is faster and sufficient for E2E tests since we verify state through API/store queries, not by reading db files. Consistent with routing.test.ts pattern. |
| Real mDNS (bonjour-service browser) | Mock mDNS | Real mDNS needed for genuine E2E validation; test must actually discover the service on loopback. |

**Installation:**
No new packages needed. All dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── e2e-lifecycle.test.ts      # INTG-01: Full lifecycle E2E
├── e2e-discovery.test.ts      # INTG-02: mDNS discovery E2E
├── e2e-rest-api.test.ts       # INTG-03: REST API E2E
└── helpers/
    └── neuron-harness.ts      # Shared setup/teardown for E2E tests
docs/
├── api.md                     # INTG-04: REST API reference
├── architecture.md            # INTG-05: Architecture guide
└── configuration.md           # INTG-06: Configuration reference
```

### Pattern 1: Composable Test Harness
**What:** A shared `NeuronTestHarness` class that encapsulates the full Neuron startup/teardown lifecycle for E2E tests, mirroring the `start.ts` command's initialization order.
**When to use:** All three E2E test suites need the same core setup: mock Axon, storage, audit, registration service, relationship store, protocol server, REST API router, and optionally discovery.
**Why:** Eliminates duplication across three test files. Each test suite can opt into features it needs (e.g., discovery suite enables mDNS, REST suite needs API key store).

**Evidence:** The routing test (`routing.test.ts`) already manually sets up 6+ components in its `beforeEach`. The `start.ts` command orchestrates 10+ components. A harness extracts this into a reusable pattern.

**Example shape:**
```typescript
interface HarnessOptions {
  enableDiscovery?: boolean
  enableAxonMock?: boolean
  config?: Partial<NeuronConfig>
}

class NeuronTestHarness {
  storage: SqliteStorage
  auditLogger: AuditLogger
  registrationService: AxonRegistrationService
  relationshipStore: RelationshipStore
  handshakeHandler: ConsentHandshakeHandler
  protocolServer: NeuronProtocolServer
  apiKeyStore: ApiKeyStore
  rateLimiter: TokenBucketRateLimiter
  discoveryService?: DiscoveryService
  mockAxonServer?: http.Server
  port: number  // ephemeral port after start

  async start(options?: HarnessOptions): Promise<void>
  async stop(): Promise<void>
}
```

### Pattern 2: Real WebSocket Client Helpers (from routing.test.ts)
**What:** Helper functions for WebSocket connection, message sending/receiving, and close detection.
**When to use:** Both lifecycle and discovery E2E tests need to perform WebSocket handshakes.
**Evidence:** `routing.test.ts` already defines: `connectAndWaitOpen()`, `receiveMessage()`, `waitForClose()`, `sendAuthMessage()`, `makeTestKeyPair()`, `signConsentToken()`, `validClaims()`. These should be extracted to `tests/helpers/` for reuse.

### Pattern 3: Axon Test Patterns (from Axon project)
**What:** Axon uses test files in `test/` directory with describe blocks organized by integration scenario, real crypto operations, and mock servers with ephemeral ports.
**When to use:** As a consistency reference for Neuron's E2E tests.
**Evidence from Axon `test/integration/entry-points.test.ts`:**
- Uses `createMockAxonServer()` with `server.start()` / `server.stop()` lifecycle
- Real Ed25519 key pair generation (`generateKeyPair()`)
- Real HTTP requests via `fetch()`
- Describe blocks named by consumer perspective ("Provider-core: taxonomy consumption")
- `beforeAll` / `afterAll` for server lifecycle (not per-test)

**Recommendation for Neuron:** Use `beforeAll`/`afterAll` for the harness lifecycle (not `beforeEach`) since E2E tests are slow and the harness is expensive to create. Reset state between tests where needed (e.g., clear relationships).

### Pattern 4: AI-Agent Optimized Documentation
**What:** Structured documentation with consistent headers, tables, code blocks, and predictable section patterns that AI agents can reliably parse and navigate.
**When to use:** All three documentation files.
**Key principles:**
- Every section has a predictable format (no prose-only sections)
- Code examples are complete (copy-pasteable curl commands)
- Tables for structured data (config options, error codes, endpoints)
- Consistent heading hierarchy (H2 for sections, H3 for subsections)
- No ambiguity -- explicit types, defaults, and valid values for every option
- Cross-references between docs use explicit relative links

### Anti-Patterns to Avoid
- **Starting the full `neuron start` CLI command in E2E tests:** The CLI command calls `process.exit()` on errors, uses `process.on('SIGINT')`, and writes to stdout. E2E tests should compose subsystems directly (like `routing.test.ts` does), not spawn a child process.
- **Using `setTimeout` for rate limit assertions:** Flaky due to timing. Instead use a very low `maxRequests` (e.g., 3) and exhaust synchronously, then verify the next request returns 429.
- **Mocking mDNS in the discovery E2E test:** The whole point of INTG-02 is verifying real mDNS advertisement. Use real bonjour-service browser on loopback. Accept that this test is slower.
- **Hand-writing documentation from memory:** Extract from actual code (OpenAPI spec object, TypeBox schema, start.ts lifecycle). Code is the source of truth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket test helpers | Custom WS utilities | Extract from `routing.test.ts` existing helpers | Already tested and proven; `connectAndWaitOpen`, `receiveMessage`, `waitForClose` |
| Mock Axon server | New mock server | Use existing `test/mock-axon/server.ts` | Already implements all Axon API routes needed for registration lifecycle |
| Consent token generation for tests | Custom token builder | Extract pattern from `routing.test.ts` `signConsentToken()` | Correct Ed25519 signing with proper JWK format |
| API documentation structure | Custom format | OpenAPI-derived Markdown with curl examples | OpenAPI spec in `src/api/openapi-spec.ts` is the authoritative source |
| Config documentation values | Manual documentation | Extract from `NeuronConfigSchema` + `DEFAULT_CONFIG` | TypeBox schema and defaults.ts are the authoritative sources |

**Key insight:** Phase 7 is about composing and documenting what already exists. Almost every test utility and documentation source already lives in the codebase. The work is extraction, composition, and formatting -- not creation.

## Common Pitfalls

### Pitfall 1: Port Conflicts in Parallel Test Execution
**What goes wrong:** Multiple E2E test files run in parallel (vitest default), each trying to start HTTP servers. Ephemeral port 0 prevents conflicts, but mock Axon servers on fixed ports would collide.
**Why it happens:** `test/mock-axon/server.ts` takes a fixed port parameter.
**How to avoid:** All servers in E2E tests MUST use port 0 (OS-assigned ephemeral port). The mock Axon server function `createMockAxonServer(port)` accepts a port parameter -- pass 0 and extract the assigned port from the `server.address()` after listen.
**Warning signs:** "EADDRINUSE" errors, flaky test failures that succeed in isolation.

### Pitfall 2: mDNS Test Reliability
**What goes wrong:** mDNS discovery tests are timing-sensitive. The browser may not find the service immediately after advertisement starts.
**Why it happens:** mDNS uses multicast networking with inherent latency. On macOS, Bonjour has a ~1-2 second warm-up.
**How to avoid:** Use a longer timeout (5-10 seconds) for the mDNS browser search. Wrap in a retry/poll loop rather than a single shot. Consider `{ timeout: 10000 }` on the vitest test.
**Warning signs:** Discovery tests pass locally but fail in CI; intermittent timeouts.

### Pitfall 3: Frozen Config Object in Tests
**What goes wrong:** `loadConfig()` returns a deeply frozen object. Tests that try to modify config fields get silent failures or TypeErrors.
**Why it happens:** `deepFreeze()` is called on the validated config.
**How to avoid:** E2E tests should construct their own unfrozen config objects (like `routing.test.ts` does with `testConfig`) rather than using `loadConfig()`. Spread operator creates shallow copies of frozen objects, but nested objects remain frozen.
**Warning signs:** Config values don't change when you think you're overriding them.

### Pitfall 4: Heartbeat Timer Interference in Tests
**What goes wrong:** `AxonRegistrationService.start()` starts a heartbeat timer that fires every 60 seconds. In E2E tests this timer can outlive the test and cause "cannot read properties of destroyed object" errors.
**Why it happens:** `HeartbeatManager.start()` creates a `setInterval` that fires indefinitely.
**How to avoid:** Always call `registrationService.stop()` in `afterAll`/`afterEach` to clear the heartbeat interval. Or use a very long `heartbeatIntervalMs` (e.g., 999999) in test config so it never fires.
**Warning signs:** "Vitest exit with active timer" warnings, SQLITE_MISUSE errors after test completion.

### Pitfall 5: Mock Axon Server Port vs Config.axon.registryUrl
**What goes wrong:** The mock Axon server starts on an ephemeral port, but `config.axon.registryUrl` must match for `AxonRegistrationService` to reach it.
**Why it happens:** Config is constructed before the mock server is started, but you need the mock server's port for the config.
**How to avoid:** Start mock Axon server first, get its port, then construct the config with `registryUrl: \`http://127.0.0.1:\${mockAxonPort}\``.
**Warning signs:** Registration fails with "ECONNREFUSED" despite mock server running.

### Pitfall 6: Rate Limit Test Timing
**What goes wrong:** Token bucket rate limiter refills based on elapsed wall-clock time. Tests that depend on "bucket is empty" may become flaky if the test takes longer than expected, allowing partial refills.
**Why it happens:** `TokenBucketRateLimiter.consume()` calls `Date.now()` for proportional refill.
**How to avoid:** Use `maxRequests: 2` or `3` with `windowMs: 60000` (long window). Exhaust all tokens in a tight synchronous loop, then immediately check for 429. The long window ensures no refills happen during the test.
**Warning signs:** Rate limit test passes alone but fails when system is under load.

### Pitfall 7: Documentation Getting Stale
**What goes wrong:** Documentation is written once but the code continues to evolve. Endpoint paths, config keys, or error codes change without updating docs.
**Why it happens:** Documentation lives in a separate file from the code it describes.
**How to avoid:** For this phase, extract documentation directly from code artifacts (`openapiSpec` object, `NeuronConfigSchema`, `DEFAULT_CONFIG`). Future phases should consider generating docs programmatically. Add a note in each doc file referencing the source of truth.
**Warning signs:** Curl examples in docs return unexpected responses.

## Code Examples

Verified patterns from the actual codebase:

### E2E Test Harness Setup (derived from start.ts and routing.test.ts)
```typescript
// Source: src/cli/commands/start.ts initialization order + src/routing/routing.test.ts setup
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteStorage } from '../src/storage/sqlite.js'
import { AuditLogger } from '../src/audit/logger.js'
import { AxonRegistrationService } from '../src/registration/service.js'
import { RelationshipStore, ConsentHandshakeHandler } from '../src/relationships/index.js'
import { NeuronProtocolServer, createConnectionHandler } from '../src/routing/index.js'
import { ApiKeyStore, TokenBucketRateLimiter, createApiRouter } from '../src/api/index.js'
import { createMockAxonServer } from '../test/mock-axon/server.js'
import type { NeuronConfig } from '../src/types/config.js'

// 1. Start mock Axon to get its port
const mockAxon = createMockAxonServer(0)
const mockAxonPort = (mockAxon.address() as { port: number }).port

// 2. Build config with real ports
const config: NeuronConfig = {
  organization: { npi: '9999999999', name: 'Test Org', type: 'practice' },
  server: { port: 0, host: '127.0.0.1' },
  websocket: { path: '/ws/handshake', maxConcurrentHandshakes: 10, authTimeoutMs: 5000, queueTimeoutMs: 10000, maxPayloadBytes: 65536 },
  storage: { path: ':memory:' },
  audit: { path: join(tmpDir, 'audit.jsonl'), enabled: true },
  localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
  heartbeat: { intervalMs: 999999 }, // Never fire in tests
  axon: { registryUrl: `http://127.0.0.1:${mockAxonPort}`, endpointUrl: 'http://127.0.0.1:3000', backoffCeilingMs: 300000 },
  api: { rateLimit: { maxRequests: 100, windowMs: 60000 }, cors: { allowedOrigins: ['*'] } },
}

// 3. Initialize subsystems in start.ts order
const storage = new SqliteStorage(':memory:')
storage.initialize()
const auditLogger = new AuditLogger(config.audit.path)
const registrationService = new AxonRegistrationService(config, storage, auditLogger)
const relationshipStore = new RelationshipStore(storage)
const handshakeHandler = new ConsentHandshakeHandler(relationshipStore, config.organization.npi, auditLogger)
const protocolServer = new NeuronProtocolServer(config, handshakeHandler, relationshipStore, auditLogger)

// 4. Wire connection handler (from start.ts pattern)
const connectionHandler = createConnectionHandler({
  config, handshakeHandler, relationshipStore,
  sessionManager: protocolServer.getSessionManager(),
  organizationNpi: config.organization.npi,
  neuronEndpointUrl: config.axon.endpointUrl,
  auditLogger,
  onSessionEnd: () => protocolServer.notifySessionEnd(),
})
protocolServer.setConnectionHandler(connectionHandler)
await protocolServer.start(0)

// 5. Wire REST API (from start.ts pattern)
const apiKeyStore = new ApiKeyStore(storage)
const rateLimiter = new TokenBucketRateLimiter(config.api.rateLimit.maxRequests, config.api.rateLimit.maxRequests, config.api.rateLimit.windowMs)
const apiRouter = createApiRouter({ config, storage, apiKeyStore, rateLimiter, relationshipStore, registrationService, protocolServer })
protocolServer.server!.on('request', apiRouter)

// 6. Start registration
await registrationService.start()
```

### WebSocket Handshake Helpers (from routing.test.ts)
```typescript
// Source: src/routing/routing.test.ts verified helpers
import { generateKeyPairSync, sign } from 'node:crypto'
import WebSocket from 'ws'

function makeTestKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  return { publicKey, privateKey, publicKeyBase64url: jwk.x! }
}

function signConsentToken(claims: Record<string, unknown>, privateKey: any) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
  const signature = sign(null, payload, privateKey)
  return {
    payload: payload.toString('base64url'),
    signature: signature.toString('base64url'),
  }
}

function validClaims(patientAgentId: string, providerNpi: string) {
  return {
    patient_agent_id: patientAgentId,
    provider_npi: providerNpi,
    consented_actions: ['office_visit', 'lab_results'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
}

function connectAndWaitOpen(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/handshake`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function receiveMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 5000)
    ws.once('message', (data: Buffer) => {
      clearTimeout(timeout)
      resolve(JSON.parse(data.toString()))
    })
  })
}
```

### Mock Axon Server with Ephemeral Port
```typescript
// Source: test/mock-axon/server.ts (adapted for ephemeral port)
import { createMockAxonServer } from '../test/mock-axon/server.ts'
import http from 'node:http'

// Start mock Axon on ephemeral port
const mockServer = createMockAxonServer(0)
// IMPORTANT: createMockAxonServer calls server.listen(port) internally,
// but currently uses the port synchronously. May need to await 'listening' event.
await new Promise<void>(resolve => {
  if (mockServer.listening) { resolve(); return }
  mockServer.on('listening', resolve)
})
const addr = mockServer.address() as { port: number }
const mockAxonUrl = `http://127.0.0.1:${addr.port}`
```

### REST API Test Pattern
```typescript
// Source: derived from src/api/api-router.test.ts and openapi-spec.ts
const apiKey = apiKeyStore.create('test-key')

// Authenticated request
const res = await fetch(`http://127.0.0.1:${neuronPort}/v1/organization`, {
  headers: { 'X-API-Key': apiKey.raw },
})
expect(res.status).toBe(200)

// Rate limit exhaustion (low maxRequests for test)
for (let i = 0; i < maxRequests; i++) {
  await fetch(`http://127.0.0.1:${neuronPort}/v1/status`, {
    headers: { 'X-API-Key': apiKey.raw },
  })
}
const rateLimited = await fetch(`http://127.0.0.1:${neuronPort}/v1/status`, {
  headers: { 'X-API-Key': apiKey.raw },
})
expect(rateLimited.status).toBe(429)
```

### mDNS Discovery Test Pattern
```typescript
// Source: bonjour-service API + src/discovery/service.ts
import Bonjour from 'bonjour-service'

const browser = new Bonjour()
const found = await new Promise<{ npi: string; ep: string }>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('mDNS timeout')), 10000)
  const b = browser.find({ type: 'careagent-neuron' }, (service) => {
    clearTimeout(timeout)
    b.stop()
    resolve({
      npi: service.txt?.npi,
      ep: service.txt?.ep,
    })
  })
})
browser.destroy()
// Now connect via the discovered endpoint
const ws = new WebSocket(found.ep)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Process-spawned E2E tests | In-process composition of subsystems | Current best practice | Faster, more reliable, better debugging -- no child process management |
| Markdown-only API docs | OpenAPI 3.1 spec + derived Markdown | Ongoing | Machine-parseable spec at `/openapi.json` + human-readable reference |
| Manual config documentation | Schema-derived documentation | Current best practice | TypeBox schema is the single source of truth for config options |

## Discretion Recommendations

Based on research of the codebase and Axon patterns, here are recommendations for areas left to Claude's discretion:

### E2E Test Storage: In-memory SQLite (`:memory:`)
**Recommendation:** Use `:memory:` for all E2E tests.
**Rationale:** `routing.test.ts` uses `:memory:` successfully. Axon uses in-memory maps for its mock server. File-based SQLite adds cleanup overhead and temp directory management with no additional coverage value since state is verified through API queries, not db file inspection.

### E2E Test Shape: Composable Harness with Per-Suite Lifecycle
**Recommendation:** Composable test harness (`NeuronTestHarness` class in `tests/helpers/`) with `beforeAll`/`afterAll` per test suite. Individual tests within a suite can share the harness but reset specific state as needed.
**Rationale:** Axon's integration test uses `beforeAll`/`afterAll` for server lifecycle. E2E harness creation is expensive (mock Axon + SQLite + protocol server + REST router). Per-test setup would be 300-500ms overhead per test.

### Network Layer: Real Components
**Recommendation:** Real WebSocket connections, real HTTP requests, real mock Axon server (from `test/mock-axon/server.ts`). Real mDNS for discovery test.
**Rationale:** The explicit goal of E2E tests is "all functionalities work together." Mocking at the network layer defeats the purpose. The existing `routing.test.ts` already validates this approach with real WebSocket connections.

### Rate Limit Testing: Low Token Count with Long Window
**Recommendation:** Use `maxRequests: 3, windowMs: 60000` for rate limit E2E tests. Exhaust 3 tokens synchronously, verify 4th request returns 429.
**Rationale:** Avoids any timing dependency. The long window (60 seconds) ensures zero refills during the test. The `TokenBucketRateLimiter` refills proportionally based on elapsed time, so a short window risks partial refills.

### API Docs Format: Hand-Written Markdown with Embedded OpenAPI References
**Recommendation:** Hand-written Markdown for `docs/api.md` with curl examples and JSON request/response blocks. Reference the programmatic OpenAPI spec at `GET /openapi.json` for machine consumers.
**Rationale:** AI agents parse Markdown well. Curl examples provide copy-pasteable verification. The OpenAPI spec already exists for programmatic access.

### Request/Response Example Depth: Curl + JSON
**Recommendation:** Include curl examples for every endpoint (with `-H 'X-API-Key: nrn_...'` header) plus full JSON response bodies. Show error responses (401, 404, 429) alongside success responses.
**Rationale:** Curl examples are universally understood, copy-pasteable, and unambiguous. AI agents can extract the pattern from a curl command more reliably than from prose descriptions.

### Error Documentation: Per-Endpoint with Centralized Error Format Section
**Recommendation:** Document errors per-endpoint (what status codes each endpoint returns) with a centralized "Error Format" section showing the standard `{ "error": "message" }` shape.
**Rationale:** Per-endpoint is more actionable (you know what to handle). The centralized section avoids repeating the JSON error shape for every endpoint.

### Configuration Format: Tables Per Category
**Recommendation:** Group config options by category (organization, server, websocket, storage, audit, localNetwork, heartbeat, axon, api) with a table per category showing key, type, default, description, and env var override name.
**Rationale:** Matches the `NeuronConfigSchema` structure exactly. Tables are AI-agent friendly. Category grouping makes large config references navigable.

### Example Config Files: Yes
**Recommendation:** Include a minimal example config and a full example config in the configuration reference.
**Rationale:** Copy-pasteable starter configs save time. The minimal config shows required fields; the full config shows all options with defaults.

### Config Validation Rule Documentation: Medium Depth
**Recommendation:** Document validation rules (min/max values, format requirements) in the per-field table. Don't document TypeBox internals -- just the user-facing constraints.
**Rationale:** Operators need to know "port must be 1-65535" not "TypeBox Number with minimum/maximum constraint."

## Open Questions

1. **Mock Axon Server Ephemeral Port Lifecycle**
   - What we know: `createMockAxonServer(port)` calls `server.listen(port)` synchronously and returns the server immediately. When port is 0, the assigned port is available via `server.address()` only after the `listening` event.
   - What's unclear: Whether `server.listen(0)` completes synchronously in the current implementation (it calls `server.listen(port)` at the end of `createMockAxonServer`). The `listening` event may fire before the function returns or may require an event loop tick.
   - Recommendation: Wrap in `await new Promise(resolve => { server.on('listening', resolve); if (server.listening) resolve(); })` to be safe. Test during implementation.

2. **mDNS Loopback Behavior**
   - What we know: `bonjour-service` uses multicast DNS which works on the local network interface. In test environments, services may need to advertise on loopback.
   - What's unclear: Whether `bonjour-service` browser can discover services published by the same process on macOS loopback.
   - Recommendation: Test this empirically during implementation. If loopback doesn't work, the discovery E2E test may need to use a real network interface, which could make it unsuitable for some CI environments. Consider marking with `{ timeout: 15000 }` and potentially `.skip` in CI.

## Sources

### Primary (HIGH confidence)
- **Neuron codebase** -- All source files read directly from `/Users/medomatic/Documents/Projects/neuron/src/`
- **Existing test patterns** -- `src/routing/routing.test.ts` (WebSocket integration), `src/registration/registration.test.ts` (MSW mock patterns), `src/api/api-router.test.ts` (REST API testing)
- **Mock Axon server** -- `test/mock-axon/server.ts` (real HTTP mock server)
- **Axon test patterns** -- `test/integration/entry-points.test.ts` at `/Users/medomatic/Documents/Projects/axon/`
- **vitest config** -- `vitest.config.ts` confirms `tests/**/*.test.ts` is included in test paths

### Secondary (MEDIUM confidence)
- **OpenAPI 3.1 spec** -- `src/api/openapi-spec.ts` is the authoritative source for API documentation
- **TypeBox config schema** -- `src/types/config.ts` + `src/config/defaults.ts` are the authoritative sources for configuration documentation

### Tertiary (LOW confidence)
- **mDNS loopback behavior** -- Based on general knowledge of bonjour-service and macOS multicast DNS. Needs empirical validation during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies; all tools already in the project
- Architecture: HIGH -- Test patterns directly derived from existing codebase (`routing.test.ts`, `start.ts`)
- E2E test design: HIGH -- Composable harness pattern is a natural extraction of existing test setup code
- Documentation sources: HIGH -- OpenAPI spec and TypeBox schema are the definitive code-level sources
- mDNS testing: MEDIUM -- Loopback discovery behavior needs empirical validation
- Pitfalls: HIGH -- Derived from actual codebase analysis (frozen configs, timer leaks, port conflicts all observable in source)

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable domain -- test patterns and documentation practices don't change rapidly)
