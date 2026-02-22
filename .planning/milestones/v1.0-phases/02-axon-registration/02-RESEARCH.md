# Phase 2: Axon Registration - Research

**Researched:** 2026-02-21
**Domain:** HTTP client, IPC daemon communication, exponential backoff, mock server, CLI-to-server coordination
**Confidence:** HIGH (architecture patterns), MEDIUM (specific Axon API shapes), HIGH (tooling)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Mock Axon:** Separate test process, not embedded in the Neuron process
- **Mock Axon:** Happy path only — no failure mode simulation
- **Mock Axon:** Axon is actively being built in parallel; the mock defines what Neuron expects, interface may evolve
- **Provider CLI experience:** `neuron provider add` requires NPI only — minimal input
- **Provider CLI experience:** `neuron provider list` shows a simple table: NPI, registration status, last heartbeat time
- **Provider CLI experience:** `neuron provider remove` always confirms interactively before unregistering from Axon
- **Provider CLI experience:** Provider add/remove takes effect immediately (hot) — CLI contacts running Neuron, which registers/unregisters with Axon right away
- **Heartbeat & resilience:** 60-second heartbeat interval (fixed, not configurable in code, though config already has `heartbeat.intervalMs`)
- **Heartbeat & resilience:** Exponential backoff when Axon unreachable, ceiling configurable (default 5 min) in `neuron.config.json`
- **Heartbeat & resilience:** Degraded state surfaced through: log warnings, `neuron status` command, exposed health metric
- **Heartbeat & resilience:** Auto re-register when Axon comes back after outage — self-healing
- **Registration data model:** Store both Axon-assigned registration ID and organization NPI
- **Registration data model:** Each provider tracks independent registration status (`registered`/`pending`/`failed`)
- **Registration data model:** Full timestamps: `first_registered_at`, `last_heartbeat_at`, `last_axon_response_at`

### Claude's Discretion

- Mock Axon state persistence strategy (fresh vs persistent — optimize for test reliability)
- Endpoint information registered with Axon (WebSocket URL, metadata, capabilities)
- Exact backoff algorithm (exponential base, jitter)
- Health metric format and exposure method

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NREG-01 | Organization registration with Axon using NPI via `AxonRegistry.registerNeuron()` | HTTP client pattern using Node.js `fetch`, registration state stored in SQLite via `StorageEngine` |
| NREG-02 | Provider registration with Axon via `AxonRegistry.registerProvider()` (providers never contact Axon directly) | Same HTTP client; provider state tracked in `provider_registrations` table |
| NREG-03 | Periodic heartbeat to maintain `reachable` status via `AxonRegistry.updateEndpoint()` | `setInterval` heartbeat loop with exponential backoff on failure, integrated into `neuron start` lifecycle |
| NREG-04 | Dynamic provider management (add/remove/update without restart) via CLI | Unix domain socket IPC: `neuron provider add/remove/list` CLI sends JSON command to running server |
| NREG-05 | Registration state persistence (`NeuronRegistrationState`) across Neuron restarts | SQLite migration (Migration v2) storing `neuron_registration` and `provider_registrations` tables |
| NREG-06 | Graceful degradation when Axon is unreachable (established relationships continue operating) | Degraded state flag in-memory + persisted; heartbeat failure enters backoff loop, does NOT halt process |
| NREG-07 | Mock Axon registry for development and testing | Standalone Node.js `http.createServer` process in `test/mock-axon/`; vitest spawns it as a child process for integration tests |
</phase_requirements>

---

## Summary

Phase 2 adds the Axon registration layer on top of Phase 1's foundation. The core challenge is coordinating three distinct concerns: (1) a persistent HTTP client that talks to an external registry and survives network failures, (2) a CLI-to-running-server communication channel so `neuron provider add/remove` can hot-reload without a restart, and (3) a mock Axon process for isolated development and testing.

The project already has the right storage engine (SQLite via `better-sqlite3`, synchronous API), config loading (TypeBox validated, environment override support), audit logging, and CLI scaffolding (Commander). Phase 2 builds directly on all of these. The `NeuronConfig` schema already has `heartbeat.intervalMs` — Phase 2 needs to add an `axon` section to the config schema and extend the storage migrations.

The Axon registry API does not yet exist. This is the central constraint. The mock must define the contract from Neuron's perspective — it is the source of truth for the interface. Treat the mock as a contract implementation that will be validated against the real Axon when it ships.

