# Roadmap: @careagent/neuron

## Overview

The Neuron is built along its dependency chain: foundation infrastructure first (config, audit, storage, types), then outward-facing network registration with Axon, then the consent/relationship trust layer that gates all communication, then WebSocket routing that connects patients to providers, then local network discovery as an alternative entry point, then the REST API that exposes operational data to third parties, and finally end-to-end integration testing and documentation that validates everything works together. Each phase delivers a complete, verifiable capability that subsequent phases build upon.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Config, audit logging, storage, types, CLI stubs, and NPI validation
- [ ] **Phase 2: Axon Registration** - Organization and provider registration with heartbeat and mock Axon
- [x] **Phase 3: Consent and Relationships** - Ed25519 consent verification, relationship store, and termination lifecycle (completed 2026-02-22)
- [ ] **Phase 4: WebSocket Routing** - Patient-to-provider session routing with backpressure and concurrency control
- [x] **Phase 5: Local Discovery** - mDNS/DNS-SD advertisement for local network CareAgent connections (completed 2026-02-22)
- [x] **Phase 6: REST API** - Third-party HTTP API with auth, rate limiting, CORS, and OpenAPI spec (completed 2026-02-22)
- [ ] **Phase 7: Integration and Documentation** - E2E tests across all functionalities and reference documentation
- [ ] **Phase 8: Foundation Tech Debt** - Wire neuron stop, add missing audit producers, add audit verification CLI command (gap closure)

## Phase Details

### Phase 1: Foundation
**Goal**: The Neuron can load validated configuration, persist data, produce tamper-evident audit logs, and expose a CLI skeleton
**Depends on**: Nothing (first phase)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, FOUN-06, FOUN-07, FOUN-08, AUDT-01, AUDT-02, AUDT-03
**Success Criteria** (what must be TRUE):
  1. Running `neuron start` with an invalid config file fails with a clear error message and non-zero exit code
  2. Running `neuron start` with a valid `neuron.config.json` loads configuration, applies `NEURON_` environment variable overrides, and starts successfully
  3. Every auditable action appends a hash-chained JSONL entry, and the audit chain integrity verification utility confirms the chain is intact
  4. An NPI with an invalid Luhn check digit is rejected; a valid 10-digit NPI passes validation
  5. All core data model schemas (config, relationships, audit events) are exported from `src/types/` and usable for validation
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold and TypeBox data model schemas
- [x] 01-02-PLAN.md — NPI Luhn validation (TDD) and configuration loading pipeline
- [x] 01-03-PLAN.md — Storage engine with SQLite and hash-chained audit logging (TDD)
- [x] 01-04-PLAN.md — CLI entry point wiring all foundation components

### Phase 2: Axon Registration
**Goal**: The Neuron registers itself and its providers with the Axon network directory and maintains reachable status through heartbeats
**Depends on**: Phase 1
**Requirements**: NREG-01, NREG-02, NREG-03, NREG-04, NREG-05, NREG-06, NREG-07
**Success Criteria** (what must be TRUE):
  1. On startup, the Neuron registers the organization NPI with the mock Axon registry and appears as `reachable` in the directory
  2. Providers can be added, removed, and updated via CLI commands (`neuron provider add/remove/list`) without restarting the server
  3. Periodic heartbeat keeps the Neuron's endpoint status `reachable`; stopping heartbeat causes the mock Axon to mark it unreachable
  4. After a restart, previously registered organization and provider state is restored from persistent storage without re-registration
  5. When the Axon registry is unreachable, the Neuron continues operating for established relationships and retries registration with backoff
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md — Registration data model (TypeBox schemas, config extension, SQLite migration v2) and mock Axon server
- [ ] 02-02-PLAN.md — AxonClient HTTP wrapper, RegistrationStateStore, HeartbeatManager, and AxonRegistrationService
- [ ] 02-03-PLAN.md — IPC layer (Unix domain socket server, client, protocol schemas)
- [ ] 02-04-PLAN.md — Provider CLI commands and neuron start/status integration wiring

### Phase 3: Consent and Relationships
**Goal**: The Neuron verifies cryptographic consent on every connection and manages the full relationship lifecycle from handshake through termination
**Depends on**: Phase 2
**Requirements**: CSNT-01, CSNT-02, CSNT-03, CSNT-04, RELN-01, RELN-02, RELN-03, RELN-04, TERM-01, TERM-02, TERM-03, TERM-04
**Success Criteria** (what must be TRUE):
  1. A valid Ed25519 consent token is verified successfully; an expired or tampered token is rejected with a specific error code
  2. A consent handshake between a patient CareAgent and a provider creates a RelationshipRecord that persists across Neuron restarts
  3. Relationships can be queried by patient agent ID, provider NPI, relationship ID, and status
  4. A provider-initiated termination permanently stops routing for that relationship; attempting to connect on a terminated relationship fails
  5. A terminated relationship cannot be reactivated; establishing care again requires a completely new consent handshake
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — Ed25519 consent token verification (TDD) and RelationshipRecord schema update
- [ ] 03-02-PLAN.md — RelationshipStore CRUD/queries and ConsentHandshakeHandler
- [ ] 03-03-PLAN.md — TerminationHandler with transactional safety and IPC integration

