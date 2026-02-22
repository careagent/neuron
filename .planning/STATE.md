# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Phase 3: Consent and Relationships (Complete)

## Current Position

Phase: 3 of 9 (Consent and Relationships) -- COMPLETE
Plan: 3 of 3 in current phase (3 complete)
Status: Phase 3 Complete
Last activity: 2026-02-22 -- Completed 03-03-PLAN.md (relationship termination and IPC wiring)

Progress: [██████░░░░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 2.7min
- Total execution time: 0.32 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02-axon-registration | 4 | 12min | 3min |
| 03-consent-and-relationships | 3 | 7min | 2.3min |

**Recent Trend:**
- Last 5 plans: 02-04 (3min), 03-01 (2min), 03-02 (3min), 03-03 (2min)
- Trend: Steady

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: SQLite via better-sqlite3 as primary storage engine from day one (research recommendation; query patterns demand indexing)
- [Roadmap]: 9-phase structure following dependency chain: foundation, registration, consent/relationships, routing, discovery, scheduling/billing, REST API, chart sync, integration
- [Roadmap]: Phase 6 (Scheduling/Billing) depends only on Phase 3 (Relationships) but sequenced after Phase 5 for clean build order
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

### Pending Todos

None yet.

### Blockers/Concerns

- ~~Ed25519 key format must be defined canonically before Phase 3 implementation~~ RESOLVED: base64url-encoded raw 32-byte keys, imported via JWK format (03-01)
- Axon registry API does not exist yet; Phase 2 mock must be built from Axon PRD contract
- ProtocolServer interface shape from provider-core needs validation before Phase 4

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 03-03-PLAN.md (relationship termination and IPC wiring) -- Phase 3 complete
Resume file: None