**Primary recommendation:** Use Node.js built-in `node:net` for Unix domain socket IPC (CLI ↔ running server), Node.js built-in `fetch` (Node 18+; project requires Node >=20.19.0) for HTTP calls to Axon, and Node.js built-in `http.createServer` for the mock Axon. Zero new runtime dependencies required. Use MSW (`msw/node`) for unit-test-level HTTP interception.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fetch` (built-in) | Node 20+ | HTTP calls to Axon registry | No dependency; project requires Node >=20.19.0, `fetch` is stable |
| `node:net` (built-in) | Node 20+ | Unix domain socket IPC between CLI and running server | Faster than TCP loopback (~20-40%), no deps, same OS support as the project |
| `node:http` (built-in) | Node 20+ | Mock Axon server | Consistent with PRD constraint "no Express, no Fastify"; same pattern as Phase 7 REST API |
| `better-sqlite3` | ^12.6.2 (already installed) | Persist registration state | Already in project; synchronous API fits the single-process model |
| `@sinclair/typebox` | ^0.34.48 (already installed) | Schema for registration data model | Already in project; used for all data models |

### Supporting (Dev/Test Only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `msw` | ^2.x | Network-level HTTP interception for unit tests | Unit tests of `AxonClient` that should not spawn a real mock server |
| `commander` | ^14.0.3 (already installed) | `neuron provider add/remove/list` commands | Already installed, all CLI uses it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:fetch` | `axios`, `got`, `undici` | `node:fetch` is sufficient for simple JSON REST calls; `undici` is what powers `fetch` internally and offers more control, but is overkill here |
| `node:net` IPC | Named pipe file / JSON state file polling | Unix socket is bidirectional and synchronous; state file polling is simpler but adds polling delay and race conditions |
| `node:http` mock | MSW `setupServer` as the mock Axon | MSW intercepts the *calling* process's traffic; a separate HTTP server process is what the CONTEXT.md locked decision requires |
| `node:http` mock | `json-server`, `miragejs` | These add runtime dependencies; a 50-line `http.createServer` does everything needed for happy-path mock |

**Installation (dev only addition):**
```bash
pnpm add -D msw
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── registration/
│   ├── index.ts              # Public exports: AxonRegistrationService
│   ├── axon-client.ts        # HTTP wrapper: registerNeuron, updateEndpoint, registerProvider, removeProvider
│   ├── heartbeat.ts          # Heartbeat loop with backoff: start(), stop(), getStatus()
│   ├── provider-manager.ts   # Provider CRUD: add, remove, list (calls axon-client + storage)
│   ├── state.ts              # SQLite read/write for NeuronRegistrationState
│   └── registration.test.ts  # Unit tests (msw for HTTP, ':memory:' SQLite)
├── ipc/
│   ├── server.ts             # Unix socket server (embedded in neuron start)
│   ├── client.ts             # Unix socket client (used by CLI commands)
│   └── protocol.ts           # TypeBox schemas for IPC message types
├── types/
│   └── registration.ts       # NeuronRegistrationState TypeBox schema + static types
├── cli/
│   ├── commands/
│   │   └── provider.ts       # neuron provider add|remove|list
│   └── index.ts              # Register provider command (extend existing)
test/
└── mock-axon/
    ├── server.ts             # Standalone mock Axon HTTP server
    └── start.ts              # Entry point: node test/mock-axon/start.ts --port 9999
```

### Pattern 1: AxonClient — Thin HTTP Wrapper

**What:** A class that wraps `node:fetch` calls to the Axon registry. Stateless — holds only the base URL and bearer token. Throws typed errors on non-2xx responses.

**When to use:** Called by `AxonRegistrationService` for all outbound Axon communication. Never called directly from CLI.

