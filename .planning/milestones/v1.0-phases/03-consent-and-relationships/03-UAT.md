---
status: testing
phase: 03-consent-and-relationships
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md
started: 2026-02-22T12:00:00Z
updated: 2026-02-22T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Consent verification rejects tampered tokens
expected: |
  Tests demonstrate that a consent token with a modified payload is rejected with INVALID_SIGNATURE error (visible in test output via `pnpm test src/consent`)
awaiting: user response

## Tests

### 1. Consent verification rejects tampered tokens
expected: Tests demonstrate that a consent token with a modified payload is rejected with INVALID_SIGNATURE error (visible in test output via `pnpm test src/consent`)
result: [pending]

### 2. Consent verification rejects expired tokens
expected: Tests demonstrate that an expired consent token is rejected with CONSENT_EXPIRED error (visible in test output via `pnpm test src/consent`)
result: [pending]

### 3. Relationship CRUD operations
expected: Tests demonstrate creating, querying by patient/provider/status, and updating relationship status (visible in test output via `pnpm test src/relationships`)
result: [pending]

### 4. Consent handshake flow
expected: Tests demonstrate the full challenge-response handshake: generate challenge, sign with Ed25519 key, verify signature, validate consent token, establish relationship (visible in test output via `pnpm test src/relationships`)
result: [pending]

### 5. Terminated relationships are permanent
expected: Tests demonstrate that attempting to reactivate a terminated relationship throws an error. The terminated-is-permanent invariant is enforced at both store and handler levels (visible in test output).
result: [pending]

### 6. Relationship termination via IPC
expected: The IPC protocol includes a `relationship.terminate` command. Tests demonstrate that termination creates a termination record with audit linkage in a single transaction (visible in test output via `pnpm test src/relationships/termination`)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0

## Gaps

[none yet]
