---
status: testing
phase: 01-foundation
source: 01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md
started: 2026-02-22T12:00:00Z
updated: 2026-02-22T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Project builds successfully
expected: |
  Running `pnpm build` completes without errors and produces output files in dist/
awaiting: user response

## Tests

### 1. Project builds successfully
expected: Running `pnpm build` completes without errors and produces output files in dist/
result: [pending]

### 2. Test suite passes
expected: Running `pnpm test` passes all ~140 tests with no failures
result: [pending]

### 3. CLI help output
expected: Running `npx neuron --help` shows commands: init, start, stop, status, provider
result: [pending]

### 4. Init generates config
expected: Running `npx neuron init` in a temp directory creates a `neuron.config.json` file with placeholder values (NPI, org name, etc.)
result: [pending]

### 5. Start with invalid config fails gracefully
expected: Running `npx neuron start` with a bad/missing config shows a clear error message and exits with code 1 (does not crash with stack trace)
result: [pending]

### 6. Start with valid config launches daemon
expected: Running `npx neuron start` with a valid config (valid NPI, paths) starts successfully, creates data directory, creates SQLite database, writes audit log, and stays running with heartbeat. SIGINT/SIGTERM triggers graceful shutdown.
result: [pending]

### 7. NPI validation rejects invalid NPIs
expected: Providing an invalid NPI (e.g., 1234567890) in config causes `neuron start` to fail with a config validation error mentioning NPI
result: [pending]

### 8. Environment variable overrides
expected: Setting `NEURON_ORGANIZATION__NAME=TestOrg` before `neuron start` causes the org name in the loaded config to be "TestOrg" (overriding the file value)
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet]