**Example:**
```typescript
// src/registration/axon-client.ts
export class AxonClient {
  constructor(
    private readonly registryUrl: string,
    private bearerToken?: string,
  ) {}

  async registerNeuron(payload: RegisterNeuronPayload): Promise<RegisterNeuronResponse> {
    const res = await fetch(`${this.registryUrl}/v1/neurons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new AxonError(`registerNeuron failed: ${res.status}`, res.status)
    }
    return res.json() as Promise<RegisterNeuronResponse>
  }

  async updateEndpoint(registrationId: string, payload: UpdateEndpointPayload): Promise<void> {
    const res = await fetch(`${this.registryUrl}/v1/neurons/${registrationId}/endpoint`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.bearerToken}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new AxonError(`updateEndpoint failed: ${res.status}`, res.status)
  }

  async registerProvider(registrationId: string, payload: RegisterProviderPayload): Promise<RegisterProviderResponse> {
    const res = await fetch(`${this.registryUrl}/v1/neurons/${registrationId}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.bearerToken}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new AxonError(`registerProvider failed: ${res.status}`, res.status)
    return res.json() as Promise<RegisterProviderResponse>
  }

  async removeProvider(registrationId: string, providerNpi: string): Promise<void> {
    const res = await fetch(`${this.registryUrl}/v1/neurons/${registrationId}/providers/${providerNpi}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    })
    if (!res.ok) throw new AxonError(`removeProvider failed: ${res.status}`, res.status)
  }
}
```

### Pattern 2: Heartbeat with Exponential Backoff

**What:** A stateful heartbeat manager. On success, resets backoff and schedules next heartbeat at `intervalMs`. On failure, enters exponential backoff with full jitter, up to the configurable ceiling. On Axon return, auto re-registers if the registration was lost.

**When to use:** Started inside `neuron start`, stopped on SIGINT/SIGTERM.

**Backoff algorithm (Claude's Discretion recommendation):**
- Base: 5 seconds
- Exponent: 2
- Jitter: full jitter (`Math.random() * delay`)
- Ceiling: configurable `axon.backoffCeilingMs` in config (default: 300,000ms = 5 minutes)
- Formula: `Math.min(ceiling, Math.pow(2, attempt) * baseMs * Math.random())`

**Example:**
```typescript
// src/registration/heartbeat.ts
export class HeartbeatManager {
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private isRunning = false

  constructor(
    private readonly client: AxonClient,
    private readonly stateStore: RegistrationStateStore,
    private readonly intervalMs: number,
    private readonly backoffCeilingMs: number,
    private readonly auditLogger?: AuditLogger,
  ) {}

  start(): void {
    this.isRunning = true
    this.scheduleNext(this.intervalMs)
  }

  stop(): void {
    this.isRunning = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  getStatus(): 'healthy' | 'degraded' {
    return this.attempt === 0 ? 'healthy' : 'degraded'
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => this.beat(), delayMs)
  }

  private async beat(): Promise<void> {
    if (!this.isRunning) return
    const state = this.stateStore.load()
    if (!state || state.status !== 'registered') {
      this.scheduleNext(this.intervalMs)
      return
    }
    try {
      await this.client.updateEndpoint(state.registration_id!, {
        neuron_endpoint_url: state.neuron_endpoint_url,
      })
      this.attempt = 0
      this.stateStore.updateHeartbeat(new Date().toISOString())
      this.scheduleNext(this.intervalMs)
    } catch (err) {
      this.attempt++
      const backoffMs = Math.min(
        this.backoffCeilingMs,
        Math.pow(2, this.attempt) * 5000 * Math.random(),
      )
      // log warning, update status
      this.scheduleNext(backoffMs)
    }
  }
}
```

### Pattern 3: Unix Domain Socket IPC (CLI ↔ Server)

**What:** The running `neuron start` process listens on a Unix socket at a deterministic path (e.g., `<dataDir>/neuron.sock`). CLI commands (`neuron provider add/remove/list`) connect to it, send a JSON command, receive a JSON response, and exit.

**When to use:** Any CLI command that needs to contact the running server without restarting it. Phase 2: provider management.

**Socket path convention:** Derived from config `storage.path` — use `path.join(path.dirname(config.storage.path), 'neuron.sock')`. This ties the socket path to the data directory and avoids hardcoded `/tmp` paths.

**Server side (embedded in `neuron start`):**
```typescript
// src/ipc/server.ts
import net from 'node:net'

export function startIpcServer(socketPath: string, handler: IpcHandler): net.Server {
  // Clean up stale socket on startup
  try { unlinkSync(socketPath) } catch {}

  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      // Simple newline-delimited JSON protocol
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as IpcCommand
          handler(msg).then((result) => {
            socket.write(JSON.stringify(result) + '\n')
          }).catch((err) => {
            socket.write(JSON.stringify({ error: String(err) }) + '\n')
          })
        } catch {
          socket.write(JSON.stringify({ error: 'invalid json' }) + '\n')
        }
      }
    })
    socket.on('error', () => { /* ignore */ })
  })

  server.listen(socketPath)
  return server
}
```

**Client side (in CLI commands):**
```typescript
// src/ipc/client.ts
import net from 'node:net'

