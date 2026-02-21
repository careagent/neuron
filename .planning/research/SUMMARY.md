# Project Research Summary

**Project:** CareAgent Neuron
**Domain:** Healthcare organizational endpoint/routing server (Node.js standalone infrastructure)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Executive Summary

CareAgent Neuron is a healthcare organizational endpoint server -- a category that does not currently exist in open-source healthcare. It is not an EMR, not a FHIR server, and not a traditional integration engine. It is the organizational membrane for an agent-based care network: it routes live WebSocket sessions between patient and provider CareAgents, enforces cryptographic consent on every connection, stores zero patient identity, and exposes operational data (scheduling, billing) through a REST API. Experts build this type of system as a four-layer single-process Node.js server using raw `node:http` for HTTP, the `ws` library for WebSocket, SQLite via `better-sqlite3` for structured storage, and Ed25519 via built-in `node:crypto` for consent verification. The stack is constrained by the PRD (no Express, no Fastify, TypeBox for schemas, pnpm, tsdown, vitest) and amounts to only 5 runtime dependencies.

The recommended approach is to build incrementally along the dependency chain: foundation (config, audit, storage, types) first, then network registration with Axon, then the consent/relationship trust layer, then WebSocket routing, then operational data (scheduling/billing), then the REST API surface, and finally chart sync and integration testing. SQLite should be the primary storage engine from day one -- the PRD's query patterns (time-range appointments, status-based billing filters, relationship lookups) demand indexing that file-backed JSON cannot provide, and retrofitting atomic writes and concurrent-write safety onto JSON files is more work than starting with SQLite. The audit log remains a separate hash-chained JSONL file (append-only, tamper-evident).

The key risks are: (1) WebSocket session bridge memory leaks from orphaned connections and backpressure-induced unbounded buffering -- these must be solved in the bridge design, not bolted on; (2) accidental PHI leakage into logs or storage that destroys the "not a HIPAA covered entity" architectural defense -- this requires disciplined enforcement starting from the audit logger design; (3) Ed25519 key format mismatches across the CareAgent ecosystem (patient-core, provider-core, neuron) that cause silent consent verification failures -- the canonical key format must be specified before implementation; and (4) hash-chain integrity failures from non-deterministic JSON serialization or crash-during-append -- deterministic serialization and checkpoint mechanisms must be built into the audit logger foundation.

## Key Findings

### Recommended Stack

The stack is minimal and deliberate: 5 runtime dependencies, all justified by gaps in Node.js built-ins. The PRD constrains the core choices (Node.js 22 LTS, TypeScript 5.7, pnpm, tsdown, vitest, TypeBox, raw `node:http`). Research confirms these constraints are sound and identifies the optimal libraries for the remaining gaps.

**Core technologies:**
- **Node.js 22.12.0+ (LTS):** Runtime. Stable Ed25519 in `node:crypto`, stable `crypto.randomUUID()`, built-in `--env-file`. LTS through Apr 2027.
- **TypeScript 5.7.x:** Language. PRD constraint. `using` declarations useful for resource cleanup (WebSocket sessions, file handles).
- **better-sqlite3 12.6.x:** Primary storage. SQLite with synchronous API, ACID transactions, indexing for time-range queries. Node.js `node:sqlite` is still experimental -- do not use it.
- **ws 8.19.x:** WebSocket server. Node.js has no built-in WebSocket server (only client). `ws` is the de facto standard (80M+ weekly downloads), integrates with `node:http` via `handleUpgrade()`.
- **@homebridge/ciao 1.3.x:** mDNS/DNS-SD advertisement. RFC 6762/6763 compliant, pure TypeScript, actively maintained. Battle-tested in Homebridge ecosystem.
- **@sinclair/typebox 0.34.x:** Schema validation. PRD constraint. Produces JSON Schema (reusable for OpenAPI 3.1) with static TypeScript type inference.
- **commander 14.x:** CLI framework. Neuron's nested subcommand tree (`neuron provider add/remove/list`, `neuron api-key create/revoke/list`) is too complex for `util.parseArgs`.

**Key stack decisions:**
- Use `crypto.randomUUID()` instead of the `uuid` package -- zero-dependency UUID v4.
- Use `node:crypto` for Ed25519 instead of `@noble/ed25519` -- built-in is sufficient.
- Pino is optional for v1; `console.log` with JSON formatting may suffice initially.

### Expected Features

