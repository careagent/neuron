---
phase: 04-websocket-routing
plan: 01
subsystem: routing
tags: [typebox, websocket, protocol, handshake, config]

# Dependency graph
requires:
  - phase: 03-consent-and-relationships
    provides: Consent token format and relationship store for handshake validation
provides:
  - WebSocket configuration section in NeuronConfig
  - ProtocolServer and ProtocolSession interfaces for server implementation
  - HandshakeSession type for internal session tracking
  - TypeBox schemas for all 5 handshake message types
  - RoutingError class with typed error codes
  - InboundHandshakeMessage union for message dispatch
affects: [04-02-PLAN, 04-03-PLAN, 05-discovery]

# Tech tracking
tech-stack:
  added: []
  patterns: [typed-json-envelopes, discriminant-type-field, typebox-message-schemas]

key-files:
  created:
    - src/routing/types.ts
    - src/routing/messages.ts
    - src/routing/errors.ts
    - src/routing/index.ts
  modified:
    - src/types/config.ts
    - src/config/defaults.ts

key-decisions:
  - "HandshakeSession excludes WebSocket reference -- ws field managed internally by server (Plan 02)"
  - "Messages use typed JSON envelopes with discriminant type field for dispatch"
  - "InboundHandshakeMessage union covers auth and challenge_response (patient-to-Neuron only)"
  - "HandshakeComplete status field distinguishes new vs existing relationships"
  - "Barrel export deferred messages.ts re-export to Task 2 to avoid tsc failure on missing file"

patterns-established:
  - "Typed JSON envelope pattern: all WebSocket messages have a type field for discriminated dispatch"
  - "Message schemas as TypeBox objects with Static type extraction"
  - "RoutingError class with typed error code union for structured error handling"

requirements-completed: [ROUT-01, ROUT-03, ROUT-04, ROUT-06]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 4 Plan 1: Routing Types and Schemas Summary

**WebSocket config section, ProtocolServer/Session interfaces, TypeBox handshake message schemas, and routing error types for the broker-and-step-out handshake protocol**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T14:48:05Z
- **Completed:** 2026-02-22T14:49:42Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Extended NeuronConfig with websocket section (path, maxConcurrentHandshakes, authTimeoutMs, queueTimeoutMs, maxPayloadBytes)
- Defined ProtocolServer, ProtocolSession, and HandshakeSession interfaces for server implementation
- Created 5 TypeBox handshake message schemas with discriminant type fields for dispatch
- Established RoutingError class with 7 typed error codes covering all handshake failure modes

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend NeuronConfig with websocket section and add ProtocolServer types** - `e9e5bca` (feat)
2. **Task 2: Define handshake message TypeBox schemas with validation** - `55c54a9` (feat)

## Files Created/Modified
- `src/types/config.ts` - Added websocket section to NeuronConfigSchema with 5 config fields
- `src/config/defaults.ts` - Added matching websocket default values
- `src/routing/types.ts` - ProtocolServer, ProtocolSession, HandshakeSession, HandshakeStatus
- `src/routing/messages.ts` - 5 handshake message TypeBox schemas + InboundHandshakeMessage union
- `src/routing/errors.ts` - RoutingError class with RoutingErrorCode type union
- `src/routing/index.ts` - Barrel exports for routing module

## Decisions Made
- HandshakeSession excludes WebSocket reference and auth timer -- these are managed internally by the server implementation (Plan 02), keeping the exported type free of runtime dependencies
- Messages use typed JSON envelopes with discriminant `type` field (e.g., `handshake.auth`, `handshake.challenge`) for dispatch
- InboundHandshakeMessage union covers only patient-to-Neuron messages (auth and challenge_response)
- HandshakeComplete includes a `status` field (`new` | `existing`) to distinguish fresh relationship creation from existing relationship confirmation
- Barrel export in Task 1 omitted messages re-export (added in Task 2) to avoid tsc failure on nonexistent file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deferred messages barrel export to Task 2**
- **Found during:** Task 1 (barrel export creation)
- **Issue:** Plan specified `export * from './messages.js'` in Task 1's index.ts, but messages.ts is created in Task 2. This would cause tsc --noEmit to fail.
- **Fix:** Created index.ts in Task 1 with only types and errors exports; added messages export in Task 2.
- **Files modified:** src/routing/index.ts
- **Verification:** tsc --noEmit passes after both tasks
- **Committed in:** e9e5bca (Task 1), 55c54a9 (Task 2)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Trivial ordering adjustment. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All routing types, message schemas, and error types are ready for Plan 02 (WebSocket server implementation)
- ProtocolServer interface defines the contract that the handshake server will implement
- Config schema is extended and ready for websocket server initialization
- Blocker resolved: ProtocolServer interface shape validated and defined

## Self-Check: PASSED

All 6 files verified present. Both task commits (e9e5bca, 55c54a9) verified in git log.

---
*Phase: 04-websocket-routing*
*Completed: 2026-02-22*
