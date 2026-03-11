---
phase: 05-local-discovery
plan: 01
subsystem: discovery
tags: [mdns, dns-sd, bonjour-service, rfc6763, local-network]

# Dependency graph
requires:
  - phase: 04-websocket-routing
    provides: WebSocket server and handshake infrastructure that local connections reuse
provides:
  - DiscoveryService class with mDNS start/stop lifecycle
  - DiscoveryConfig interface for runtime config assembly
  - Extended NeuronConfig localNetwork schema with serviceType and protocolVersion
  - TDD test suite verifying mDNS advertisement behavior
affects: [05-02-lifecycle-integration, 09-integration]

# Tech tracking
tech-stack:
  added: [bonjour-service@1.3.0]
  patterns: [vi.hoisted mock pattern for constructor mocking, DiscoveryConfig assembled at call site from NeuronConfig]

key-files:
  created:
    - src/discovery/service.ts
    - src/discovery/types.ts
    - src/discovery/index.ts
    - src/discovery/discovery.test.ts
  modified:
    - src/types/config.ts
    - src/config/defaults.ts
    - package.json
    - src/cli/cli.test.ts
    - src/routing/routing.test.ts
    - src/registration/registration.test.ts

key-decisions:
  - "Used vi.hoisted() for mock constructor pattern -- vi.mock hoists above const declarations so vi.hoisted() is required"
  - "DiscoveryConfig is a plain interface (not TypeBox) -- assembled at integration point from NeuronConfig fields"
  - "Service instance name format neuron-{NPI} for multi-Neuron LAN uniqueness per research pitfall guidance"
  - "TXT record keys npi/ver/ep all <=9 chars per RFC 6763 Section 6.4"

patterns-established:
  - "vi.hoisted() pattern: declare mock variables in vi.hoisted() callback, reference them in vi.mock factory"
  - "DiscoveryConfig assembly: plain interface populated from NeuronConfig at call site, not coupled to TypeBox schema"

requirements-completed: [DISC-01, DISC-02, DISC-03]

# Metrics
duration: 5min
completed: 2026-02-22
---

# Phase 5 Plan 01: Discovery Service Core Summary

**DiscoveryService with mDNS/DNS-SD advertisement using bonjour-service, TDD-verified with 9 tests covering publish, TXT records, lifecycle, and RFC 6763 compliance**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-22T15:45:44Z
- **Completed:** 2026-02-22T15:51:09Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Installed bonjour-service v1.3.0 and extended NeuronConfig localNetwork schema with serviceType and protocolVersion fields
- Created DiscoveryService class with full start/stop lifecycle managing mDNS advertisement
- TDD test suite with 9 passing tests verifying publish, TXT records, no-op when disabled, NPI-based naming, graceful cleanup, and RFC 6763 key length compliance
- All 163 tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install bonjour-service and extend NeuronConfig** - `627da92` (chore)
2. **Task 2 RED: Add failing tests for DiscoveryService** - `7e85fd6` (test)
3. **Task 2 GREEN: Implement DiscoveryService with mDNS advertisement** - `f4d574f` (feat)

## Files Created/Modified
- `src/discovery/service.ts` - DiscoveryService class with start/stop mDNS lifecycle
- `src/discovery/types.ts` - DiscoveryConfig interface for runtime config
- `src/discovery/index.ts` - Barrel exports for discovery module
- `src/discovery/discovery.test.ts` - 9 TDD tests with vi.hoisted mock pattern
- `src/types/config.ts` - Extended localNetwork with serviceType, protocolVersion
- `src/config/defaults.ts` - Updated defaults for new localNetwork fields
- `package.json` - Added bonjour-service dependency
- `src/cli/cli.test.ts` - Updated test config objects with new localNetwork fields
- `src/routing/routing.test.ts` - Updated test config objects with new localNetwork fields
- `src/registration/registration.test.ts` - Updated test config objects with new localNetwork fields

## Decisions Made
- Used `vi.hoisted()` for mock constructor pattern -- Vitest hoists `vi.mock()` above `const` declarations, so mock variables must be declared in `vi.hoisted()` callback
- DiscoveryConfig is a plain TypeScript interface (not TypeBox) -- assembled at the integration point from NeuronConfig fields, keeping the service decoupled from config schema
- Service instance name uses `neuron-{NPI}` format for multi-Neuron LAN uniqueness per research pitfall guidance
- TXT record keys `npi`/`ver`/`ep` all 9 characters or fewer per RFC 6763 Section 6.4

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest mock hoisting required vi.hoisted() pattern**
- **Found during:** Task 2 GREEN (DiscoveryService implementation)
- **Issue:** Initial mock setup with `vi.fn(function(this) {...})` failed with "Cannot access 'MockBonjour' before initialization" because `vi.mock()` is hoisted above `const` declarations
- **Fix:** Moved all mock variable declarations into `vi.hoisted(() => { ... })` callback, which executes before the hoisted `vi.mock()` factory
- **Files modified:** src/discovery/discovery.test.ts
- **Verification:** All 9 tests pass, all 163 tests pass
- **Committed in:** f4d574f (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Mock pattern adjustment was necessary for Vitest compatibility. No scope creep.

## Issues Encountered
None beyond the mock hoisting deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DiscoveryService is a standalone tested module ready to be wired into the Neuron lifecycle
- Plan 05-02 will integrate start/stop into start.ts and add the `neuron discover` CLI command
- No blockers for Plan 05-02 execution

---
*Phase: 05-local-discovery*
*Completed: 2026-02-22*