**Must have (table stakes):**
- Configuration with TypeBox validation and env var overrides (fail-fast on invalid config)
- Hash-chained tamper-evident audit logging (JSONL with SHA-256)
- Organization + provider registration with Axon (NPI validation, heartbeat)
- Ed25519 consent verification on every connection (stateless, no cached trust)
- Relationship store with consent handshake and termination lifecycle
- Patient-to-provider WebSocket session routing with concurrency limits
- Scheduling and billing data layer (referenced by `relationship_id` only, no patient identity)
- REST API with API key auth, rate limiting, CORS, and OpenAPI 3.1 spec generation
- Patient chart sync endpoint (patient-controlled data push, purgeable on revocation)
- Local network discovery via mDNS/DNS-SD

**Should have (differentiators):**
- Cryptographic consent-first architecture (no other open-source healthcare server does this)
- Zero patient identity storage (keeps Neuron outside HIPAA covered entity classification)
- Agent-aware session routing (not message-based like Mirth Connect or FHIR servers)
- Patient-controlled data flow (patients push data; revocation purges cache)
- Scheduling/billing without patient identity (unique in healthcare software)

**Defer (v2+):**
- OAuth 2.0 for REST API auth (API keys sufficient for v1)
- BLE/NFC discovery (requires native client SDKs)
- Multi-site clustering (distributed consensus adds massive complexity)
- Production database migration (PostgreSQL)
- Claims submission to payers (entire product domain)
- External calendar integration (Google/Outlook OAuth flows)

### Architecture Approach

The Neuron follows a four-layer architecture: Network (HTTP, WebSocket, mDNS listeners), Interface (REST API middleware, WebSocket routing, mDNS discovery), Domain (7 modules: registration, consent, relationships, termination, scheduling, billing, chart sync), and Infrastructure (storage abstraction, audit logger, config loader, type schemas). Modules communicate through direct function calls with typed interfaces -- no event bus, no message queue. Dependencies are injected at construction time in `server.ts`. The storage abstraction (`Store<T>` interface) enables SQLite from day one with a clean migration path if the backend ever needs to change.

**Major components:**
1. **Server Core (`server.ts`)** -- HTTP + WebSocket lifecycle orchestration, startup/shutdown, dependency wiring
2. **Config (`config/`)** -- Load `neuron.config.json`, apply `NEURON_` env overrides, validate with TypeBox, fail-fast
3. **Registration (`registration/`)** -- Axon registry client, heartbeat with backoff, provider credential management
4. **Consent (`consent/`)** -- Stateless Ed25519 token verification, challenge-response nonce generation
5. **Relationships (`relationships/`)** -- RelationshipRecord CRUD, consent handshake state machine, queries by patient/provider
6. **Routing (`routing/`)** -- WebSocket server, connection auth pipeline, bidirectional session bridge, session tracking
7. **Scheduling/Billing (`scheduling/`, `billing/`)** -- Operational data CRUD referencing `relationship_id` only
8. **REST API (`api/`)** -- Manual route dispatch, middleware pipeline (CORS, auth, rate limit), OpenAPI generation
9. **Sync (`sync/`)** -- Chart sync receiver over WebSocket, authorization checks, cache purge on revocation
10. **Audit (`audit/`)** -- Hash-chained JSONL writer, chain integrity verification

### Critical Pitfalls

1. **WebSocket session bridge memory leaks** -- Track every bridge as a `BridgeSession` object with explicit `destroy()`. Remove all listeners, call `socket.terminate()` on both sides, set idle timeouts, run periodic sweeps. Must be in the bridge design from day one (Phase 4).

2. **WebSocket backpressure causing unbounded memory growth** -- Check `ws.bufferedAmount` before forwarding each message. Pause source socket when buffer exceeds threshold. Set `maxPayload` limits. Terminate sessions at hard ceiling (1MB). Must be in the bridge from the start (Phase 4).

3. **Accidental PHI leakage into logs/storage** -- Never log raw WebSocket message content. Define audit log field allowlists per event type. Treat chart `content` as opaque blobs. Sanitize error context. This is an ongoing discipline starting from Phase 1.

4. **Ed25519 key format mismatch across ecosystem** -- Define canonical format (base64url raw 32-byte keys) before implementation. Write `keyFromRaw()` utility that wraps to DER for Node.js `crypto.verify()`. Cross-repo integration test fixtures. Must be locked before Phase 3.

5. **Hash-chained audit log integrity failures** -- Use deterministic JSON serialization (sorted keys). Implement checkpointing every N entries. Use synchronous `appendFileSync()`. Verify chain on startup. Must be in the audit logger foundation (Phase 1).

