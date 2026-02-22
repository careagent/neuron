---
phase: 04-websocket-routing
plan: 02
subsystem: routing
tags: [websocket, ws, protocol-server, handshake, consent, session-management, safety-ceiling]

# Dependency graph
requires:
  - phase: 04-websocket-routing
    plan: 01
    provides: ProtocolServer/ProtocolSession interfaces, handshake message schemas, routing errors, websocket config
  - phase: 03-consent-and-relationships
    provides: ConsentHandshakeHandler, verifyConsentToken, RelationshipStore, AuditLogger
provides:
  - NeuronProtocolServer implementing ProtocolServer interface with start/stop/activeSessions
  - createConnectionHandler factory for full handshake flow orchestration
  - HandshakeSessionManager for ephemeral in-memory session tracking
  - Safety ceiling with queuing for concurrent handshake connections
  - ws library installed as production dependency
affects: [04-03-PLAN, 05-discovery, 07-rest-api]

# Tech tracking
tech-stack:
  added: [ws@8.19.0, "@types/ws@8.18.1"]
  patterns: [noServer-mode, first-message-auth, safety-ceiling-with-queuing, broker-and-step-out]

key-files:
  created:
    - src/routing/server.ts
    - src/routing/handler.ts
    - src/routing/session.ts
  modified:
    - src/routing/index.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "ws library in noServer mode attached to node:http server for Phase 7 REST API port sharing"
  - "Safety ceiling queues connections (never rejects) with configurable queue timeout"
  - "Existing active relationships return existing relationship_id without creating duplicate"
  - "Early consent token verification extracts provider_npi before challenge-response (stateless re-verify per CSNT-02)"
  - "Binary frames rejected -- text-only JSON envelopes for handshake protocol"
  - "ConsentError codes mapped to RoutingErrorCode: INVALID_SIGNATURE/CONSENT_EXPIRED -> CONSENT_FAILED, MALFORMED_TOKEN -> INVALID_MESSAGE"

patterns-established:
  - "noServer mode pattern: WebSocketServer with manual HTTP upgrade routing by path"
  - "First-message authentication: auth timeout on connect, consent token as first message"
  - "Safety ceiling with queuing: pending upgrades array with per-entry queue timeout"
  - "Session end notification: onSessionEnd callback triggers tryProcessPending for queued connections"
  - "Connection handler factory: createConnectionHandler returns closure with injected dependencies"

requirements-completed: [ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 4 Plan 2: WebSocket Routing Server Summary

**NeuronProtocolServer with ws in noServer mode, consent handshake connection handler, session manager, and safety ceiling queuing for the broker-and-step-out protocol**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T14:52:21Z
- **Completed:** 2026-02-22T14:55:26Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed ws 8.19.0 and created NeuronProtocolServer implementing ProtocolServer interface with start/stop/activeSessions
- Built createConnectionHandler orchestrating the full consent handshake flow: auth timeout, consent verification, existing relationship check, challenge-response, address exchange, disconnect
- Implemented safety ceiling with queuing -- connections are queued (never rejected) when maxConcurrentHandshakes is reached, processed as slots open
- HandshakeSessionManager provides ephemeral in-memory session tracking with create/get/remove/all/clear operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ws and build NeuronProtocolServer with safety ceiling and session tracking** - `844dde1` (feat)
2. **Task 2: Implement WebSocket connection handler for consent handshake flow** - `829944b` (feat)

## Files Created/Modified
- `src/routing/server.ts` - NeuronProtocolServer: ws in noServer mode, path-based upgrade routing, safety ceiling with queuing, graceful shutdown with code 1001, HTTP server exposed for Phase 7
- `src/routing/handler.ts` - createConnectionHandler: auth timeout, handshake.auth validation, early consent token verification, existing relationship check, challenge-response flow, error mapping, audit logging
- `src/routing/session.ts` - HandshakeSessionManager: ephemeral in-memory Map of InternalSession objects with create/get/remove/all/clear
- `src/routing/index.ts` - Updated barrel exports to include session, server, and handler modules
- `package.json` - Added ws as production dependency, @types/ws as dev dependency
- `pnpm-lock.yaml` - Lock file updated with ws dependency tree

## Decisions Made
- ws library used in noServer mode to share the HTTP server with Phase 7 REST API (one port for all traffic)
- Safety ceiling queues connections rather than rejecting them, honoring "no patient CareAgent should ever be turned away" principle. Queue entries timeout after queueTimeoutMs with 503 response.
- Early consent token verification extracts provider_npi for existing relationship lookup before challenge-response. Token is verified again in completeHandshake (stateless, no side effects per CSNT-02).
- Existing active relationships return the existing relationship_id with status 'existing', skipping duplicate relationship creation
- Binary WebSocket frames rejected with INVALID_MESSAGE error -- text-only JSON envelopes for all handshake communication
- ConsentError codes mapped to routing error codes: INVALID_SIGNATURE and CONSENT_EXPIRED map to CONSENT_FAILED, MALFORMED_TOKEN maps to INVALID_MESSAGE
- HTTP server exposed via getter property for Phase 7 reuse; port property exposes listening port for tests using port 0
- onSessionEnd callback pattern connects handler cleanup to server's tryProcessPending for queue promotion

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- NeuronProtocolServer and connection handler are ready for Plan 03 (integration tests)
- All routing types, message schemas, error types from Plan 01 are consumed correctly
- HTTP server is exposed for Phase 7 REST API reuse
- Safety ceiling and session management are ready for production tuning
- ws library is installed and wired into the protocol server lifecycle

## Self-Check: PASSED

All 4 created files verified present. Both task commits (844dde1, 829944b) verified in git log.

---
*Phase: 04-websocket-routing*
*Completed: 2026-02-22*
