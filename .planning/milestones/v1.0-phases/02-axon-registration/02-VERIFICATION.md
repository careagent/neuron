---
phase: 02-axon-registration
verified: 2026-02-21T21:06:30Z
status: passed
score: 11/11 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "neuron start registers with mock Axon and reports registered state"
    expected: "Output shows 'Registered with Axon (ID: <uuid>)' and Axon registry contains the neuron"
    why_human: "End-to-end CLI run against live mock Axon server requires human to start processes and observe stdout"
  - test: "neuron status shows full registration and heartbeat state"
    expected: "Displays organization name, NPI, registration status, heartbeat, and provider table"
    why_human: "Real IPC round-trip across two terminal sessions; IPC server must be running"
  - test: "neuron provider add <npi> immediately registers with Axon without restart"
    expected: "Provider appears in neuron status and Axon's GET /v1/neurons/:id immediately after"
    why_human: "Hot-add path requires live running Neuron daemon and live mock Axon"
  - test: "neuron provider remove <npi> prompts for y/N confirmation before unregistering"
    expected: "readline prompt appears; entering 'N' cancels; entering 'y' removes provider"
    why_human: "Interactive readline cannot be driven programmatically without a real TTY"
  - test: "After Ctrl+C, restart of neuron start restores registration without re-registering with Axon"
    expected: "Second start logs no 'Registered with Axon' (idempotency); existing registration_id retained"
    why_human: "Requires two process runs against a real on-disk database; can't replicate in unit tests"
  - test: "neuron.health.json written to data directory on startup and updated on each heartbeat"
    expected: "File exists at ./data/neuron.health.json with valid JSON containing status and timestamps"
    why_human: "Requires real file system with live heartbeat loop running"
---

# Phase 2: Axon Registration Verification Report