6. **File-backed JSON store corruption** -- Moot if starting with SQLite (recommended). If JSON is used anywhere, require atomic writes via temp-file + rename and per-store write queues.

## Implications for Roadmap

Based on the dependency chain from ARCHITECTURE.md, the feature groupings from FEATURES.md, and the pitfall-to-phase mapping from PITFALLS.md, the following 9-phase structure is recommended:

### Phase 1: Foundation (Config, Audit, Storage, Types)
**Rationale:** Every subsequent module depends on config, audit logging, storage, and shared types. This is the zero-dependency base layer. Building these together is correct because audit logging must be available from Phase 1 onward (consumed by all phases).
**Delivers:** Validated config loading, hash-chained JSONL audit logger, SQLite storage abstraction, TypeBox schemas, CLI stubs (`neuron init`, `neuron start`).
**Addresses:** Configuration & Validation, Audit Logging, Persistence.
**Avoids:** Hash-chain integrity failures (deterministic serialization from the start), JSON corruption (SQLite avoids it entirely), env var type coercion bugs, PHI leakage patterns in the audit logger.
**Stack:** TypeBox, better-sqlite3, `node:crypto` (SHA-256), commander (CLI stubs).

### Phase 2: Axon Registration and Provider Management
**Rationale:** The Neuron cannot be discovered by patients until it registers with the Axon directory. Registration depends on config (NPI, Axon URL) from Phase 1. Provider management and heartbeat are tightly coupled to registration.
**Delivers:** Axon registry client (mocked), organization registration, provider add/remove/list, heartbeat with backoff and jitter, CLI commands (`neuron init` interactive, `neuron provider add/remove/list`).
**Addresses:** Organization Registration, Provider Credential Management, Heartbeat/Health Monitoring.
**Avoids:** Heartbeat thundering herd (jitter), Axon mock with wrong semantics (build mock from Axon PRD contract exactly).
**Stack:** `node:http` outbound (fetch), `node:crypto` (bearer tokens).

### Phase 3: Consent Verification, Relationships, and Termination
**Rationale:** Consent verification is the trust foundation. No routing happens without it. Relationships are the routing primitive. Termination is legally required lifecycle management. All three are tightly coupled and depend on Phase 2 (provider NPIs must exist).
**Delivers:** Ed25519 consent token verifier, relationship store with consent handshake, relationship queries (by patient/provider/ID), termination flow with state protocol references.
**Addresses:** Consent Verification (Ed25519), Relationship Store, Relationship Termination.
**Avoids:** Ed25519 key format mismatch (canonical format locked before implementation), consent caching (stateless re-verification enforced), corrupt relationship store on malformed data.
**Stack:** `node:crypto` (Ed25519 sign/verify).

### Phase 4: WebSocket Routing and Session Management
**Rationale:** This is the core function of the Neuron. It depends on consent (Phase 3) and relationships (Phase 3) for connection authentication. This is also where the two most critical pitfalls (memory leaks and backpressure) must be addressed.
**Delivers:** WebSocket server (`ws`), connection authentication pipeline, bidirectional session bridge with backpressure handling, session tracking with concurrency limits, idle timeouts, periodic sweep.
**Addresses:** Patient-to-Provider Connection Routing, Session Management.
**Avoids:** Bridge memory leaks (BridgeSession with explicit destroy), backpressure (bufferedAmount checks, pause/resume, hard ceiling), PHI in WebSocket logs (log only type, size, session ID).
**Stack:** `ws`, `node:http` (upgrade handling).

### Phase 5: Local Network Discovery (mDNS/DNS-SD)
**Rationale:** A thin layer over Phase 4's routing infrastructure. Adds an alternative discovery channel (local network) into the same consent and routing pipeline. Can be built immediately after Phase 4.
**Delivers:** mDNS service advertisement (`_careagent-neuron._tcp`), TXT records with NPI and protocol version, auto-start/stop with server lifecycle, graceful unadvertisement on shutdown.
**Addresses:** Local Network Discovery (mDNS).
**Avoids:** mDNS on untrusted networks (default to private subnets, warn on public interfaces), missing graceful shutdown (unadvertise on SIGTERM/SIGINT).
**Stack:** `@homebridge/ciao`.

