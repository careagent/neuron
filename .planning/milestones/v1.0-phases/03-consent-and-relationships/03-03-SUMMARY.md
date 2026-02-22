---
phase: 03-consent-and-relationships
plan: 03
subsystem: relationships
tags: [termination, transactional, audit-linkage, ipc, sqlite, provider-initiated]

# Dependency graph
requires:
  - phase: 03-consent-and-relationships
    provides: RelationshipStore with SQLite CRUD, ConsentHandshakeHandler with challenge-response
  - phase: 01-foundation
    provides: SQLite storage engine with transactions, audit logger
provides:
  - TerminationHandler with transactional termination (status + record + audit in one transaction)
  - IPC command relationship.terminate routed to TerminationHandler
  - TerminationRecord persistence with audit_entry_sequence linkage
  - Terminated-is-permanent invariant enforced at handler and store levels
affects: [04-routing, phase-completion]

# Tech tracking
tech-stack:
  added: []
  patterns: [transactional-mutation, audit-sequence-linkage, ipc-command-extension]

key-files:
  created:
    - src/relationships/termination.ts
    - src/relationships/termination.test.ts
  modified:
    - src/relationships/index.ts
    - src/ipc/protocol.ts
    - src/cli/commands/start.ts

key-decisions:
  - "Direct SQL update inside transaction bypasses RelationshipStore.updateStatus to avoid double-validation"
  - "Audit entry logged before mutation to capture sequence number for termination record linkage"
  - "TerminationHandler catches errors in IPC case separately from outer try/catch for clean error messages"

patterns-established:
  - "Transactional mutation: validate -> audit -> mutate -> record, all in storage.transaction()"
  - "Audit sequence linkage: termination_records.audit_entry_sequence references audit log entry"
  - "IPC command extension: add TypeBox union member + switch case + service instantiation in start command"

requirements-completed: [TERM-01, TERM-02, TERM-03, TERM-04]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 3 Plan 3: Relationship Termination and IPC Wiring Summary

**TerminationHandler with transactional atomicity (status + record + audit in one SQLite transaction) and IPC routing via relationship.terminate command**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T02:41:42Z
- **Completed:** 2026-02-22T02:44:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- TerminationHandler terminates relationships atomically: status update, termination record, and audit entry all in one transaction
- Provider NPI validation prevents unauthorized termination; terminated status is permanent and enforced at handler and store levels
- TerminationRecord persisted with audit_entry_sequence for audit trail linkage (TERM-03)
- IPC protocol extended with relationship.terminate command, wired through start command to TerminationHandler
- 7 new tests covering successful termination, already-terminated rejection, NPI mismatch, not-found, atomicity, store-level enforcement, and new handshake after termination
- All 140 project tests pass (133 existing + 7 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: TerminationHandler with transactional safety and audit linkage** - `4b9bff5` (feat)
2. **Task 2: IPC protocol extension and start command wiring for relationship.terminate** - `0a66fea` (feat)

## Files Created/Modified
- `src/relationships/termination.ts` - TerminationHandler with transactional terminate method
- `src/relationships/termination.test.ts` - 7 tests for termination handler behavior
- `src/relationships/index.ts` - Added TerminationHandler re-export
- `src/ipc/protocol.ts` - Added relationship.terminate to IPC command schema union
- `src/cli/commands/start.ts` - Instantiates RelationshipStore/TerminationHandler, routes IPC command

## Decisions Made
- Direct SQL update inside transaction bypasses RelationshipStore.updateStatus to avoid double-validation inside the same transaction where the handler already validated status
- Audit entry logged before mutation to capture the sequence number, which is then stored in the termination record for audit trail linkage
- TerminationHandler uses its own try/catch in the IPC case to return clean error messages rather than falling through to the outer catch which wraps with String(err)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (Consent and Relationships) is now complete: all 3 plans executed
- Consent token verification, relationship store, handshake handler, and termination handler all operational
- Ready for Phase 4 (Routing) which depends on relationship queries and status checks
- All 140 tests passing -- full regression safety for future phases

## Self-Check: PASSED

All 5 created/modified files verified present on disk. All 2 task commits (4b9bff5, 0a66fea) verified in git log.

---
*Phase: 03-consent-and-relationships*
*Completed: 2026-02-22*