### Phase 4: WebSocket Routing
**Goal**: Patient CareAgents can connect to provider CareAgents through the Neuron with verified consent, bidirectional message flow, and resource-safe session management
**Depends on**: Phase 3
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05, ROUT-06
**Success Criteria** (what must be TRUE):
  1. A patient CareAgent with a valid consent token and active relationship connects via WebSocket and is routed to the correct provider CareAgent
  2. After consent verification and challenge-response, the Neuron completes the address exchange (patient receives provider_endpoint, relationship recorded) and closes the connection — the broker-and-step-out model with connection queuing prevents unbounded memory growth
  3. A global handshake safety ceiling (configurable maxConcurrentHandshakes, default 10) queues connections beyond the limit rather than rejecting them; queued connections are promoted as slots open or time out gracefully
  4. When either side disconnects, the session is cleaned up gracefully (all listeners removed, both sockets closed, session tracking updated)
  5. The Neuron satisfies the `ProtocolServer` interface from provider-core (`start`, `stop`, `activeSessions`)
**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md — Routing types and schemas (config extension, ProtocolServer interface, handshake messages, error types)
- [ ] 04-02-PLAN.md — WebSocket server and handshake handler (NeuronProtocolServer, safety ceiling, connection handler)
- [ ] 04-03-PLAN.md — CLI wiring and integration tests (start command lifecycle, comprehensive WebSocket tests)
- [ ] 04-04-PLAN.md — Gap closure: update ROADMAP SC-2/SC-3, add missing audit event, remove dead test code

### Phase 5: Local Discovery
**Goal**: CareAgents on the local network can discover the Neuron via mDNS/DNS-SD and connect with the same consent-verified flow as remote connections
**Depends on**: Phase 4
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04
**Success Criteria** (what must be TRUE):
  1. When the Neuron starts with `localNetwork.enabled: true`, it advertises `_careagent-neuron._tcp` via mDNS with TXT records containing the organization NPI and connection endpoint
  2. When the Neuron shuts down, the mDNS advertisement is gracefully removed from the network
  3. A local connection goes through the same consent verification and relationship check as a remote connection (no security shortcuts)
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Discovery service core (config extension, DiscoveryService class, TDD tests)
- [x] 05-02-PLAN.md — Lifecycle integration and CLI (start/stop wiring, neuron discover command, CLI tests)

### Phase 6: REST API
**Goal**: Third-party applications can access Neuron operational data through an authenticated, rate-limited HTTP API with OpenAPI documentation
**Depends on**: Phase 4
**Requirements**: TAPI-01, TAPI-02, TAPI-03, TAPI-04, TAPI-05, TAPI-06, TAPI-07
**Success Criteria** (what must be TRUE):
  1. All REST endpoints (organization, relationships read-only, status) respond correctly to authenticated requests
  2. Requests without a valid API key receive 401; requests exceeding rate limits receive 429
  3. CORS preflight requests from allowed origins succeed; requests from disallowed origins are rejected
  4. `GET /openapi.json` returns a valid OpenAPI 3.1 specification describing all endpoints
  5. API keys can be created, revoked, and listed via CLI commands (`neuron api-key create/revoke/list`)
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — API key data model, store, rate limiter, config extension, and HTTP utilities (TDD)
- [x] 06-02-PLAN.md — REST API router with auth, CORS, rate limiting, route handlers, and OpenAPI 3.1 spec
- [x] 06-03-PLAN.md — API key CLI commands and start command REST wiring

### Phase 7: Integration and Documentation
**Goal**: All core functionalities work together end-to-end, and operators have reference documentation for deployment and integration
**Depends on**: Phase 6, Phase 5
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04, INTG-05, INTG-06
**Success Criteria** (what must be TRUE):
  1. E2E test passes: full lifecycle from init through register, add provider, patient connect, consent handshake, session, and termination
  2. E2E test passes: local mDNS discovery through consent-verified connection
  3. E2E test passes: REST API key creation with rate limiting enforcement
  4. Documentation exists: REST API documentation (`docs/api.md`), architecture guide with data flow (`docs/architecture.md`), and configuration reference (`docs/configuration.md`)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Foundation Tech Debt
**Goal**: Close tech debt gaps from v1.0 audit — wire `neuron stop` to IPC, add missing audit event producers, and expose audit chain verification via CLI
**Depends on**: Phase 2 (IPC layer required for stop signal)
**Requirements**: FOUN-06, AUDT-02, AUDT-03
**Gap Closure:** Closes gaps from v1.0 milestone audit
**Success Criteria** (what must be TRUE):
  1. `neuron stop` sends a shutdown signal via IPC to a running Neuron process and it exits cleanly
  2. Audit events are emitted for all 6 categories defined in the schema (registration, connection, consent, api_access, admin, termination) — the 2 missing categories (connection, api_access) have producers wired at their natural trigger points
  3. `neuron verify-audit` CLI command runs `verifyAuditChain()` and reports chain integrity status
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 through 8. Phase 8 (gap closure) depends on Phase 2 (IPC layer) and can be executed any time after Phase 2 completes.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-02-21 |
| 2. Axon Registration | 1/4 | In progress | - |
| 3. Consent and Relationships | 3/3 | Complete | 2026-02-22 |
| 4. WebSocket Routing | 4/4 | Complete | 2026-02-22 |
| 5. Local Discovery | 2/2 | Complete | 2026-02-22 |
| 6. REST API | 3/3 | Complete | 2026-02-22 |
| 7. Integration and Documentation | 0/3 | Not started | - |
| 8. Foundation Tech Debt | 0/1 | Not started | - |