**Phase Goal:** The Neuron registers itself and its providers with the Axon network directory and maintains reachable status through heartbeats
**Verified:** 2026-02-21T21:06:30Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | A Neuron initialized from config has registration tables Plans 02-02 and 02-03 can read/write without schema errors | VERIFIED | Migration v2 in `migrations.ts` lines 102-129 creates `neuron_registration` (CHECK id=1) and `provider_registrations`; all 11 SQLite tests pass |
| 2  | Plans 02-02 and 02-04 can read `axon.registryUrl`, `axon.endpointUrl`, `axon.backoffCeilingMs` from NeuronConfig without type errors | VERIFIED | `NeuronConfigSchema` in `config.ts` lines 28-32 defines the axon section; `defaults.ts` includes matching defaults; build passes with zero type errors |
| 3  | Registration and heartbeat tests can start a standalone mock Axon server and exercise the full Axon API contract | VERIFIED | `test/mock-axon/server.ts` exports `createMockAxonServer(port)` implementing all 5 routes; `start.ts` is a runnable entry point with ready signal |
| 4  | AxonClient can register a neuron with the Axon registry and receive a registration_id and bearer_token | VERIFIED | `axon-client.ts` lines 61-73: `registerNeuron()` POSTs to `/v1/neurons`, throws `AxonError` on non-ok; MSW tests confirm return shape |
| 5  | AxonClient can register and remove providers through the neuron's registration | VERIFIED | `registerProvider()` lines 104-122 and `removeProvider()` lines 129-142; both tested with MSW |
| 6  | HeartbeatManager sends periodic endpoint updates and enters exponential backoff on failure | VERIFIED | `heartbeat.ts` exports `HEARTBEAT_INTERVAL_MS = 60_000`; `beat()` calls `client.updateEndpoint`; catch branch increments `attempt` and calculates `Math.min(ceiling, Math.pow(2, attempt) * 5000 * Math.random())`; 5 unit tests with `vi.useFakeTimers` confirm behavior |
| 7  | HeartbeatManager resets to healthy interval after Axon recovers | VERIFIED | `heartbeat.ts` lines 95-107: `wasDegrade` check resets `attempt = 0` and calls `onStatusChange?.('healthy')` on success; test "resets attempt on success after failure" confirms |
| 8  | Registration state persists in SQLite and survives process restart | VERIFIED | `RegistrationStateStore` (state.ts) uses `INSERT OR REPLACE` with `id=1`; `AxonRegistrationService.start()` checks existing state and skips registration if `status === 'registered'` (idempotency test passes) |
| 9  | When Axon is unreachable, the Neuron continues operating in degraded mode | VERIFIED | `service.ts` lines 99-113: catch block saves `status: 'unregistered'`, calls `writeHealthFile(dataDir, 'degraded')` and returns without throwing; test "handles Axon unreachable on first start gracefully" confirms |
| 10 | A machine-readable neuron.health.json is written on every heartbeat status change for external monitoring | VERIFIED | `writeHealthFile()` in `heartbeat.ts` lines 24-38 writes `{ status, last_heartbeat_at, updated_at }` to `dataDir/neuron.health.json`; 3 dedicated unit tests confirm file contents and valid JSON |
| 11 | IPC server listens on a Unix domain socket and handles JSON commands; IPC client connects and receives responses | VERIFIED | `server.ts` uses `net.createServer` + NDJSON protocol; `client.ts` uses `net.createConnection` with 5s timeout and ENOENT/ECONNREFUSED mapping; 7 IPC unit tests pass including round-trip, invalid JSON, and sequential commands |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/registration.ts` | TypeBox schemas for NeuronRegistrationState and ProviderRegistration | VERIFIED | Exports `NeuronRegistrationStateSchema`, `NeuronRegistrationStatus`, `ProviderRegistrationSchema`, `ProviderRegistrationStatus` and Static types; imports `NpiString`, `IsoDateString` from `./common.js` |
| `src/storage/migrations.ts` | Migration v2 with neuron_registration and provider_registrations tables | VERIFIED | Version 2 entry at line 102; creates both tables with correct schema including `CHECK (id = 1)` constraint |
| `test/mock-axon/server.ts` | Standalone mock Axon HTTP server | VERIFIED | `createMockAxonServer(port)` exported; implements POST /v1/neurons, PUT endpoint, POST/DELETE providers, GET neuron; fresh in-memory state per run |
| `test/mock-axon/start.ts` | Entry point to launch mock Axon as child process | VERIFIED | Parses `--port`, calls `createMockAxonServer`, prints `mock-axon ready on port ${port}` on listening, handles SIGINT/SIGTERM |
| `src/registration/axon-client.ts` | Thin HTTP wrapper for Axon registry API | VERIFIED | Exports `AxonClient` and `AxonError`; all 4 methods (registerNeuron, updateEndpoint, registerProvider, removeProvider) implemented with typed error handling |
| `src/registration/state.ts` | SQLite read/write for registration state | VERIFIED | Exports `RegistrationStateStore` with load, save, updateHeartbeat, updateStatus, saveProvider, removeProvider, listProviders; uses StorageEngine interface via parameterized queries |
| `src/registration/heartbeat.ts` | Heartbeat loop with exponential backoff and health metric file writer | VERIFIED | Exports `HeartbeatManager`, `HEARTBEAT_INTERVAL_MS`, `writeHealthFile`; setTimeout-based scheduling; full jitter backoff formula |
| `src/registration/service.ts` | Orchestrator coordinating client, state, and heartbeat | VERIFIED | Exports `AxonRegistrationService`; `start()` handles first-boot vs restart; `addProvider`, `removeProvider`, `listProviders`, `getStatus`, `stop()` all implemented |
| `src/registration/registration.test.ts` | Unit tests for all registration components | VERIFIED | 26 tests: AxonClient (6), RegistrationStateStore (7), HeartbeatManager (5), writeHealthFile (3), AxonRegistrationService (5); all pass |
| `src/ipc/protocol.ts` | TypeBox schemas for IPC command/response protocol | VERIFIED | Exports `IpcCommandSchema` (4 command literals), `IpcResponseSchema`, and Static types |
| `src/ipc/server.ts` | Unix domain socket server for CLI-to-daemon communication | VERIFIED | Exports `startIpcServer`, `IpcHandler`, `getSocketPath`; stale socket cleanup via `unlinkSync`; NDJSON protocol |
| `src/ipc/client.ts` | Unix domain socket client for CLI commands | VERIFIED | Exports `sendIpcCommand`; 5s timeout; ENOENT and ECONNREFUSED mapped to user-friendly errors |
| `src/ipc/ipc.test.ts` | Unit tests for IPC server and client | VERIFIED | 7 tests covering round-trip, client errors, invalid JSON, sequential commands, getSocketPath derivation |
| `src/cli/commands/provider.ts` | neuron provider add/remove/list CLI commands | VERIFIED | Exports `registerProviderCommand`; validates NPI, sends IPC commands, handles errors; `remove` has interactive readline confirmation |
| `src/cli/commands/start.ts` | Enhanced start command with registration, IPC, and heartbeat | VERIFIED | Starts IPC server (step 5), creates and starts `AxonRegistrationService` (step 6); graceful shutdown pipeline: heartbeat stop, IPC close, socket cleanup, storage close |
| `src/cli/commands/status.ts` | Enhanced status command showing registration and heartbeat state | VERIFIED | Real implementation (not stub); sends `{ type: 'status' }` IPC command; displays org name, NPI, registration status, heartbeat, providers table |
| `src/cli/index.ts` | Updated CLI with provider command registered | VERIFIED | Line 20: `registerProviderCommand(program)` called after all other commands |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/types/registration.ts` | `src/types/common.ts` | imports NpiString, IsoDateString | WIRED | Line 2: `import { NpiString, IsoDateString } from './common.js'` — both used in schema definitions |
| `src/storage/migrations.ts` | Registration schema fields | Migration v2 SQL matches TypeBox schema | WIRED | Migration v2 columns (organization_npi, registration_id, axon_bearer_token, status, etc.) match all fields in `NeuronRegistrationStateSchema` |
| `src/registration/axon-client.ts` | Axon registry HTTP API | node:fetch calls to /v1/neurons endpoints | WIRED | Line 62: `fetch(\`${this.registryUrl}/v1/neurons\`)`; lines 84, 109, 132 for other endpoints |
| `src/registration/state.ts` | `src/storage/interface.ts` | StorageEngine SQL operations | WIRED | Constructor takes `StorageEngine`; uses `storage.get`, `storage.run`, `storage.all` with parameterized queries throughout |
| `src/registration/heartbeat.ts` | `src/registration/axon-client.ts` | calls client.updateEndpoint on each beat | WIRED | Line 90: `await this.client.updateEndpoint(state.registration_id, {...})` inside `beat()` |
| `src/registration/service.ts` | `src/registration/axon-client.ts` | delegates HTTP calls | WIRED | Lines 51, 58, 69, 76, 147, 177: `this.client.setBearerToken/registerProvider/registerNeuron/removeProvider` |
| `src/ipc/server.ts` | `node:net` | net.createServer for Unix socket | WIRED | Line 25: `const server = net.createServer(...)` |
| `src/ipc/client.ts` | `node:net` | net.createConnection for socket client | WIRED | Line 25: `const socket = net.createConnection({ path: socketPath }, ...)` |
| `src/ipc/protocol.ts` | `@sinclair/typebox` | TypeBox schemas for message validation | WIRED | Line 1: `import { Type, type Static } from '@sinclair/typebox'`; `Type.Object` used for both schemas |
| `src/cli/commands/provider.ts` | `src/ipc/client.ts` | sendIpcCommand for hot provider management | WIRED | Line 3: import; lines 55, 80, 145: used in add, list, remove actions |
| `src/cli/commands/start.ts` | `src/registration/service.ts` | AxonRegistrationService lifecycle | WIRED | Line 8: import; line 65: `new AxonRegistrationService(config, storage, auditLogger)`; `start()`, `stop()` called |
| `src/cli/commands/start.ts` | `src/ipc/server.ts` | startIpcServer embedded in neuron start | WIRED | Line 7: import; line 105: `const ipcServer = startIpcServer(socketPath, ipcHandler)` |
| `src/cli/commands/status.ts` | `src/ipc/client.ts` | sendIpcCommand for status query | WIRED | Line 2: import; line 45: `sendIpcCommand<StatusData>(socketPath, { type: 'status' })` with response used to render output |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NREG-01 | 02-02, 02-04 | Organization registration with Axon using NPI via AxonRegistry.registerNeuron() | SATISFIED | `AxonClient.registerNeuron()` + `AxonRegistrationService.start()` first-boot path; `neuron start` wires it into CLI lifecycle |
| NREG-02 | 02-02, 02-04 | Provider registration with Axon via AxonRegistry.registerProvider() | SATISFIED | `AxonClient.registerProvider()` + `AxonRegistrationService.addProvider()`; `provider add <npi>` CLI command uses IPC to trigger it on running daemon |
| NREG-03 | 02-02, 02-04 | Periodic heartbeat to maintain reachable status via AxonRegistry.updateEndpoint() | SATISFIED | `HeartbeatManager` with `HEARTBEAT_INTERVAL_MS = 60_000`; calls `client.updateEndpoint()` every 60s; started by `AxonRegistrationService.start()` |
| NREG-04 | 02-03, 02-04 | Dynamic provider management (add/remove/update without restart) via CLI | SATISFIED | IPC Unix socket layer enables hot commands; `neuron provider add/remove/list` all communicate with running Neuron via `sendIpcCommand` |
| NREG-05 | 02-01, 02-04 | Registration state persistence (NeuronRegistrationState) across Neuron restarts | SATISFIED | `RegistrationStateStore` persists to SQLite migration v2 tables; `AxonRegistrationService.start()` loads existing state and skips re-registration if already registered |
| NREG-06 | 02-02, 02-04 | Graceful degradation when Axon is unreachable | SATISFIED | `service.ts` catch block: saves `status: 'unregistered'`, writes health file as degraded, returns without throwing; `neuron start` outputs warning instead of crashing |
| NREG-07 | 02-01 | Mock Axon registry for development and testing | SATISFIED | `test/mock-axon/server.ts` implements all 5 API endpoints; `start.ts` is a runnable process with stdout ready signal for test harness integration |