### Phase 6: Scheduling and Billing Data Layer
**Rationale:** Operational data storage that references `relationship_id` only. Depends on the relationship store (Phase 3) for ID validation. Can be built in parallel with Phases 4-5 since it only depends on Phase 3.
**Delivers:** Appointment CRUD with status lifecycle, provider availability management, billing record CRUD with CPT/ICD codes, time-range queries.
**Addresses:** Scheduling Data Layer, Billing Data Layer, Scheduling/Billing Without Patient Identity (differentiator).
**Avoids:** Patient identity leakage (all references via relationship_id only), timezone handling bugs in availability windows.
**Stack:** better-sqlite3 (indexed time-range queries).

### Phase 7: REST API with Authentication
**Rationale:** The REST API is the exposure layer for all operational data. It depends on scheduling (Phase 6), billing (Phase 6), relationships (Phase 3), and registration (Phase 2) for data access. This is also where CORS, rate limiting, and API key management are implemented.
**Delivers:** Manual route dispatch on `node:http`, middleware pipeline (CORS, auth, rate limit, error handler), all REST endpoints, OpenAPI 3.1 spec generation, API key CLI commands (`neuron api-key create/revoke/list`), cursor-based pagination.
**Addresses:** REST API with Auth and Rate Limiting, OpenAPI 3.1 Spec Generation.
**Avoids:** CORS misconfiguration (origin allowlist from config), timing attacks on API key comparison (`crypto.timingSafeEqual`), missing pagination (cursor-based from the start), request body size limits (set Content-Length limit), raw 500 errors (structured error responses with specific HTTP codes).
**Stack:** `node:http`, TypeBox (request/response validation), commander (API key CLI).

### Phase 8: Patient Chart Sync
**Rationale:** Chart sync depends on both WebSocket sessions (Phase 4) and consent scope (Phase 3). It is the final domain feature and does not block the REST API.
**Delivers:** Chart sync receiver over WebSocket, authorization checks against consent scope, incremental sync with timestamp tracking, access revocation with cache purge, duplicate detection.
**Addresses:** Patient Chart Sync, Patient-Controlled Data Flow (differentiator).
**Avoids:** PHI in cached chart entries (treat content as opaque blobs, never index), duplicate entries on re-sync, missing cache purge on revocation.
**Stack:** `ws` (uses existing sessions), better-sqlite3 (cached entries).

### Phase 9: Integration Testing and Documentation
**Rationale:** End-to-end validation that all 9 functionalities work together. Depends on all prior phases. Also the phase where cross-repo integration tests catch Ed25519 key format issues that unit tests missed.
**Delivers:** E2E integration test suite, API documentation, deployment guide, startup banner, cross-repo test fixtures.
**Addresses:** E2E Integration Tests, documentation.
**Avoids:** "Looks done but isn't" items (connection timeout handling, clock skew tolerance, rate limiter cleanup, preflight caching, etc.).
**Stack:** vitest (integration tests).

### Phase Ordering Rationale

- **Phases 1-3 are strictly sequential.** Each layer depends on the one below it. Config/audit/storage must exist before registration, and registration/consent must exist before routing.
- **Phase 6 can be parallelized with Phases 4-5.** Scheduling/billing only depend on Phase 3 (relationships) for `relationship_id` validation. They do not need WebSocket routing.
- **Phase 7 must follow Phase 6.** The REST API exposes scheduling and billing data; it cannot be built without them.
- **Phase 8 is intentionally late.** Chart sync is the most complex feature (WebSocket + consent + storage + revocation) and benefits from all prior infrastructure being solid.
- **Phase 9 is naturally last** but the "looks done but isn't" checklist should be applied incrementally at the end of each phase.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Consent + Relationships):** Ed25519 key format specification must be coordinated with patient-core and provider-core repos. The consent handshake state machine needs protocol-level specification from the Axon PRD. Research the exact token format before implementation.
- **Phase 4 (WebSocket Routing):** Backpressure handling in `ws` is not well-documented at the application level. Research `socket._socket.pause()`/`resume()` patterns and `drain` event semantics. Bridge design is critical and non-trivial.
- **Phase 2 (Registration):** The Axon registry API does not exist yet. The mock must be built from the Axon PRD contract. Research what error responses the mock should simulate (409, 401, 503).

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Config loading, TypeBox validation, SQLite setup, JSONL append -- all well-documented with established patterns.
- **Phase 5 (mDNS Discovery):** `@homebridge/ciao` has clear API documentation and examples. Thin integration layer.
- **Phase 6 (Scheduling/Billing):** Standard CRUD with SQLite. Time-range queries and status filters are textbook SQL.
- **Phase 7 (REST API):** Manual route dispatch on `node:http` is well-documented. Middleware pipeline is a standard pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official documentation and npm registry. Version compatibility confirmed. PRD constraints are sound. Only MEDIUM-confidence item is `@homebridge/ciao` (less mainstream than other choices, but actively maintained and RFC-compliant). |
| Features | HIGH | Feature landscape derived from PRD requirements and healthcare domain standards. Competitor analysis (Mirth Connect, OpenEMR, FHIR servers) confirms unique positioning. Feature dependencies are clear. |
| Architecture | HIGH | Four-layer pattern is standard for Node.js servers of this complexity. All architectural patterns (middleware pipeline, storage abstraction, connection auth pipeline, hash-chained log, DI) are well-documented with multiple sources. Project structure maps cleanly to domain modules. |
| Pitfalls | HIGH | Critical pitfalls verified across multiple sources (ws GitHub issues, Node.js docs, healthcare compliance literature). WebSocket memory leaks and backpressure are well-known Node.js challenges. PHI leakage is the domain-specific risk unique to this project. |

