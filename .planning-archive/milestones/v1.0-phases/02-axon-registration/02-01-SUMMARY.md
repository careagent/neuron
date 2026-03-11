---
phase: 02-axon-registration
plan: 01
subsystem: database, types, testing
tags: [typebox, sqlite, migration, mock-server, registration]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: TypeBox schema patterns, SQLite storage engine with migration runner, NeuronConfig schema, defaults system
provides:
  - NeuronRegistrationStateSchema and ProviderRegistrationSchema TypeBox schemas
  - NeuronConfig axon section (registryUrl, endpointUrl, backoffCeilingMs)
  - SQLite migration v2 with neuron_registration and provider_registrations tables
  - Standalone mock Axon HTTP server (test/mock-axon/) with 5 API endpoints
affects: [02-axon-registration, 03-consent-relationships]

# Tech tracking
tech-stack:
  added: []
  patterns: [mock-axon-server, registration-state-schema, single-row-table-pattern]

key-files:
  created:
    - src/types/registration.ts
    - test/mock-axon/server.ts
    - test/mock-axon/start.ts
  modified:
    - src/types/config.ts
    - src/types/index.ts
    - src/config/defaults.ts
    - src/storage/migrations.ts
    - src/storage/sqlite.test.ts

key-decisions:
  - "Single-row enforcement via CHECK(id=1) constraint on neuron_registration table"
  - "Mock Axon uses in-memory Map state, fresh per run for test reliability"
  - "Mock Axon outputs ready signal on stdout for test harness integration"

patterns-established:
  - "Registration table pattern: single-row for org-level state, multi-row for provider-level state"
  - "Mock server pattern: standalone node:http process in test/mock-axon/ with createMockAxonServer factory"

requirements-completed: [NREG-05, NREG-07]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 2 Plan 01: Data Model Foundation and Mock Axon Summary

**Registration TypeBox schemas with config extension, SQLite migration v2 for registration persistence, and standalone mock Axon HTTP server with 5-endpoint API contract**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T01:46:15Z
- **Completed:** 2026-02-22T01:49:33Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- TypeBox schemas for NeuronRegistrationState and ProviderRegistration with full status unions and timestamp tracking
- NeuronConfig extended with axon section providing registryUrl, endpointUrl, and backoffCeilingMs configuration
- SQLite migration v2 creating neuron_registration (single-row enforced via CHECK constraint) and provider_registrations tables
- Standalone mock Axon HTTP server handling register neuron, update endpoint, register/remove provider, and get neuron routes

## Task Commits

Each task was committed atomically:

1. **Task 1: Registration TypeBox schemas, config extension, and SQLite migration v2** - `aeef2a6` (feat)
2. **Task 2: Standalone mock Axon HTTP server** - `4f3b256` (feat)

## Files Created/Modified
- `src/types/registration.ts` - TypeBox schemas for NeuronRegistrationState, ProviderRegistration, and status unions
- `src/types/config.ts` - Extended NeuronConfigSchema with axon section (registryUrl, endpointUrl, backoffCeilingMs)
- `src/types/index.ts` - Barrel exports for all new registration types
- `src/config/defaults.ts` - Added axon defaults (localhost:9999, localhost:3000, 300000ms backoff ceiling)
- `src/storage/migrations.ts` - Migration v2 creating neuron_registration and provider_registrations tables
- `src/storage/sqlite.test.ts` - Updated to expect migration v2 and verify registration tables exist
- `test/mock-axon/server.ts` - Standalone mock Axon HTTP server with 5 endpoints and in-memory state
- `test/mock-axon/start.ts` - Entry point with --port flag, stdout ready signal, and SIGINT/SIGTERM handling

## Decisions Made
- Single-row enforcement on neuron_registration via `id INTEGER PRIMARY KEY CHECK (id = 1)` -- ensures one org per Neuron instance
- Mock Axon uses fresh in-memory Map state per run -- optimizes for test reliability over persistence
- Mock server prints "mock-axon ready on port {port}" to stdout as ready signal for test harness spawning

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated hardcoded migration version assertion in sqlite.test.ts**
- **Found during:** Task 1 (Registration schemas and migration v2)
- **Issue:** Existing test expected `MAX(version)` to be 1, but migration v2 makes it 2
- **Fix:** Updated assertion from `.toBe(1)` to `.toBe(2)` and added checks for neuron_registration and provider_registrations tables
- **Files modified:** src/storage/sqlite.test.ts
- **Verification:** All 68 tests pass
- **Committed in:** aeef2a6 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary correction to existing test that had a hardcoded migration count. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Registration TypeBox schemas are importable from `@careagent/neuron` via barrel export
- NeuronConfig schema includes axon section for Plans 02-02 and 02-04 to read without type errors
- SQLite migration v2 creates registration tables for Plans 02-02 and 02-03 to read/write
- Mock Axon server is ready for integration test spawning in subsequent plans
- All 68 existing tests continue to pass

## Self-Check: PASSED

All created files verified on disk. All commit hashes found in git log.

---
*Phase: 02-axon-registration*
*Completed: 2026-02-22*