All 7 requirements accounted for. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No placeholder returns, empty handlers, TODO/FIXME markers, or stub implementations found in any Phase 2 files. The `return null` in `state.ts` line 51 is a legitimate early return when no database row exists. The `=> {}` in `start.ts` line 125 is a keepalive `setInterval` with intentionally empty body.

---

### Human Verification Required

#### 1. End-to-End Startup Registration

**Test:** Start mock Axon (`npx tsx test/mock-axon/start.ts --port 9999`) then run `neuron start` with `axon.registryUrl: "http://localhost:9999"` in config
**Expected:** `neuron start` outputs "Registered with Axon (ID: <uuid>)" and `curl http://localhost:9999/v1/neurons/<id>` returns the neuron record
**Why human:** Requires two live processes; IPC server startup and Axon registration are real network calls across process boundaries

#### 2. Full Status Display

**Test:** With `neuron start` running and Axon mock running, execute `neuron status` in another terminal
**Expected:** Shows organization name, NPI, "Axon Registration: registered", heartbeat "healthy", last heartbeat timestamp, and empty providers table
**Why human:** Real IPC round-trip; display formatting must be visually correct in a terminal

#### 3. Hot Provider Add

**Test:** With `neuron start` running, execute `neuron provider add 1234567893`
**Expected:** Output "Provider 1234567893 registered with Axon"; `neuron provider list` shows the provider; mock Axon GET endpoint shows provider in providers array
**Why human:** Hot-add path requires live daemon; end-to-end cannot be automated without running servers

