---
phase: 04-websocket-routing
plan: 03
subsystem: routing
tags: [websocket, integration-tests, start-command, lifecycle, handshake, audit-events]

# Dependency graph
requires:
  - phase: 04-websocket-routing
    plan: 02
    provides: NeuronProtocolServer, createConnectionHandler, HandshakeSessionManager, safety ceiling
  - phase: 03-consent-and-relationships
    provides: ConsentHandshakeHandler, RelationshipStore, verifyConsentToken, AuditLogger
provides:
  - NeuronProtocolServer wired into neuron start command lifecycle (startup + shutdown)
  - ConsentHandshakeHandler instantiation with auditLogger in start command
  - Comprehensive WebSocket routing integration tests (14 tests)
  - Shutdown pipeline: protocolServer.stop() -> registrationService.stop() -> ipc -> storage
affects: [05-discovery, 07-rest-api]

# Tech tracking
tech-stack:
  added: []
  patterns: [start-command-lifecycle-wiring, integration-test-with-ephemeral-port, routing-module-mock-for-cli-tests]

key-files:
  created:
    - src/routing/routing.test.ts
  modified:
    - src/cli/commands/start.ts
    - src/cli/cli.test.ts

key-decisions:
  - "WebSocket server starts after IPC server, before Axon registration in the start command lifecycle"
  - "protocolServer.stop() is first in shutdown pipeline (before registration, IPC, storage) because it may reference registration service"
  - "CLI tests mock routing module to prevent port conflicts during unit testing"
  - "Integration tests use ephemeral port (0) and real WebSocket connections for end-to-end verification"

patterns-established:
  - "Lifecycle wiring pattern: create handler -> create server -> wire handler -> start server"
  - "Integration test pattern: real server on port 0, ws client, helper functions for connect/receive/close"
  - "Module mock pattern: mock NeuronProtocolServer in CLI tests to isolate from network I/O"

requirements-completed: [ROUT-01, ROUT-02, ROUT-05, ROUT-06]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 4 Plan 3: CLI Wiring and Integration Tests Summary

**NeuronProtocolServer wired into neuron start lifecycle with graceful shutdown ordering, and 14 integration tests proving end-to-end handshake flow via real WebSocket connections**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T14:58:03Z
- **Completed:** 2026-02-22T15:01:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Wired NeuronProtocolServer into the start command with full dependency injection (ConsentHandshakeHandler, RelationshipStore, AuditLogger, connectionHandler)
- Established shutdown ordering: WebSocket server stops first to ensure registration service remains available during connection teardown
- Built 14 integration tests covering full handshake flow, error paths, safety ceiling queuing, graceful shutdown, session tracking, and audit event emission
- All 154 project tests pass (140 existing + 14 new routing integration tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire NeuronProtocolServer into start command with audit events** - `25cbd7d` (feat)
2. **Task 2: Add comprehensive WebSocket routing integration tests** - `63f333f` (test)

## Files Created/Modified
- `src/cli/commands/start.ts` - Added NeuronProtocolServer instantiation, ConsentHandshakeHandler creation, connectionHandler wiring, server startup, and protocolServer.stop() as first shutdown step
- `src/routing/routing.test.ts` - 14 integration tests using real WebSocket connections to NeuronProtocolServer on ephemeral port: full handshake (new + existing), auth timeout, invalid JSON, binary rejection, tampered signature, expired token, safety ceiling queuing, graceful shutdown, wrong path, active sessions, and 3 audit event tests
- `src/cli/cli.test.ts` - Added vi.mock for routing module to prevent real HTTP server creation during CLI unit tests

## Decisions Made
- WebSocket server starts after IPC server but before Axon registration, ensuring all local services are available before external registration
- protocolServer.stop() is the first step in the shutdown pipeline because active WebSocket connections may reference the registration service during teardown
- CLI tests now mock the routing module (NeuronProtocolServer + createConnectionHandler) alongside existing IPC and registration mocks, preventing port conflicts
- Integration tests use port 0 (OS-assigned ephemeral port) for full isolation between test runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added routing module mock to CLI tests**
- **Found during:** Task 1 (start command wiring)
- **Issue:** Adding real NeuronProtocolServer to start command caused CLI tests to attempt HTTP listen on port 3000, producing EADDRINUSE errors
- **Fix:** Added vi.mock for ../routing/index.js in cli.test.ts with stub NeuronProtocolServer that returns resolved promises for start/stop
- **Files modified:** src/cli/cli.test.ts
- **Verification:** All 140 existing tests pass with zero errors
- **Committed in:** 25cbd7d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for test isolation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (WebSocket Routing) is complete: types, messages, errors (Plan 01), server + handler (Plan 02), CLI wiring + integration tests (Plan 03)
- NeuronProtocolServer is fully integrated into the neuron start/stop lifecycle
- HTTP server is exposed for Phase 7 REST API port sharing
- 154 total tests provide comprehensive regression safety net for future phases
- Safety ceiling, session management, and audit logging are production-ready

## Self-Check: PASSED

All 3 created/modified files verified present. Both task commits (25cbd7d, 63f333f) verified in git log. routing.test.ts is 629 lines (min 100 required).

---
*Phase: 04-websocket-routing*
*Completed: 2026-02-22*
