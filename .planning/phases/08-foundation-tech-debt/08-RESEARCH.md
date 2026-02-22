# Phase 8: Foundation Tech Debt - Research

**Researched:** 2026-02-22
**Phase:** 08-foundation-tech-debt
**Requirements:** FOUN-06, AUDT-02, AUDT-03

## Codebase Analysis

### 1. Stop Command (FOUN-06)

**Current state:** `src/cli/commands/stop.ts` is a 16-line stub that prints "Stop command not yet implemented" and returns.

**IPC infrastructure already exists:**
- `src/ipc/protocol.ts` — TypeBox discriminated union `IpcCommandSchema` with 5 command types
- `src/ipc/client.ts` — `sendIpcCommand()` connects to Unix domain socket, sends NDJSON, returns response
- `src/ipc/server.ts` — `startIpcServer()` receives NDJSON commands, dispatches to handler
- Socket path derived from storage path via `getSocketPath()` (same directory as DB)

**Pattern to follow (from `status.ts`):**
1. Load config to get storage path → derive socket path
2. Call `sendIpcCommand(socketPath, { type: 'shutdown' })`
3. Handle success/failure/not-running

**Changes needed:**
1. Add `Type.Object({ type: Type.Literal('shutdown') })` to `IpcCommandSchema` union
2. Add `case 'shutdown':` to IPC handler in `start.ts` — respond `{ ok: true }`, then trigger `shutdown()`
3. Rewrite `stop.ts` to use IPC client pattern from `status.ts`

**Important detail:** The shutdown function in `start.ts` calls `process.exit(0)`. The IPC handler must send the response before invoking shutdown, otherwise the socket closes before the client receives confirmation. Pattern: `await connection.write(response)` happens in `processLine()` before the handler promise resolves, but `shutdown()` is async and calls `process.exit()`. The handler should use `setTimeout(() => void shutdown(), 50)` or `process.nextTick` to ensure the response flushes first.

### 2. Audit Event Coverage (AUDT-02)

**Schema defines 7 categories** (`src/types/audit.ts`):
- `registration` — 3 producers in `src/registration/service.ts`
- `connection` — 6 producers in `src/routing/handler.ts` (added in Phase 4)
- `consent` — 1 producer in `src/relationships/handshake.ts`
- `api_access` — **NO PRODUCER**
- `sync` — NO PRODUCER (deferred to v2, not a gap)
- `admin` — 1 producer in `src/cli/commands/start.ts` (neuron_start event)
- `termination` — 1 producer in `src/relationships/termination.ts`

**Milestone audit (pre-Phase 4) said `connection` and `api_access` were missing. After Phase 4, only `api_access` is missing.**

**Natural trigger point for `api_access`:** `src/api/router.ts` — the `createApiRouter` function. The router already has the auth check, rate limit check, and route dispatch. Audit events should be added at:
- After successful auth + route dispatch (action: `api_request`)
- After auth failure (action: `auth_failure`)
- After rate limit exceeded (action: `rate_limited`)

**Router dependency injection:** `createApiRouter` takes `ApiRouterDeps` which does NOT currently include `auditLogger`. Need to add it.

**Key hash prefix for audit:** `ApiKeyStore.verify()` returns a `KeyRecord` with `key_id`. Use the key_id (not the full hash) in audit details for identifiability.

### 3. Verify-Audit CLI Command (AUDT-03)

**Existing verifier:** `src/audit/verifier.ts` exports `verifyAuditChain(auditPath: string): VerificationResult` with:
- `valid: boolean`
- `entries: number`
- `errors: Array<{ line: number; error: string }>`

Handles: nonexistent file (valid, 0 entries), empty file (valid, 0 entries), hash mismatches, prev_hash linkage, sequence monotonicity.

**CLI pattern:** New command needs to be registered in `src/cli/index.ts`. Follow the pattern of standalone CLI commands like `api-key.ts` that load config directly (not via IPC).

**Config loading:** The command needs the audit path from config. `loadConfig()` returns `NeuronConfig` with `config.audit.path`. The `--path` flag overrides this.

**CLI entry pattern:** `registerVerifyAuditCommand(program)` added to `src/cli/index.ts`.

### 4. Test Patterns

**Unit tests:** `src/cli/cli.test.ts` uses:
- `vi.mock()` for IPC/registration/routing/api modules
- `Command.exitOverride()` to prevent test process exit
- `vi.spyOn(process, 'exit')` and `vi.spyOn(process.stdout, 'write')` for assertions
- Temp directories with `mkdtempSync`

**IPC tests:** `src/ipc/ipc.test.ts` tests the server/client round-trip directly.

**No E2E test needed for Phase 8** — these are gap closure items with unit test coverage.

## Dependencies

- `src/ipc/protocol.ts` — add shutdown command type
- `src/ipc/index.ts` — re-export (already exports IpcCommand)
- `src/cli/commands/stop.ts` — rewrite from stub
- `src/cli/commands/start.ts` — add shutdown handler + pass auditLogger to router
- `src/api/router.ts` — add auditLogger to deps, add audit events
- New file: `src/cli/commands/verify-audit.ts`
- `src/cli/index.ts` — register verify-audit command

## Risks

- **Shutdown race condition:** IPC response must flush before `process.exit()`. Use `setTimeout` or `process.nextTick` to delay shutdown.
- **Audit logging in hot path:** API requests go through router on every call. Audit append uses `appendFileSync` which is synchronous. For v1 this is acceptable (same pattern as all other audit producers).

## RESEARCH COMPLETE
