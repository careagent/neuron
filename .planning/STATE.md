# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Phase 2: Axon Registration

## Current Position

Phase: 2 of 9 (Axon Registration)
Plan: 3 of 4 in current phase
Status: Executing Phase 2
Last activity: 2026-02-22 -- Completed 02-03-PLAN.md (IPC communication layer)

Progress: [███░░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 2.5min
- Total execution time: 0.08 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02-axon-registration | 2 | 5min | 2.5min |

**Recent Trend:**
- Last 5 plans: 02-01 (3min), 02-03 (2min)
- Trend: Accelerating

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

### Pending Todos

None yet.

### Blockers/Concerns

- Ed25519 key format must be defined canonically before Phase 3 implementation (cross-repo coordination with patient-core, provider-core)
- Axon registry API does not exist yet; Phase 2 mock must be built from Axon PRD contract
- ProtocolServer interface shape from provider-core needs validation before Phase 4

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 02-03-PLAN.md (IPC communication layer)
Resume file: None
