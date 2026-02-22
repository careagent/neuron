# Requirements: @careagent/neuron

**Defined:** 2026-02-21
**Core Value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.

## v1 Requirements

### Foundation (FOUN)

- [x] **FOUN-01**: pnpm TypeScript project scaffold with tsdown build, vitest testing
- [ ] **FOUN-02**: TypeBox schema for `neuron.config.json` with full validation at startup
- [ ] **FOUN-03**: Configuration loader reads config file, applies NEURON_ environment variable overrides, validates against schema
- [ ] **FOUN-04**: Invalid configuration prevents startup with clear error messages and non-zero exit
- [ ] **FOUN-05**: NPI validation utility (10-digit format, Luhn check) for organization and all providers
- [ ] **FOUN-06**: CLI entry point with stub commands: `neuron init`, `neuron start`, `neuron stop`, `neuron status`
- [ ] **FOUN-07**: Storage abstraction interface with file-backed JSON or SQLite implementation
- [x] **FOUN-08**: All TypeBox schemas for core data models exported from `src/types/`

### Audit Logging (AUDT)

- [ ] **AUDT-01**: Hash-chained JSONL audit log with SHA-256 tamper-evident chain (deterministic serialization)
- [ ] **AUDT-02**: Audit events for: registration, connection, consent, API access, sync, admin, termination
- [ ] **AUDT-03**: Audit chain integrity verification utility

### National Registration (NREG)

- [x] **NREG-01**: Organization registration with Axon using NPI via `AxonRegistry.registerNeuron()`
- [x] **NREG-02**: Provider registration with Axon via `AxonRegistry.registerProvider()` (providers never contact Axon directly)
- [x] **NREG-03**: Periodic heartbeat to maintain `reachable` status via `AxonRegistry.updateEndpoint()`
- [x] **NREG-04**: Dynamic provider management (add/remove/update without restart) via CLI
- [x] **NREG-05**: Registration state persistence (NeuronRegistrationState) across Neuron restarts
- [x] **NREG-06**: Graceful degradation when Axon is unreachable (established relationships continue operating)
- [x] **NREG-07**: Mock Axon registry for development and testing

### Consent Verification (CSNT)

- [ ] **CSNT-01**: Ed25519 consent token verification using Node.js built-in `crypto`
- [ ] **CSNT-02**: Stateless re-verification on every connection (no cached trust)
- [ ] **CSNT-03**: Expired consent tokens rejected with specific error code
- [ ] **CSNT-04**: Consent scope passed to provider CareAgent (Neuron does not interpret scope)

### Relationship Registration (RELN)

- [ ] **RELN-01**: RelationshipRecord store with persistent storage (survives restarts)
- [ ] **RELN-02**: Consent handshake handler (Neuron side of Axon protocol handshake)
- [ ] **RELN-03**: Relationship queries by patient agent ID, provider NPI, relationship ID, status
- [ ] **RELN-04**: Challenge-response generation for identity verification

### Relationship Termination (TERM)

- [ ] **TERM-01**: Provider-initiated termination following state protocol requirements
- [ ] **TERM-02**: Terminated relationships permanently stop routing (no reactivation)
- [ ] **TERM-03**: TerminationRecord persistence with audit trail linkage
- [ ] **TERM-04**: Terminated = permanent; new relationship requires fresh handshake

### Connection Routing (ROUT)

- [ ] **ROUT-01**: WebSocket server accepting inbound patient CareAgent connections
- [ ] **ROUT-02**: Connection authentication pipeline: consent token → relationship check → route
- [ ] **ROUT-03**: Bidirectional session bridge between patient and provider WebSocket connections with backpressure handling
- [ ] **ROUT-04**: Active session tracking with per-provider concurrency limits (configurable, default 10)
- [ ] **ROUT-05**: Graceful session termination from either side with cleanup
- [ ] **ROUT-06**: Implements `ProtocolServer` interface from provider-core (start, stop, activeSessions)

### Local Network Discovery (DISC)

