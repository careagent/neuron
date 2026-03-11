---
phase: 02-axon-registration
plan: 03
subsystem: ipc
tags: [unix-socket, ndjson, typebox, node-net, ipc]

# Dependency graph
requires:
  - phase: 02-axon-registration/01
    provides: "TypeBox schemas, config with storage.path and axon section"
provides:
  - "IPC protocol schemas (4 command types: provider.add, provider.remove, provider.list, status)"
  - "Unix domain socket server with NDJSON protocol and handler delegation"
  - "Unix domain socket client with timeout and error handling"
  - "Socket path derivation from storage.path (getSocketPath)"
affects: [02-axon-registration/04, 03-consent-relationships, 07-rest-api]

# Tech tracking
tech-stack:
  added: []
  patterns: [ndjson-over-unix-socket, handler-delegation-pattern, stale-socket-cleanup]

key-files:
  created:
    - src/ipc/protocol.ts
    - src/ipc/server.ts
    - src/ipc/client.ts
    - src/ipc/index.ts
    - src/ipc/ipc.test.ts
  modified: []

key-decisions:
  - "NDJSON protocol (one JSON object per newline) for Unix socket IPC"
  - "Socket path co-located with database file via getSocketPath(storagePath)"
  - "5-second client timeout with descriptive error messages"
  - "Stale socket cleanup via unlinkSync before server.listen"

patterns-established:
  - "IPC handler delegation: startIpcServer accepts a generic handler function, decoupling protocol from business logic"
  - "NDJSON line protocol: buffer chunks, split by newline, parse each complete line"
  - "Descriptive error mapping: ENOENT and ECONNREFUSED mapped to user-friendly messages"

requirements-completed: [NREG-04]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 2 Plan 3: IPC Communication Layer Summary

**Unix domain socket IPC with NDJSON protocol for CLI-to-daemon command routing using node:net**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T01:52:37Z
- **Completed:** 2026-02-22T01:54:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- IPC protocol with TypeBox schemas defining 4 command types (provider.add, provider.remove, provider.list, status) and a unified response shape
- Unix domain socket server that listens on a configurable path, handles NDJSON commands, delegates to a typed handler function, and gracefully handles parse errors and handler exceptions
- Unix domain socket client that connects, sends a command, waits for the response, and handles ENOENT/ECONNREFUSED/timeout with clear error messages
- 7 unit tests covering round-trip communication, error handling, invalid JSON, sequential commands, and socket path derivation

## Task Commits

Each task was committed atomically:

1. **Task 1: IPC protocol schemas and Unix socket server** - `9f5678e` (feat)
2. **Task 2: IPC client and unit tests** - `3d93d28` (feat)

## Files Created/Modified
- `src/ipc/protocol.ts` - TypeBox schemas for IPC command/response protocol
- `src/ipc/server.ts` - Unix domain socket server with NDJSON protocol and stale socket cleanup
- `src/ipc/client.ts` - Unix domain socket client with timeout and error handling
- `src/ipc/index.ts` - Barrel exports for all IPC components
- `src/ipc/ipc.test.ts` - Unit tests for server, client, and socket path derivation

## Decisions Made
- Used NDJSON (newline-delimited JSON) as the IPC wire protocol for simplicity and streaming compatibility
- Socket path derived from storage.path directory (co-locates socket with database, avoids /tmp collisions)
- 5-second client timeout with descriptive error message to prevent CLI hangs when server is not running
- Stale socket files cleaned up with unlinkSync before server.listen to prevent EADDRINUSE after crash

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- IPC server ready to be embedded in `neuron start` command (Plan 02-04)
- IPC client ready to be used by CLI commands for hot provider add/remove
- Handler delegation pattern allows business logic to be plugged in without modifying IPC layer

## Self-Check: PASSED

All 5 created files verified on disk. Both task commits (9f5678e, 3d93d28) verified in git log.

---
*Phase: 02-axon-registration*
*Completed: 2026-02-22*
