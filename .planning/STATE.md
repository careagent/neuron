# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Phase 3: Consent and Relationships (In Progress)

## Current Position

Phase: 3 of 9 (Consent and Relationships) -- IN PROGRESS
Plan: 2 of 3 in current phase (2 complete)
Status: Executing Phase 3
Last activity: 2026-02-22 -- Completed 03-02-PLAN.md (relationship store and consent handshake)

Progress: [██████░░░░] 46%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 3min
- Total execution time: 0.28 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02-axon-registration | 4 | 12min | 3min |
| 03-consent-and-relationships | 2 | 5min | 2.5min |

**Recent Trend:**
- Last 5 plans: 02-02 (4min), 02-04 (3min), 03-01 (2min), 03-02 (3min)
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

### Pending Todos

None yet.

### Blockers/Concerns

- ~~Ed25519 key format must be defined canonically before Phase 3 implementation~~ RESOLVED: base64url-encoded raw 32-byte keys, imported via JWK format (03-01)
- Axon registry API does not exist yet; Phase 2 mock must be built from Axon PRD contract
- ProtocolServer interface shape from provider-core needs validation before Phase 4

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 03-02-PLAN.md (relationship store and consent handshake)
Resume file: None