- [ ] **DISC-01**: mDNS/DNS-SD advertisement with service type `_careagent-neuron._tcp`
- [ ] **DISC-02**: TXT record with organization NPI, protocol version, and connection endpoint
- [ ] **DISC-03**: Auto-start/stop with Neuron lifecycle (configurable via `localNetwork.enabled`)
- [ ] **DISC-04**: Same consent verification flow as remote connections (no security shortcuts for local)

### Scheduling (SCHED)

- [ ] **SCHED-01**: Appointment CRUD with full status lifecycle (scheduled -> confirmed -> checked_in -> in_progress -> completed/cancelled/no_show)
- [ ] **SCHED-02**: Provider availability management (recurring, one-time, blocks)
- [ ] **SCHED-03**: Time-based and status-based query engine (by date range, provider, status)
- [ ] **SCHED-04**: All scheduling records reference `relationship_id` only (no patient identity)

### Billing (BILL)

- [ ] **BILL-01**: Billing record CRUD with CPT code entry, modifiers, and units
- [ ] **BILL-02**: ICD-10 code entry for billing justification
- [ ] **BILL-03**: Billing status tracking (draft -> submitted -> accepted/denied/appealed)
- [ ] **BILL-04**: All billing records reference `relationship_id` only (no patient identity)

### Third-Party REST API (TAPI)

- [ ] **TAPI-01**: HTTP server on Node.js built-in `http` module with manual route dispatch
- [ ] **TAPI-02**: API key authentication for all endpoints (generated/revoked via CLI)
- [ ] **TAPI-03**: Rate limiting per API key with configurable limits and 429 responses
- [ ] **TAPI-04**: CORS handling with configurable allowed origins
- [ ] **TAPI-05**: All routes implemented: organization, scheduling, billing, relationships (read-only), status
- [ ] **TAPI-06**: OpenAPI 3.1 specification generated from route definitions, served at `GET /openapi.json`
- [ ] **TAPI-07**: API key management via CLI (`neuron api-key create/revoke/list`)

### Patient Chart Sync (SYNC)

- [ ] **SYNC-01**: Sync receiver accepting incremental chart updates over established WebSocket sessions
- [ ] **SYNC-02**: Authorization check (relationship must grant chart read access in consented_actions)
- [ ] **SYNC-03**: CachedChartEntry store with persistence and SHA-256 integrity verification
- [ ] **SYNC-04**: Incremental sync with last-sync-timestamp tracking per relationship
- [ ] **SYNC-05**: Access revocation: purge all cached entries for relationship and stop accepting sync data

### Integration & Documentation (INTG)

- [ ] **INTG-01**: E2E test: full lifecycle (init -> register -> add provider -> patient connects -> consent -> session -> terminate)
- [ ] **INTG-02**: E2E test: local discovery flow (mDNS advertise -> discover -> connect -> consent)
- [ ] **INTG-03**: E2E test: scheduling/billing through REST API (API key -> CRUD -> rate limiting)
- [ ] **INTG-04**: E2E test: chart sync and revocation (authorize -> sync -> revoke -> purge)
- [ ] **INTG-05**: REST API documentation (`docs/api.md`) with endpoint reference and request/response examples
- [ ] **INTG-06**: Architecture guide (`docs/architecture.md`) with data flow diagrams
- [ ] **INTG-07**: Configuration reference (`docs/configuration.md`) with all options and environment variables

## v2 Requirements

### Discovery

- **DISC-05**: BLE discovery for proximity-based connections
- **DISC-06**: NFC discovery for tap-to-connect

### Storage & Security

- **STOR-01**: Production database backend (PostgreSQL/MySQL)
- **SEC-01**: Data encryption at rest
- **SEC-02**: Mutual TLS for Axon communication
- **SEC-03**: OAuth 2.0 for third-party API authentication

### Scale

- **SCALE-01**: Multi-site clustering
- **SCALE-02**: Load balancing and horizontal scaling

### Integrations

- **BILL-05**: Claims submission to payers
- **SCHED-05**: External calendar integration (Google Calendar, Outlook)
- **SDK-01**: Full `@careagent/neuron-sdk` TypeScript client package

## Out of Scope

