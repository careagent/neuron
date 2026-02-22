---
phase: 03-consent-and-relationships
plan: 01
subsystem: consent
tags: [ed25519, crypto, consent-token, verification, node-crypto]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: SQLite storage engine, TypeBox schemas, migration runner
provides:
  - Ed25519 consent token verification (verifyConsentToken, importPublicKey)
  - Typed ConsentError with error codes (INVALID_SIGNATURE, CONSENT_EXPIRED, MALFORMED_TOKEN)
  - ConsentToken and ConsentClaims type definitions
  - RelationshipRecord schema with patient_public_key field
  - SQLite migration v3 (patient_public_key column)
affects: [03-consent-and-relationships, 04-routing, consent-handshake]

# Tech tracking
tech-stack:
  added: []
  patterns: [stateless-crypto-verification, ed25519-jwk-import, tdd-consent-verifier]

key-files:
  created:
    - src/consent/verifier.ts
    - src/consent/errors.ts
    - src/consent/token.ts
    - src/consent/index.ts
    - src/consent/consent.test.ts
  modified:
    - src/types/relationship.ts
    - src/storage/migrations.ts
    - src/storage/sqlite.test.ts

key-decisions:
  - "Ed25519 public key imported via JWK format (kty OKP, crv Ed25519) -- avoids manual DER prefix construction"
  - "Algorithm parameter null for crypto.verify -- Ed25519 uses SHA-512 internally"
  - "Verification order: signature first, then JSON parse, then expiration -- rejects invalid signatures before parsing"
  - "Migration v3 uses DEFAULT empty string for patient_public_key -- required by SQLite ALTER TABLE ADD COLUMN"

patterns-established:
  - "ConsentVerifier: stateless pure functions, no cached trust, re-verify on every call (CSNT-02)"
  - "ConsentError: typed error codes for downstream error handling"
  - "Ed25519 JWK import pattern: createPublicKey({ key: { kty: OKP, crv: Ed25519, x: base64url }, format: jwk })"

requirements-completed: [CSNT-01, CSNT-02, CSNT-03, CSNT-04]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 3 Plan 1: Consent Verification Summary

**Ed25519 consent token verification with stateless signature/expiration checking via node:crypto, typed error codes, and RelationshipRecord schema updated with patient_public_key**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T02:31:08Z
- **Completed:** 2026-02-22T02:34:01Z
- **Tasks:** 2 (Task 2 followed TDD RED/GREEN cycle)
- **Files modified:** 8

## Accomplishments
- Ed25519 consent token verification with importPublicKey and verifyConsentToken pure functions
- Typed ConsentError with three error codes: INVALID_SIGNATURE, CONSENT_EXPIRED, MALFORMED_TOKEN
- Stateless verification -- no cached trust between calls (CSNT-02 compliance)
- Consent scope (consented_actions) extracted without interpretation (CSNT-04 compliance)
- RelationshipRecord schema updated with patient_public_key field
- SQLite migration v3 adds patient_public_key column to relationships table
- 9 TDD consent tests covering valid, expired, tampered, malformed, and cross-key scenarios
- All 119 project tests pass including existing Phase 1 and Phase 2 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Update RelationshipRecord schema and add SQLite migration v3** - `70fa399` (feat)
2. **Task 2 RED: Add failing tests for consent token verification** - `46d0fe1` (test)
3. **Task 2 GREEN: Implement Ed25519 consent token verification** - `9252275` (feat)

_TDD task had RED (failing tests) and GREEN (implementation) commits. No REFACTOR needed -- code was already minimal._

## Files Created/Modified
- `src/consent/verifier.ts` - Ed25519 consent token verification (importPublicKey, verifyConsentToken)
- `src/consent/errors.ts` - ConsentErrorCode type union and ConsentError class
- `src/consent/token.ts` - ConsentToken and ConsentClaims interface definitions
- `src/consent/index.ts` - Public barrel exports for consent module
- `src/consent/consent.test.ts` - 9 test cases for consent verification
- `src/types/relationship.ts` - Added patient_public_key to RelationshipRecordSchema
- `src/storage/migrations.ts` - Added migration v3 (patient_public_key column)
- `src/storage/sqlite.test.ts` - Updated expected migration version from 2 to 3

## Decisions Made
- Ed25519 public key imported via JWK format (`{ kty: 'OKP', crv: 'Ed25519', x: base64url }`) -- cleaner than manual DER prefix construction
- Algorithm parameter `null` for `crypto.verify` -- Ed25519 uses SHA-512 internally, does not accept external algorithm
- Verification order: signature first, then JSON parse, then expiration check -- rejects tampered tokens before doing any parsing work
- Migration v3 uses `DEFAULT ''` for patient_public_key -- required by SQLite ALTER TABLE ADD COLUMN for existing rows; safe because no relationship records exist yet

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated sqlite test expected migration version**
- **Found during:** Task 1 (schema and migration updates)
- **Issue:** sqlite.test.ts expected `MAX(version)` to be 2; adding migration v3 makes it 3
- **Fix:** Updated the assertion from `toBe(2)` to `toBe(3)`
- **Files modified:** src/storage/sqlite.test.ts
- **Verification:** `npx vitest run src/storage/sqlite.test.ts` passes (11 tests)
- **Committed in:** 70fa399 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary correction to keep existing test passing after adding migration v3. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ConsentVerifier module ready for use by consent handshake handler (Plan 02)
- RelationshipRecord schema ready for RelationshipStore CRUD (Plan 02)
- Migration v3 ready for patient_public_key storage
- All 119 tests passing -- safe to proceed to Plan 02 (RelationshipStore and handshake)

## Self-Check: PASSED

All 8 created/modified files verified present on disk. All 3 task commits (70fa399, 46d0fe1, 9252275) verified in git log.

---
*Phase: 03-consent-and-relationships*
*Completed: 2026-02-22*
