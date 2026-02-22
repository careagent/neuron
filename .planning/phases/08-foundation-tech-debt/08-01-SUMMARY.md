---
phase: 08-foundation-tech-debt
plan: 01
subsystem: cli, api, ipc, audit
tags: [ipc-shutdown, stop-command, api-access-audit, tech-debt]

requires:
  - phase: 02-ipc-registration
    provides: IPC protocol, sendIpcCommand, getSocketPath
  - phase: 06-rest-api
    provides: createApiRouter, ApiRouterDeps interface
provides:
  - Working `neuron stop` via IPC shutdown command
  - api_access audit events in REST API router (auth_failure, rate_limited, api_request)
  - All 6 non-deferred audit categories now have production producers
affects: [08-foundation-tech-debt]

tech-stack:
  added: []
  patterns: [ipc-shutdown-with-delayed-exit, inline-audit-events]

key-files:
  created: []
  modified:
    - src/ipc/protocol.ts
    - src/cli/commands/stop.ts
    - src/cli/commands/start.ts
    - src/api/router.ts
    - src/cli/cli.test.ts
    - src/api/api-router.test.ts

key-decisions:
  - "Shutdown response flushes before process.exit via setTimeout(() => void shutdown(), 100)"
  - "Stop command exits 0 when server is not running (idempotent)"
  - "api_access audit events placed inline in router pipeline (not middleware)"
  - "auditLogger is optional in ApiRouterDeps (existing tests unaffected)"

patterns-established:
  - "IPC shutdown: respond ok first, then schedule delayed shutdown for socket flush"
  - "Audit events guarded by `if (deps.auditLogger)` for optional audit logging"

requirements-completed: [FOUN-06, AUDT-02]

duration: 4min
completed: 2026-02-22
---

# Plan 08-01: IPC Shutdown + Stop CLI + api_access Audit Events Summary

**Wire `neuron stop` to IPC shutdown and add `api_access` audit events to REST API router**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-22
- **Completed:** 2026-02-22
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `neuron stop` rewritten from stub to full IPC-based command: sends `{ type: 'shutdown' }` via IPC, server responds, logs `neuron_stop` audit event, and triggers graceful shutdown
- Stop command is idempotent: exits 0 with friendly message when server is not running
- REST API router now emits 4 `api_access` audit events: auth_failure (missing key), auth_failure (invalid key), rate_limited, api_request (successful authenticated request)
- All 6 non-deferred audit categories (registration, connection, consent, api_access, admin, termination) now have production producers

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire IPC shutdown command and rewrite stop CLI** - `44883cc` (feat)
2. **Task 2: Add api_access audit events to REST API router** - `2f4f3a7` (feat)

## Files Created/Modified
- `src/ipc/protocol.ts` - Added `shutdown` command type to IpcCommandSchema union
- `src/cli/commands/stop.ts` - Rewritten from stub to IPC-based shutdown command
- `src/cli/commands/start.ts` - Added `case 'shutdown':` IPC handler with audit event + delayed shutdown; added auditLogger to createApiRouter deps
- `src/api/router.ts` - Added `auditLogger?: AuditLogger` to ApiRouterDeps; added 4 audit event trigger points
- `src/cli/cli.test.ts` - Added 3 stop command tests
- `src/api/api-router.test.ts` - Added 4 audit event tests

## Decisions Made
- Shutdown uses `setTimeout(() => void shutdown(), 100)` to ensure IPC response flushes before process exit
- Stop command falls back to `getSocketPath('./data/neuron.db')` if config file cannot be loaded
- Router audit events use `if (deps.auditLogger)` guard since AuditLogger is optional

## Deviations from Plan

None - plan executed as written.

## Issues Encountered
None.

## Next Phase Readiness
- All audit categories covered, closing the AUDT-02 gap
- Stop command operational, closing the FOUN-06 gap

---
*Phase: 08-foundation-tech-debt*
*Completed: 2026-02-22*
