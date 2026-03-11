---
phase: 06-rest-api
plan: 03
started: 2026-02-22
completed: 2026-02-22
duration: 6min
---

# Plan 06-03 Summary: API key CLI commands and start command REST wiring

## What was built

CLI commands for API key management and REST API integration into the Neuron startup lifecycle:

- **API key CLI commands** (`src/cli/commands/api-key.ts`): `neuron api-key create --name <name>`, `neuron api-key revoke <key-id>`, `neuron api-key list`. All commands work offline (direct SQLite access, no IPC to running server). Ensures data directory exists before opening database. Follows provider command pattern.
- **Start command REST wiring** (`src/cli/commands/start.ts`): After WebSocket server starts, creates ApiKeyStore, TokenBucketRateLimiter, and REST API router. Attaches router to existing HTTP server via `httpServer.on('request', apiRouter)`. REST and WebSocket coexist on same port (request vs upgrade events).
- **CLI registration** (`src/cli/index.ts`): Registered `api-key` command group alongside existing commands.
- **CLI tests** (`src/cli/cli.test.ts`): 5 new test cases for api-key create/revoke/list (empty and with entries). Added api module mock. Updated routing mock to expose `server` property with `on` method for REST wiring.

## Key decisions

- [06-03]: API key commands use direct SQLite access (offline) -- no running Neuron required, consistent with how keys should be provisioned before server start
- [06-03]: `openStorage()` helper ensures data directory exists before creating SqliteStorage -- api-key commands must work even if `neuron start` has never been run
- [06-03]: REST router attached via `httpServer.on('request', apiRouter)` -- does not conflict with WebSocket upgrade handler (`httpServer.on('upgrade', ...)`)
- [06-03]: Rate limiter configured with refill = maxRequests (full refill each window) for simple behavior
- [06-03]: REST API wiring happens AFTER `protocolServer.start()` because `.server` getter is null before start
- [06-03]: No shutdown changes needed -- REST is stateless, HTTP server shutdown via protocolServer.stop() handles everything

## Test results

5 new tests, all passing. 211 total tests across 14 files.

## Self-Check: PASSED

- [x] `neuron api-key create` generates key and displays raw key once
- [x] `neuron api-key revoke` revokes key by ID
- [x] `neuron api-key list` shows all keys with status
- [x] `neuron start` wires REST API router to HTTP server after WebSocket server starts
- [x] REST endpoints respond on same port as WebSocket connections
- [x] api-key command in help output
- [x] All existing tests still passing

## Artifacts

### key-files
created:
  - src/cli/commands/api-key.ts
modified:
  - src/cli/index.ts
  - src/cli/commands/start.ts
  - src/cli/cli.test.ts