| Feature | Reason |
|---------|--------|
| Clinical data storage | Neuron is operational infrastructure, not a clinical system; would require HIPAA compliance |
| LLM or AI reasoning | Intelligence lives in CareAgents, not infrastructure |
| Writing to Patient Charts | Only credentialed provider CareAgents write to Patient Charts |
| EMR replacement | Minimal operational data layer only; full EMR is massive scope expansion |
| Direct Axon exposure for third parties | Axon is a closed protocol layer for ecosystem participants only |
| Patient identity storage | Opaque relationship_id only; patient names/identity live with patient CareAgent |
| Real-time clinical messaging | Neuron routes sessions, not clinical messages; content flows peer-to-peer |
| Credential issuance | Neuron verifies credentials, does not issue them |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Complete |
| FOUN-02 | Phase 1 | Pending |
| FOUN-03 | Phase 1 | Pending |
| FOUN-04 | Phase 1 | Pending |
| FOUN-05 | Phase 1 | Pending |
| FOUN-06 | Phase 1 | Pending |
| FOUN-07 | Phase 1 | Pending |
| FOUN-08 | Phase 1 | Complete |
| AUDT-01 | Phase 1 | Pending |
| AUDT-02 | Phase 1 | Pending |
| AUDT-03 | Phase 1 | Pending |
| NREG-01 | Phase 2 | Complete |
| NREG-02 | Phase 2 | Complete |
| NREG-03 | Phase 2 | Complete |
| NREG-04 | Phase 2 | Complete |
| NREG-05 | Phase 2 | Complete |
| NREG-06 | Phase 2 | Complete |
| NREG-07 | Phase 2 | Complete |
| CSNT-01 | Phase 3 | Pending |
| CSNT-02 | Phase 3 | Pending |
| CSNT-03 | Phase 3 | Pending |
| CSNT-04 | Phase 3 | Pending |
| RELN-01 | Phase 3 | Pending |
| RELN-02 | Phase 3 | Pending |
| RELN-03 | Phase 3 | Pending |
| RELN-04 | Phase 3 | Pending |
| TERM-01 | Phase 3 | Pending |
| TERM-02 | Phase 3 | Pending |
| TERM-03 | Phase 3 | Pending |
| TERM-04 | Phase 3 | Pending |
| ROUT-01 | Phase 4 | Pending |
| ROUT-02 | Phase 4 | Pending |
| ROUT-03 | Phase 4 | Pending |
| ROUT-04 | Phase 4 | Pending |
| ROUT-05 | Phase 4 | Pending |
| ROUT-06 | Phase 4 | Pending |
| DISC-01 | Phase 5 | Pending |
| DISC-02 | Phase 5 | Pending |
| DISC-03 | Phase 5 | Pending |
| DISC-04 | Phase 5 | Pending |
| SCHED-01 | Phase 6 | Pending |
| SCHED-02 | Phase 6 | Pending |
| SCHED-03 | Phase 6 | Pending |
| SCHED-04 | Phase 6 | Pending |
| BILL-01 | Phase 6 | Pending |
| BILL-02 | Phase 6 | Pending |
| BILL-03 | Phase 6 | Pending |
| BILL-04 | Phase 6 | Pending |
| TAPI-01 | Phase 7 | Pending |
| TAPI-02 | Phase 7 | Pending |
| TAPI-03 | Phase 7 | Pending |
| TAPI-04 | Phase 7 | Pending |
| TAPI-05 | Phase 7 | Pending |
| TAPI-06 | Phase 7 | Pending |
| TAPI-07 | Phase 7 | Pending |
| SYNC-01 | Phase 8 | Pending |
| SYNC-02 | Phase 8 | Pending |
| SYNC-03 | Phase 8 | Pending |
| SYNC-04 | Phase 8 | Pending |
| SYNC-05 | Phase 8 | Pending |
| INTG-01 | Phase 9 | Pending |
| INTG-02 | Phase 9 | Pending |
| INTG-03 | Phase 9 | Pending |
| INTG-04 | Phase 9 | Pending |
| INTG-05 | Phase 9 | Pending |
| INTG-06 | Phase 9 | Pending |
| INTG-07 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 67 total
- Mapped to phases: 67
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after roadmap creation*