#### 4. Interactive Provider Remove Confirmation

**Test:** With a provider registered, execute `neuron provider remove 1234567893`
**Expected:** Prompt appears: "Remove provider 1234567893? This will unregister from Axon. (y/N): "; entering "N" shows "Cancelled"; entering "y" removes the provider
**Why human:** `readline` requires a real TTY; the interactive prompt cannot be driven by automated tests

#### 5. Restart Idempotency

**Test:** Run `neuron start` until registered, Ctrl+C, then run `neuron start` again
**Expected:** Second run does NOT call Axon's `POST /v1/neurons`; logs show no "Registered with Axon" message; existing `registration_id` is preserved
**Why human:** Requires two sequential process runs against a real on-disk SQLite database

#### 6. Health File Written

**Test:** Start `neuron start`, then check `./data/neuron.health.json`
**Expected:** File exists immediately after startup; contains `{ "status": "healthy", "last_heartbeat_at": null, "updated_at": "<ISO>" }`; after 60s, `last_heartbeat_at` is populated
**Why human:** Requires live file system access during running daemon; heartbeat timer is real (60s)

---

### Gaps Summary

No gaps. All automated checks passed.

All 7 phase requirements (NREG-01 through NREG-07) are implemented with substantive, wired code. All 110 tests pass. Build produces zero type errors. No stubs, empty handlers, or placeholder implementations detected.

Human verification is flagged for 6 items covering the full end-to-end user-facing experience (live CLI execution, real process communication, interactive TTY behavior) — these are inherently untestable without running processes.

---

_Verified: 2026-02-21T21:06:30Z_
_Verifier: Claude (gsd-verifier)_