export function sendIpcCommand<T>(socketPath: string, command: IpcCommand): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath }, () => {
      socket.write(JSON.stringify(command) + '\n')
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          resolve(JSON.parse(line) as T)
          socket.destroy()
        } catch (e) {
          reject(e)
        }
      }
    })
    socket.on('error', (err) => reject(err))
    socket.setTimeout(5000, () => {
      reject(new Error('IPC command timed out — is the Neuron running?'))
      socket.destroy()
    })
  })
}
```

### Pattern 4: Mock Axon as Standalone HTTP Server

**What:** A Node.js `http.createServer` process in `test/mock-axon/`. It is started as a child process by integration tests, runs in its own process space, and is killed after tests.

**State persistence recommendation (Claude's Discretion):** Fresh state per test run (in-memory `Map` objects). Rationale: test reliability — each integration test run gets a clean slate. The mock is not testing durability; it's testing the protocol.

**Example mock server:**
```typescript
// test/mock-axon/server.ts
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const neurons = new Map<string, { npi: string; endpoint: string; status: string; providers: Map<string, unknown> }>()

export function createMockAxonServer(port: number): http.Server {
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url!, `http://localhost:${port}`)

    // POST /v1/neurons — register neuron
    if (req.method === 'POST' && url.pathname === '/v1/neurons') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const payload = JSON.parse(body)
        const id = randomUUID()
        const token = `mock-token-${id}`
        neurons.set(id, { npi: payload.organization_npi, endpoint: payload.neuron_endpoint_url, status: 'reachable', providers: new Map() })
        res.writeHead(201)
        res.end(JSON.stringify({ registration_id: id, bearer_token: token, status: 'reachable' }))
      })
      return
    }

    // PUT /v1/neurons/:id/endpoint — heartbeat
    const heartbeatMatch = url.pathname.match(/^\/v1\/neurons\/([^/]+)\/endpoint$/)
    if (req.method === 'PUT' && heartbeatMatch) {
      const neuron = neurons.get(heartbeatMatch[1])
      if (!neuron) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
      neuron.status = 'reachable'
      res.writeHead(200)
      res.end(JSON.stringify({ status: 'reachable' }))
      return
    }

    // POST /v1/neurons/:id/providers — register provider
    const providersMatch = url.pathname.match(/^\/v1\/neurons\/([^/]+)\/providers$/)
    if (req.method === 'POST' && providersMatch) {
      const neuron = neurons.get(providersMatch[1])
      if (!neuron) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const payload = JSON.parse(body)
        const providerId = randomUUID()
        neuron.providers.set(payload.provider_npi, { id: providerId, npi: payload.provider_npi })
        res.writeHead(201)
        res.end(JSON.stringify({ provider_id: providerId, status: 'registered' }))
      })
      return
    }

    // DELETE /v1/neurons/:id/providers/:npi — remove provider
    const providerDeleteMatch = url.pathname.match(/^\/v1\/neurons\/([^/]+)\/providers\/([^/]+)$/)
    if (req.method === 'DELETE' && providerDeleteMatch) {
      const neuron = neurons.get(providerDeleteMatch[1])
      if (!neuron) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
      neuron.providers.delete(providerDeleteMatch[2])
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  })
}
```

**Integration test setup:**
```typescript
// test/integration/registration.test.ts
import { spawn, ChildProcess } from 'node:child_process'

let mockAxon: ChildProcess

beforeAll(async () => {
  mockAxon = spawn('node', ['--import', 'tsx/esm', 'test/mock-axon/start.ts', '--port', '19999'], {
    stdio: 'pipe',
  })
  // Wait for ready signal
  await new Promise<void>((resolve) => {
    mockAxon.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('ready')) resolve()
    })
  })
})

