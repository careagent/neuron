# Phase 8: Foundation Tech Debt - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Close tech debt gaps from v1.0 milestone audit: wire `neuron stop` to send IPC shutdown signal, add the missing `api_access` audit event producer, and expose `verifyAuditChain()` via a `neuron verify-audit` CLI command. No new capabilities — strictly gap closure on existing infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Stop command IPC wiring
- `neuron stop` sends a `shutdown` IPC command to the running Neuron via Unix domain socket (same pattern as `provider.add`, `status`, etc.)
- Add `shutdown` to `IpcCommandSchema` discriminated union in `src/ipc/protocol.ts`
- IPC handler in `start.ts` receives the `shutdown` command and triggers the existing `shutdown()` function (which already handles graceful teardown: discovery -> protocolServer -> registration -> IPC -> storage)
- Stop command responds `{ ok: true }` before the server begins teardown (so the CLI client gets confirmation)
- If Neuron is not running (ENOENT/ECONNREFUSED), `neuron stop` prints a clear message and exits with code 0 (not an error — idempotent stop)
- No force-kill fallback needed in v1 — the shutdown function already handles all subsystem teardown

### Audit event coverage
- Add `api_access` audit events at the natural trigger point: the REST API authentication middleware in `src/api/router.ts`
- Log on successful authenticated request (category: `api_access`, action: `api_request`, details include method, path, key hash prefix)
- Log on authentication failure (category: `api_access`, action: `auth_failure`, details include method, path, reason)
- Log on rate limit exceeded (category: `api_access`, action: `rate_limited`, details include method, path, key hash prefix)
- The `sync` category has no producer because sync was deferred to v2 — this is expected and not a gap
- The `connection` category already has producers in `src/routing/handler.ts` (6 audit calls added in Phase 4) — the milestone audit was run before Phase 4 was complete
- After this phase, 6 of 7 categories have producers; `sync` intentionally deferred to v2

### Verify-audit CLI command
- New `neuron verify-audit` command registered in CLI entry point
- Takes optional `--path <path>` flag to specify audit log file; defaults to `config.audit.path` (resolves from config file)
- Since verify-audit runs as a standalone CLI command (not via IPC to running server), it loads config directly to find the audit path
- Output: prints chain integrity result — entry count, valid/invalid status, error details if any
- Exit code: 0 on valid chain, 1 on integrity failure (useful in CI/scripts)
- Uses existing `verifyAuditChain()` from `src/audit/verifier.ts` — no new verification logic needed

### Claude's Discretion
- Exact audit event detail fields beyond the specified ones
- Whether to add a `neuron_stop` admin audit event before shutdown (reasonable to add for symmetry with `neuron_start`)
- Test structure and organization for the new functionality

</decisions>

<specifics>
## Specific Ideas

- The IPC shutdown pattern should match existing IPC commands exactly (NDJSON over Unix domain socket, same client function)
- The existing `shutdown()` function in `start.ts` already has complete teardown logic (discovery -> protocolServer -> registrationService -> IPC -> storage -> process.exit) — reuse it, don't rewrite
- The stop command in `src/cli/commands/stop.ts` is currently a stub that just prints a message — replace the stub entirely

</specifics>

<deferred>
## Deferred Ideas

- `sync` audit category producer — deferred to v2 when patient chart sync is implemented
- Phase 1 VERIFICATION.md — the milestone audit flagged Phase 1 as unverified, but creating a retroactive verification report is not in Phase 8 scope (Phase 8 closes specific tech debt items only)

</deferred>

---

*Phase: 08-foundation-tech-debt*
*Context gathered: 2026-02-22*