**Overall confidence:** HIGH

### Gaps to Address

- **Axon Registry API contract:** The Axon registry does not exist yet. The mock must be built from the Axon PRD, but the exact API endpoints, error codes, and authentication flow need validation during Phase 2 planning. If the Axon PRD is incomplete, define the contract in Neuron and let Axon conform.
- **Cross-repo Ed25519 key format:** patient-core, provider-core, and neuron must agree on the canonical key encoding. This must be resolved before Phase 3 implementation. If other repos do not yet exist, define the format in neuron and document it as the specification.
- **Provider CareAgent connection model:** The bridge connects to provider CareAgents via WebSocket, but the provider endpoint configuration model (how provider-core exposes its WebSocket endpoint, whether it runs on localhost or a remote host) needs clarification during Phase 4 planning.
- **ProtocolServer interface compliance:** Neuron must implement provider-core's `ProtocolServer` interface. The exact interface shape needs validation against provider-core exports during Phase 4.
- **mDNS behavior in Docker/CI:** mDNS requires multicast networking. CI environments and Docker default bridge networking block multicast. Discovery tests need a clear skip strategy or `--network host` configuration.
- **Audit log rotation:** The JSONL file grows unboundedly. A rotation strategy (size-based or time-based) is not specified in the PRD but is needed for any deployment lasting more than a few weeks. Address during Phase 1 implementation.

## Sources

### Primary (HIGH confidence)
- [Node.js 22 LTS documentation](https://nodejs.org/api/) -- crypto, http, sqlite (experimental), util.parseArgs
- [ws GitHub](https://github.com/websockets/ws) -- WebSocket server API, upgrade handling, bufferedAmount
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) -- synchronous SQLite API, WAL mode, Node 22 compatibility
- [TypeBox GitHub](https://github.com/sinclairzx81/typebox) -- JSON Schema + TypeScript type inference, TypeCompiler
- [commander npm](https://www.npmjs.com/package/commander) -- CLI framework, v14.0.3
- [Node.js crypto](https://nodejs.org/api/crypto.html) -- Ed25519 sign/verify, SHA-256, randomUUID
- [Efficient Data Structures for Tamper-Evident Logging (Crosby & Wallach, USENIX 2009)](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf)

### Secondary (MEDIUM confidence)
- [@homebridge/ciao npm](https://www.npmjs.com/package/@homebridge/ciao) -- mDNS/DNS-SD, v1.3.5
- [Keygen Ed25519 key handling in Node.js](https://keygen.sh/blog/how-to-use-hexadecimal-ed25519-keys-in-node/) -- DER prefix for raw key conversion
- [HIPAA Audit Log Requirements (Kiteworks)](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/) -- tamper-evident logging standards
- [WebSocket memory leak patterns (OneUptime, 2026)](https://oneuptime.com/blog/post/2026-01-24-websocket-memory-leak-issues/view)
- [WebSocket backpressure patterns (Medium, 2025)](https://medium.com/@hadiyolworld007/node-js-websockets-backpressure-flow-control-patterns-for-stable-real-time-apps-27ab522a9e69)

### Tertiary (LOW confidence)
- [NPPES NPI Registry](https://npiregistry.cms.hhs.gov/) -- NPI validation (Luhn check algorithm verified, but registry API for runtime validation not yet investigated)
- [tsdown npm](https://www.npmjs.com/package/tsdown) -- v0.20.3, Rolldown-powered (relatively new tool, less community history than tsup)

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