afterAll(() => {
  mockAxon.kill()
})
```

### Pattern 5: Registration State in SQLite (Migration v2)

**What:** New migration appended to `src/storage/migrations.ts` adding two tables: `neuron_registration` (one row — the org's registration) and `provider_registrations` (one row per provider NPI).

**Schema:**
```sql
-- Migration v2: Registration tables
CREATE TABLE IF NOT EXISTS neuron_registration (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- enforce single row
  organization_npi TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  organization_type TEXT NOT NULL,
  axon_registry_url TEXT NOT NULL,
  neuron_endpoint_url TEXT NOT NULL,
  registration_id TEXT,                   -- Axon-assigned ID
  axon_bearer_token TEXT,                 -- Received from Axon on registration
  status TEXT NOT NULL DEFAULT 'unregistered',  -- unregistered|pending|registered|suspended
  first_registered_at TEXT,              -- ISO 8601
  last_heartbeat_at TEXT,                -- ISO 8601
  last_axon_response_at TEXT             -- ISO 8601
);

CREATE TABLE IF NOT EXISTS provider_registrations (
  provider_npi TEXT PRIMARY KEY,
  axon_provider_id TEXT,                 -- Axon-assigned provider ID
  registration_status TEXT NOT NULL DEFAULT 'pending',  -- pending|registered|failed
  first_registered_at TEXT,
  last_heartbeat_at TEXT,
  last_axon_response_at TEXT
);
```

### Pattern 6: Config Schema Extension (axon section)

The existing `NeuronConfigSchema` (in `src/types/config.ts`) needs an `axon` section added:

```typescript
// Addition to NeuronConfigSchema
axon: Type.Object({
  registryUrl: Type.String({ default: 'http://localhost:9999' }),
  endpointUrl: Type.String({ default: 'http://localhost:3000' }),
  backoffCeilingMs: Type.Number({ minimum: 1000, default: 300000 }),
}),
```

And defaults in `src/config/defaults.ts`:
```typescript
axon: {
  registryUrl: 'http://localhost:9999',
  endpointUrl: 'http://localhost:3000',
  backoffCeilingMs: 300000,
},
```

### Pattern 7: neuron status Enhancement

The `neuron status` command (currently a stub) should:
1. Try to connect to the IPC socket
2. Send a `{ type: 'status' }` command
3. Display the registration status, Axon connectivity, provider list with statuses
4. If IPC socket not found: print "Neuron is not running"

### Anti-Patterns to Avoid

- **Polling a JSON state file for IPC:** Race conditions when server is writing while CLI is reading. Unix socket is the right tool.
- **Embedding mock Axon in the Neuron process:** The CONTEXT.md locked decision says separate process. Running them in the same process also defeats the purpose of testing network behavior.
- **Using `fs.writeFileSync` to persist registration state:** The project uses SQLite. Adding a separate JSON file for registration state creates two storage systems.
- **Hardcoding `/tmp/neuron.sock`:** Multi-user systems or concurrent test runs would collide. Derive socket path from config's `storage.path` directory.
- **Not handling stale socket file:** On crash, the socket file persists. `neuron start` must `unlinkSync(socketPath)` before calling `server.listen()` (catches `ENOENT` and ignores it).
- **Retrying on 4xx errors:** Only retry on network errors and 5xx responses. `400 Bad Request` from Axon means the payload is wrong — retrying won't help.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP request retry with backoff | Custom retry wrapper | Pattern described above; ~30 lines of TypeScript | Keeping zero net-new runtime deps; the logic is simple enough |
| HTTP mocking in unit tests | Spawning mock server per unit test | `msw/node` with `setupServer` | MSW is process-in-process, no port allocation, no timing issues |
| IPC framing | Binary length-prefix protocol | Newline-delimited JSON (NDJSON) | CLI commands are tiny, latency doesn't matter; NDJSON is trivially parseable |
| Provider NPI validation in CLI | New validator | `isValidNpi()` already exists in `src/validators/npi.ts` | Already built in Phase 1; just import it |
| Audit events for registration | New audit format | Existing `AuditLogger.append()` with `category: 'admin'` | Phase 1 already built the audit logger; use `action: 'registration.neuron_registered'`, `action: 'registration.provider_added'`, etc. |

**Key insight:** This phase adds significant behavior but almost no new infrastructure. Everything hooks into the existing foundation: SQLite storage, TypeBox schemas, Commander CLI, AuditLogger, config loader.

---

## Common Pitfalls

### Pitfall 1: Stale Unix Socket File on Crash
**What goes wrong:** `neuron start` crashes without calling `server.close()`. The socket file remains. Next `neuron start` calls `server.listen(path)` and gets `EADDRINUSE`.
**Why it happens:** `server.close()` unlinks the socket, but crash bypasses it.
**How to avoid:** At the top of IPC server initialization: `try { unlinkSync(socketPath) } catch {}` before `server.listen()`.
**Warning signs:** `EADDRINUSE` errors on start after a crash.

### Pitfall 2: CLI Times Out When Server Not Running
**What goes wrong:** User runs `neuron provider list` without a running server. The IPC client hangs indefinitely.
**Why it happens:** `net.createConnection` to a non-existent socket path throws `ENOENT` immediately, but to a path that has a file but no listener it may hang.
**How to avoid:** Always set a timeout on the IPC client socket (`socket.setTimeout(5000, ...)`). On `ENOENT`, print "Neuron is not running."
**Warning signs:** CLI commands hang indefinitely.

### Pitfall 3: Backoff Not Resetting After Recovery
**What goes wrong:** Axon comes back. Next heartbeat succeeds. But the `attempt` counter is not reset to 0. The next heartbeat is still scheduled with a long delay.
**Why it happens:** Forgetting `this.attempt = 0` on success.
**How to avoid:** Always reset `attempt = 0` on any successful Axon response.
**Warning signs:** Status remains `degraded` after Axon returns; heartbeat interval stays abnormally long.

### Pitfall 4: Race Condition in Provider Add During Heartbeat
**What goes wrong:** Provider add IPC command arrives while heartbeat is in-flight. Both try to write to SQLite simultaneously.
**Why it happens:** Heartbeat and IPC handler are both async; SQLite writes from two async paths can interleave.
**How to avoid:** `better-sqlite3` is synchronous — all writes are blocking. No concurrent write issue. However: the heartbeat should re-read state from SQLite before each `updateEndpoint` call to pick up newly-added providers.
**Warning signs:** Provider added but not reflected in next heartbeat cycle.

### Pitfall 5: Mock Axon Port Collision in Tests
**What goes wrong:** Multiple test files spawn the mock Axon on the same port. The second spawn fails with `EADDRINUSE`.
**Why it happens:** Integration tests run in parallel (Vitest default).
**How to avoid:** Either (a) use a single mock Axon started in a `globalSetup.ts` vitest config, or (b) assign random ports and pass them via environment variable. Recommendation: `globalSetup` — single process for all integration tests.
**Warning signs:** Intermittent `EADDRINUSE` failures in CI.

### Pitfall 6: Registration Idempotency on Restart
**What goes wrong:** Neuron restarts, has `registration_id` and `bearer_token` in SQLite, but calls `registerNeuron()` again, creating a duplicate registration in Axon.
**Why it happens:** `neuron start` always calls registration on boot without checking existing state.
**How to avoid:** In `neuron start`, read registration state from SQLite first. If `status === 'registered'` and `registration_id` exists, skip `registerNeuron()` and proceed directly to heartbeat. Only call `registerNeuron()` if `status === 'unregistered'`.
**Warning signs:** Multiple registrations for same NPI in Axon; Axon returns error on duplicate registration.

### Pitfall 7: Bearer Token Exposure in Logs
**What goes wrong:** Audit log entry or console output includes the `axon_bearer_token`.
**Why it happens:** Logging the full registration state or config object without redacting sensitive fields.
**How to avoid:** In `AxonRegistrationService`, never log or audit the bearer token. Only log `registration_id` and `status`. Redact before any output.
**Warning signs:** Bearer token appears in `data/audit.jsonl` or console output.

---

## Code Examples

### IPC Protocol TypeBox Schema
```typescript
// src/ipc/protocol.ts
import { Type, type Static } from '@sinclair/typebox'

