---
phase: 05-local-discovery
plan: 02
subsystem: discovery
tags: [mdns, dns-sd, bonjour-service, lifecycle, cli, network-scanning]

# Dependency graph
requires:
  - phase: 05-local-discovery/01
    provides: DiscoveryService class with start/stop lifecycle
  - phase: 04-websocket-routing
    provides: NeuronProtocolServer and createConnectionHandler for same consent flow
provides:
  - DiscoveryService wired into neuron start/stop lifecycle
  - neuron discover CLI command for mDNS network scanning
  - DISC-04 satisfied by design (same WebSocket endpoint, same consent handler)
affects: [09-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [discovery-before-ws-stop shutdown order, getLocalAddress for 0.0.0.0 endpoint resolution]

key-files:
  created:
    - src/cli/commands/discover.ts
  modified:
    - src/cli/commands/start.ts
    - src/cli/index.ts
    - src/cli/cli.test.ts

key-decisions:
  - "Discovery stops first in shutdown pipeline -- goodbye packets sent before WebSocket server closes"
  - "getLocalAddress() resolves first non-internal IPv4 when server binds to 0.0.0.0"
  - "neuron discover is one-shot mode with configurable timeout (default 3s) -- sufficient for debugging"
  - "DISC-04 satisfied by design -- local CareAgents connect to same WebSocket endpoint advertised in TXT ep record"

patterns-established:
  - "Shutdown pipeline order: discovery stop -> WebSocket stop -> registration stop -> IPC close -> storage close"
  - "One-shot mDNS browse pattern with setTimeout cleanup"

requirements-completed: [DISC-03, DISC-04]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 5 Plan 02: Lifecycle Integration and CLI Summary

**DiscoveryService wired into neuron start/stop with mDNS goodbye packets, plus neuron discover CLI for network scanning -- DISC-04 satisfied by design via same consent-verified WebSocket endpoint**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T15:52:00Z
- **Completed:** 2026-02-22T15:55:12Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Wired DiscoveryService into neuron start lifecycle with auto-start when localNetwork.enabled is true
- Discovery stops first in shutdown pipeline, sending goodbye packets before WebSocket server closes
- Created `neuron discover` CLI command with --timeout and --type options for mDNS network scanning
- Updated CLI tests with discovery mock, discover command registration, and discovery-disabled log verification
- All 164 tests pass (1 new CLI test added)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire DiscoveryService into neuron start lifecycle** - `4f139bc` (feat)
2. **Task 2: Create neuron discover CLI command** - `aff96b1` (feat)
3. **Task 3: Update CLI tests for discovery integration** - `ec3d6f7` (test)

## Files Created/Modified
- `src/cli/commands/start.ts` - DiscoveryService lifecycle integration with getLocalAddress helper
- `src/cli/commands/discover.ts` - One-shot mDNS browser with timeout and service type options
- `src/cli/index.ts` - Registered discover command
- `src/cli/cli.test.ts` - Discovery mock, discover command registration test, disabled log test

## Decisions Made
- Discovery stops first in shutdown pipeline -- sends goodbye packets before WebSocket server closes, so LAN browsers learn the service is gone immediately
- `getLocalAddress()` resolves the first non-internal IPv4 address when server binds to 0.0.0.0 -- needed for constructing a usable mDNS endpoint URL
- `neuron discover` uses one-shot mode with configurable timeout (default 3 seconds) -- simpler than continuous mode and sufficient for development/debugging
- DISC-04 is satisfied by design: the TXT `ep` record advertises the same WebSocket endpoint (`ws://host:port/ws/handshake`) that remote connections use, routing through `createConnectionHandler` with full consent verification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 5 (Local Discovery) is fully complete
- All 4 DISC requirements satisfied (DISC-01, DISC-02, DISC-03, DISC-04)
- Ready for phase verification and transition to Phase 6

---
*Phase: 05-local-discovery*
*Completed: 2026-02-22*
