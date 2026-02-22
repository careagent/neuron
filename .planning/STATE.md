# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Phase 8: Foundation Tech Debt

## Current Position

Phase: 8 of 8 (Foundation Tech Debt)
Plan: Not started
Status: Ready to plan
Last activity: 2026-02-22 -- Phase 7 complete: 3/3 plans, 17 E2E tests, 3 documentation files, all SC verified

Progress: [██████████████████████████] 23/23 plans (100% of planned so far)

## Performance Metrics

**Velocity:**
- Total plans completed: 19
- Average duration: 3.0min
- Total execution time: 0.95 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02-axon-registration | 4 | 12min | 3min |
| 03-consent-and-relationships | 3 | 7min | 2.3min |
| 04-websocket-routing | 4 | 10min | 2.5min |
| 05-local-discovery | 2 | 8min | 4min |
| 06-rest-api | 3 | 18min | 6min |
| 07-integration-and-documentation | 3 | 8min | 2.7min |

**Recent Trend:**
- Last 5 plans: 06-03 (6min), 07-01 (3min), 07-03 (3min), 07-02 (2min)
- Trend: Accelerating (harness reuse speeds up)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [07-01]: NeuronTestHarness composes all subsystems in start.ts order without CLI child process
- [07-01]: WebSocket helpers are standalone functions (not class methods) for flexible reuse across E2E suites
- [07-01]: beforeAll/afterAll lifecycle for expensive harness creation (not beforeEach)
- [07-02]: mDNS discovery test uses real bonjour-service browser, not mocks
- [07-02]: Rate limit test creates fresh API key per test to avoid interference
- [07-03]: Documentation extracted from actual source code, not written from memory
- [07-03]: AI-agent optimized formatting: consistent heading hierarchy, tables, Mermaid diagrams

### Pending Todos

None.

### Blockers/Concerns

- ~~Ed25519 key format must be defined canonically before Phase 3 implementation~~ RESOLVED: base64url-encoded raw 32-byte keys, imported via JWK format (03-01)
- Axon registry API does not exist yet; Phase 2 mock must be built from Axon PRD contract
- ~~ProtocolServer interface shape from provider-core needs validation before Phase 4~~ RESOLVED: ProtocolServer/ProtocolSession interfaces defined in src/routing/types.ts (04-01)

## Session Continuity

Last session: 2026-02-22
Stopped at: Phase 7 complete, ready to plan Phase 8 (Foundation Tech Debt)
Resume file: N/A