export const IpcCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal('provider.add'), npi: Type.String() }),
  Type.Object({ type: Type.Literal('provider.remove'), npi: Type.String() }),
  Type.Object({ type: Type.Literal('provider.list') }),
  Type.Object({ type: Type.Literal('status') }),
])
export type IpcCommand = Static<typeof IpcCommandSchema>

export const IpcResponseSchema = Type.Object({
  ok: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
})
export type IpcResponse = Static<typeof IpcResponseSchema>
```

### Registration State TypeBox Schema
```typescript
// src/types/registration.ts
import { Type, type Static } from '@sinclair/typebox'
import { NpiString, IsoDateString } from './common.js'

export const ProviderRegistrationStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('registered'),
  Type.Literal('failed'),
])

export const ProviderRegistrationSchema = Type.Object({
  provider_npi: NpiString,
  axon_provider_id: Type.Optional(Type.String()),
  registration_status: ProviderRegistrationStatus,
  first_registered_at: Type.Optional(IsoDateString),
  last_heartbeat_at: Type.Optional(IsoDateString),
  last_axon_response_at: Type.Optional(IsoDateString),
})
export type ProviderRegistration = Static<typeof ProviderRegistrationSchema>

export const NeuronRegistrationStatus = Type.Union([
  Type.Literal('unregistered'),
  Type.Literal('pending'),
  Type.Literal('registered'),
  Type.Literal('suspended'),
])

