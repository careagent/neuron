---
phase: 02-axon-registration
plan: 02
subsystem: registration, http-client, heartbeat
tags: [axon, registration, heartbeat, exponential-backoff, msw, sqlite, health-check]

# Dependency graph
requires:
  - phase: 02-axon-registration
    provides: Registration TypeBox schemas, NeuronConfig axon section, SQLite migration v2 with registration tables, mock Axon server
provides:
  - AxonClient HTTP wrapper for all 4 Axon API operations (registerNeuron, updateEndpoint, registerProvider, removeProvider)
  - RegistrationStateStore CRUD for neuron_registration and provider_registrations via StorageEngine
  - HeartbeatManager with 60s fixed interval, exponential backoff with full jitter, and health status transitions
  - writeHealthFile producing machine-readable neuron.health.json for external monitoring
  - AxonRegistrationService orchestrating client, state, and heartbeat with restart idempotency and graceful degradation
affects: [02-axon-registration, 03-consent-relationships, 07-rest-api]

# Tech tracking
tech-stack:
  added: [msw]
  patterns: [heartbeat-with-backoff, health-file-writer, registration-service-orchestrator, thin-http-client]

key-files:
  created:
    - src/registration/axon-client.ts
    - src/registration/state.ts
    - src/registration/heartbeat.ts
    - src/registration/service.ts
    - src/registration/index.ts
    - src/registration/registration.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "HEARTBEAT_INTERVAL_MS is a module-level constant (60000), not a constructor parameter -- enforces locked decision that interval is fixed"
  - "Backoff uses full jitter formula: Math.min(ceiling, Math.pow(2, attempt) * 5000 * Math.random()) per AWS recommendation"
  - "writeHealthFile uses writeFileSync for simplicity -- atomic enough for a small JSON status file"
  - "Bearer token never logged or included in audit entries (per research pitfall 7)"
  - "On first-boot Axon unreachable, service enters degraded mode without crashing (NREG-06)"

patterns-established:
  - "Heartbeat pattern: setTimeout-based scheduling (not setInterval) for dynamic delay adjustment during backoff"
  - "Health file pattern: neuron.health.json written to data directory on every status transition for external monitoring"
  - "Service orchestrator pattern: AxonRegistrationService coordinates client, state store, and heartbeat lifecycle"
  - "Registration idempotency: check existing state on start(), skip registerNeuron if already registered"

requirements-completed: [NREG-01, NREG-02, NREG-03, NREG-06]

# Metrics
duration: 4min
completed: 2026-02-22
---

# Phase 2 Plan 02: Core Registration Engine Summary

**AxonClient HTTP wrapper, RegistrationStateStore with SQLite persistence, HeartbeatManager with 60s interval and exponential backoff, and AxonRegistrationService orchestrator with restart idempotency and graceful degradation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-22T01:52:43Z
- **Completed:** 2026-02-22T01:56:29Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- AxonClient wraps all 4 Axon API operations (registerNeuron, updateEndpoint, registerProvider, removeProvider) with typed AxonError handling
- RegistrationStateStore provides full CRUD for neuron_registration and provider_registrations via StorageEngine interface
- HeartbeatManager maintains reachable status at 60s fixed interval, enters exponential backoff with full jitter on failure, and auto-recovers on Axon return
- writeHealthFile writes machine-readable neuron.health.json to data directory on every status transition for external monitoring systems
- AxonRegistrationService orchestrates the full registration lifecycle: first-boot registration, restart idempotency (skips re-registration), provider management, and graceful degradation when Axon is unreachable
- 26 new unit tests with MSW HTTP mocking and in-memory SQLite, all 101 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: AxonClient HTTP wrapper and RegistrationStateStore** - `261ef54` (feat)
2. **Task 2: HeartbeatManager, AxonRegistrationService, and unit tests** - `daf8adf` (feat)

## Files Created/Modified
- `src/registration/axon-client.ts` - Thin HTTP wrapper for Axon registry API with AxonError, RegisterNeuronPayload/Response types
- `src/registration/state.ts` - SQLite read/write for neuron_registration and provider_registrations via StorageEngine
- `src/registration/heartbeat.ts` - Heartbeat loop with HEARTBEAT_INTERVAL_MS constant, exponential backoff, writeHealthFile helper
- `src/registration/service.ts` - Orchestrator coordinating AxonClient, RegistrationStateStore, and HeartbeatManager
- `src/registration/index.ts` - Barrel exports for all registration module public API
- `src/registration/registration.test.ts` - 26 unit tests covering all registration components
- `package.json` - Added MSW dev dependency
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made
- HEARTBEAT_INTERVAL_MS exported as a module constant (not configurable parameter) to enforce the locked 60-second interval decision
- Backoff formula uses full jitter per AWS recommendation: `Math.min(ceiling, Math.pow(2, attempt) * 5000 * Math.random())`
- writeHealthFile uses synchronous writeFileSync -- sufficient for a small JSON status file, avoids async complexity
- Bearer token is stored in SQLite but never included in audit log entries or console output (pitfall 7 prevention)
- When Axon is unreachable on first start, the service saves unregistered state and returns without crashing (NREG-06 graceful degradation)
- HeartbeatManager uses setTimeout (not setInterval) for dynamic delay adjustment during backoff recovery

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All registration components are importable from `src/registration/index.ts`
- AxonRegistrationService ready to be wired into `neuron start` lifecycle (Plan 02-04)
- IPC provider management (Plan 02-03) can call service.addProvider/removeProvider/listProviders
- neuron.health.json file ready for monitoring integration
- All 101 tests pass including 26 new registration component tests

## Self-Check: PASSED

All created files verified on disk. All commit hashes found in git log.

---
*Phase: 02-axon-registration*
*Completed: 2026-02-22*
