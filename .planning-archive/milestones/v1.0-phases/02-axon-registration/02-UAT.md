---
status: testing
phase: 02-axon-registration
source: 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md
started: 2026-02-22T12:00:00Z
updated: 2026-02-22T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Mock Axon server starts
expected: |
  Running the mock Axon server (e.g., `npx tsx test/mock-axon/start.ts`) starts an HTTP server and prints a "mock-axon ready on port {port}" message to stdout
awaiting: user response

## Tests

### 1. Mock Axon server starts
expected: Running the mock Axon server (e.g., `npx tsx test/mock-axon/start.ts`) starts an HTTP server and prints a "mock-axon ready on port {port}" message to stdout
result: [pending]

### 2. Neuron registers with Axon on startup
expected: With mock Axon running, starting Neuron registers it with Axon. The mock Axon server receives the registration request and returns a bearer token.
result: [pending]

### 3. Heartbeat keeps Neuron reachable
expected: After registration, Neuron sends periodic heartbeats to Axon (visible in mock Axon logs or via neuron status). Status shows "reachable".
result: [pending]

### 4. Provider add via CLI
expected: Running `npx neuron provider add <valid-NPI>` while Neuron is running adds the provider. Running `npx neuron provider list` shows the added provider.
result: [pending]

### 5. Provider remove via CLI
expected: Running `npx neuron provider remove <NPI>` prompts for confirmation (y/N). After confirming, the provider is removed from the list.
result: [pending]

### 6. Neuron status command
expected: Running `npx neuron status` while Neuron is running shows registration state, heartbeat health, Axon connectivity, and provider table.
result: [pending]

### 7. Graceful degradation when Axon unreachable
expected: Starting Neuron without mock Axon running does NOT crash. It enters degraded mode and continues operating. Status shows Axon as unreachable.
result: [pending]

### 8. Restart preserves registration
expected: After registering with Axon, stopping and restarting Neuron restores registration state from SQLite without re-registering with Axon.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet]
