# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Phase 7: Integration and Documentation

## Current Position

Phase: 7 of 8 (Integration and Documentation)
Plan: 07-01 complete, 07-03 in progress
Status: Executing
Last activity: 2026-02-22 -- Plan 07-01 complete: NeuronTestHarness and lifecycle E2E test (7/7 pass)

Progress: [████████████████████████] 20/20 plans (100% of planned so far)

## Performance Metrics

**Velocity:**
- Total plans completed: 16
- Average duration: 3.1min
- Total execution time: 0.82 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02-axon-registration | 4 | 12min | 3min |
| 03-consent-and-relationships | 3 | 7min | 2.3min |
| 04-websocket-routing | 4 | 10min | 2.5min |
| 05-local-discovery | 2 | 8min | 4min |
| 06-rest-api | 3 | 18min | 6min |

**Recent Trend:**
- Last 5 plans: 05-01 (5min), 05-02 (3min), 06-01 (4min), 06-02 (8min), 06-03 (6min)
- Trend: Steady

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: SQLite via better-sqlite3 as primary storage engine from day one (research recommendation; query patterns demand indexing)
- [Roadmap]: 8-phase structure following dependency chain: foundation, registration, consent/relationships, routing, discovery, REST API, integration, tech debt
- [02-01]: Single-row enforcement via CHECK(id=1) constraint on neuron_registration table
- [02-01]: Mock Axon uses in-memory Map state, fresh per run for test reliability
- [02-01]: Mock server outputs ready signal on stdout for test harness integration
- [02-03]: NDJSON protocol (one JSON object per newline) for Unix socket IPC
- [02-03]: Socket path co-located with database file via getSocketPath(storagePath)
- [02-03]: 5-second client timeout with descriptive error messages
- [02-03]: Stale socket cleanup via unlinkSync before server.listen
- [Phase 02-02]: HEARTBEAT_INTERVAL_MS is a module-level constant (60000), enforcing fixed 60-second interval
- [Phase 02-02]: Backoff uses full jitter formula per AWS recommendation; writeHealthFile uses writeFileSync
- [Phase 02-02]: Bearer token never logged or audited; service enters degraded mode on Axon unreachable
- [02-04]: Provider commands resolve socket path from config with fallback to default ./data/neuron.sock
- [02-04]: IPC handler routing implemented inline in start command via switch on command.type
- [02-04]: Registration service created before IPC server but start() called after IPC is listening
- [02-04]: Commander start action is async for registration lifecycle management
- [03-01]: Ed25519 public key imported via JWK format (kty OKP, crv Ed25519) -- avoids manual DER prefix construction
- [03-01]: Algorithm parameter null for crypto.verify -- Ed25519 uses SHA-512 internally
- [03-01]: Verification order: signature first, then JSON parse, then expiration -- rejects invalid before parsing
- [03-01]: Migration v3 uses DEFAULT empty string for patient_public_key (SQLite ALTER TABLE requirement)
- [03-02]: Challenge nonce TTL is 30 seconds with cleanup on each startHandshake call
- [03-02]: Hard cap of 1000 pending challenges to prevent memory exhaustion
- [03-02]: Terminated status transitions rejected at store level (TERM-04 enforcement)
- [03-02]: Audit event logged on relationship establishment with category 'consent'
- [03-03]: Direct SQL update inside transaction bypasses RelationshipStore.updateStatus to avoid double-validation
- [03-03]: Audit entry logged before mutation to capture sequence number for termination record linkage
- [03-03]: TerminationHandler uses own try/catch in IPC case for clean error messages
- [04-01]: HandshakeSession excludes WebSocket reference -- ws field managed internally by server (Plan 02)
- [04-01]: Messages use typed JSON envelopes with discriminant type field for dispatch
- [04-01]: InboundHandshakeMessage union covers auth and challenge_response (patient-to-Neuron only)
- [04-01]: HandshakeComplete status field distinguishes new vs existing relationships
- [04-02]: ws library in noServer mode attached to node:http server for REST API port sharing
- [04-02]: Safety ceiling queues connections (never rejects) with configurable queue timeout
- [04-02]: Existing active relationships return existing relationship_id without creating duplicate
- [04-02]: Early consent token verification extracts provider_npi before challenge-response (stateless re-verify per CSNT-02)
- [04-02]: Binary frames rejected -- text-only JSON envelopes for handshake protocol
- [04-02]: ConsentError codes mapped to RoutingErrorCode: INVALID_SIGNATURE/CONSENT_EXPIRED -> CONSENT_FAILED, MALFORMED_TOKEN -> INVALID_MESSAGE
- [04-03]: WebSocket server starts after IPC server, before Axon registration in the start command lifecycle
- [04-03]: protocolServer.stop() is first in shutdown pipeline (before registration, IPC, storage)
- [04-03]: CLI tests mock routing module to prevent port conflicts during unit testing
- [04-03]: Integration tests use ephemeral port (0) and real WebSocket connections for end-to-end verification
- [04-04]: provider_npi set to 'unknown' in early consent failure audit because NPI extraction has not yet succeeded
- [04-04]: Audit-before-close pattern applied consistently to all failure paths in handler.ts
- [05-01]: vi.hoisted() required for mock constructor pattern -- vi.mock hoists above const declarations
- [05-01]: DiscoveryConfig is plain interface, assembled at call site from NeuronConfig fields
- [05-01]: Service instance name neuron-{NPI} for multi-Neuron LAN uniqueness
- [05-01]: TXT record keys npi/ver/ep all <=9 chars per RFC 6763 Section 6.4
- [05-02]: Discovery stops first in shutdown pipeline -- goodbye packets before WebSocket close
- [05-02]: getLocalAddress() resolves first non-internal IPv4 when server binds to 0.0.0.0
- [05-02]: neuron discover is one-shot mode with configurable timeout (default 3s)
- [05-02]: DISC-04 satisfied by design -- local connections use same WebSocket endpoint and consent handler
- [06-01]: API keys use `nrn_` prefix (modeled after Stripe's sk_/pk_ convention) for easy identification
- [06-01]: Raw keys shown once at creation, only SHA-256 hash stored -- prevents exposure from database breach
- [06-01]: Timing-safe comparison via crypto.timingSafeEqual on Buffer.from(hash, 'hex') to prevent timing attacks
- [06-01]: Token bucket refills proportionally based on elapsed time (not fixed intervals)
- [06-02]: Router ignores non-API paths (not /v1/* and not /openapi.json) to avoid WebSocket conflicts
- [06-02]: CORS headers set before auth/error so preflight OPTIONS always works without API key
- [06-02]: OpenAPI spec at /openapi.json is public (no auth required)
- [06-02]: ApiRouterDeps includes storage: StorageEngine because RelationshipStore lacks findAll
- [06-03]: API key CLI commands use direct SQLite access (offline) -- no running Neuron required
- [06-03]: REST router attached via httpServer.on('request') after protocolServer.start() completes
- [06-03]: Rate limiter configured with refill = maxRequests (full refill each window)

### Pending Todos

None yet.

### Blockers/Concerns

- ~~Ed25519 key format must be defined canonically before Phase 3 implementation~~ RESOLVED: base64url-encoded raw 32-byte keys, imported via JWK format (03-01)
- Axon registry API does not exist yet; Phase 2 mock must be built from Axon PRD contract
- ~~ProtocolServer interface shape from provider-core needs validation before Phase 4~~ RESOLVED: ProtocolServer/ProtocolSession interfaces defined in src/routing/types.ts (04-01)

## Session Continuity

Last session: 2026-02-22
Stopped at: Patient Chart Sync removed, ready for Phase 7 (Integration and Documentation)
Resume file: N/A