export const NeuronRegistrationStateSchema = Type.Object({
  organization_npi: NpiString,
  organization_name: Type.String(),
  organization_type: Type.String(),
  axon_registry_url: Type.String(),
  neuron_endpoint_url: Type.String(),
  registration_id: Type.Optional(Type.String()),
  status: NeuronRegistrationStatus,
  first_registered_at: Type.Optional(IsoDateString),
  last_heartbeat_at: Type.Optional(IsoDateString),
  last_axon_response_at: Type.Optional(IsoDateString),
  providers: Type.Array(ProviderRegistrationSchema),
})
export type NeuronRegistrationState = Static<typeof NeuronRegistrationStateSchema>
```

### Vitest Unit Test with MSW
```typescript
// src/registration/registration.test.ts
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { AxonClient } from './axon-client.js'

const server = setupServer(
  http.post('http://mock-axon/v1/neurons', () => {
    return HttpResponse.json({ registration_id: 'test-id', bearer_token: 'test-token', status: 'reachable' }, { status: 201 })
  }),
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('AxonClient', () => {
  it('registerNeuron returns registration ID and token', async () => {
    const client = new AxonClient('http://mock-axon')
    const result = await client.registerNeuron({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      neuron_endpoint_url: 'http://localhost:3000',
    })
    expect(result.registration_id).toBe('test-id')
    expect(result.bearer_token).toBe('test-token')
  })
})
```

### Provider CLI Command
```typescript
// src/cli/commands/provider.ts
import type { Command } from 'commander'
import { sendIpcCommand } from '../../ipc/client.js'
import { isValidNpi } from '../../validators/npi.js'
import { output } from '../output.js'

export function registerProviderCommand(program: Command, socketPath: string): void {
  const provider = program.command('provider').description('Manage providers')

  provider
    .command('add <npi>')
    .description('Register a provider with Axon')
    .action(async (npi: string) => {
      if (!isValidNpi(npi)) {
        output.error(`Invalid NPI: ${npi}`)
        process.exit(1)
      }
      try {
        const result = await sendIpcCommand(socketPath, { type: 'provider.add', npi })
        if (result.ok) {
          output.success(`Provider ${npi} registered`)
        } else {
          output.error(result.error ?? 'Registration failed')
          process.exit(1)
        }
      } catch (err) {
        output.error('Could not connect to Neuron — is it running?')
        process.exit(1)
      }
    })

  provider
    .command('list')
    .description('List registered providers')
    .action(async () => {
      // ... sendIpcCommand({ type: 'provider.list' }) then format as table
    })

  provider
    .command('remove <npi>')
    .description('Remove a provider from Axon')
    .action(async (npi: string) => {
      // ... interactive confirmation, then sendIpcCommand({ type: 'provider.remove', npi })
    })
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` npm package | `node:fetch` built-in | Node 18 stable, Node 20 unflagged | No dependency needed for HTTP |
| `request` / `axios` for HTTP | `node:fetch` | 2022-2023 | Axios still common but built-in is sufficient for simple cases |
| `jest` for testing | `vitest` | Already in project | No change needed |
| File-backed JSON for state | SQLite (already chosen) | Project decision in STATE.md | SQLite already in project; use it |

**Deprecated/outdated:**
- `node-fetch` npm package: Superseded by built-in `fetch` in Node 18+. This project requires Node >=20.19.0.
- `request` package: Deprecated and archived. Not used.
- Polling/file-watching for CLI-to-server IPC: Unix domain sockets are the standard daemon pattern (pm2, systemd, Docker all use this).

---

## Open Questions

1. **Axon API contract is not finalized**
   - What we know: From PRD section 2.1.4, the methods are `registerNeuron()`, `updateEndpoint()`, `registerProvider()`, `updateCredentials()`, `getCredentialStatus()`. The PRD shows a data model for `NeuronRegistrationState`.
   - What's unclear: Exact HTTP paths, request/response shapes, error codes. The Axon PRD is marked "Draft — Pending Review."
   - Recommendation: Design the mock to match the PRD data model exactly. Use path conventions that mirror the PRD method names (`/v1/neurons`, `/v1/neurons/:id/endpoint`, `/v1/neurons/:id/providers`). When real Axon ships, the `AxonClient` is the only file that needs updating.

2. **What endpoint information to register with Axon (Claude's Discretion)**
   - What we know: PRD says "Neuron endpoint URL, protocol version, health status, last heartbeat timestamp". Config already has `server.port` and `server.host`.
   - Recommendation: Register `{ organization_npi, organization_name, organization_type, neuron_endpoint_url, protocol_version: '1.0.0' }`. Derive `neuron_endpoint_url` from `axon.endpointUrl` in config (the public URL of this Neuron).

3. **Health metric format (Claude's Discretion)**
   - What we know: CONTEXT.md says surfaced via "log warnings, neuron status command, and exposed health metric for monitoring systems."
   - Recommendation: Write a `data/status.json` file on every heartbeat cycle (success and failure). It contains `{ status: 'healthy'|'degraded', last_heartbeat: ISO, axon_reachable: boolean, backoff_attempt: number }`. This is lightweight, readable by monitoring scripts, and requires no additional server. The `neuron status` command reads it directly without needing IPC.

4. **`neuron init` vs `neuron start` for initial registration**
   - What we know: PRD section says "`neuron init` implementation: interactive registration flow". CONTEXT.md says `provider add/remove` is hot (contacts running Neuron). But `neuron init` logically runs before the server starts.
   - Recommendation: `neuron init` generates `neuron.config.json` with Axon URL and endpoint URL fields (extend existing stub). `neuron start` performs initial registration on first boot (status === 'unregistered'), then starts heartbeat. This avoids a two-step init + start flow and keeps the startup contract simple: "start always gets you to registered state."

5. **Interactive confirmation for `neuron provider remove`**
   - What we know: Must confirm interactively before unregistering.
   - What's unclear: Readline is needed for interactive input. Commander doesn't have built-in `confirm()`.
   - Recommendation: Use Node.js built-in `node:readline` for the confirmation prompt. One-liner: `await question('Remove provider 1234567890? (y/N): ')`. No new dependency.

---

## Sources

### Primary (HIGH confidence)
- Node.js docs (nodejs.org/api/net.html) — `net.createServer`, Unix socket IPC, path lifecycle
- Node.js docs (nodejs.org/api/http.html) — `http.createServer` for mock Axon
- Node.js docs — `node:fetch` stable in Node 20+
- Project codebase — Phase 1 artifacts: `StorageEngine`, `SqliteStorage`, `AuditLogger`, `NeuronConfigSchema`, `isValidNpi`, Commander CLI structure

### Secondary (MEDIUM confidence)
- MSW docs (mswjs.io/docs/integrations/node) — `setupServer` for Vitest unit tests
- WebSearch verified: `node:net` Unix socket IPC is the standard daemon pattern (used by PM2, Docker daemon, etc.)
- WebSearch verified: Full jitter formula `Math.random() * delay` is the recommended AWS backoff algorithm (Exponential Backoff and Jitter, Amazon blog)

### Tertiary (LOW confidence)
- Exact Axon API paths and response shapes — inferred from PRD; actual API is unbuilt. Mock defines the contract.
- Vitest `globalSetup` for mock Axon port conflict avoidance — standard Vitest pattern, but not tested in this specific context.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All tooling is either already in project or Node.js built-in
- Architecture: HIGH — Patterns are well-established (Unix IPC, heartbeat with backoff, SQLite state)
- Axon API contract: LOW-MEDIUM — Inferred from PRD; actual Axon API not yet built
- Pitfalls: HIGH — Based on well-known IPC and retry loop failure modes

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days; stable patterns, except Axon API shape which is a moving target)
