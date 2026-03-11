# Stack Research

**Domain:** Healthcare organizational endpoint server (Node.js standalone infrastructure)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Node.js | >=22.12.0 (LTS) | Runtime | PRD constraint. LTS stability, stable Ed25519 in `crypto`, stable `util.parseArgs`, mature `node:http`. Node 22 entered LTS Oct 2024 and is supported through Apr 2027. | HIGH |
| TypeScript | ~5.7.x | Language | PRD constraint. Aligns with ecosystem (`provider-core` uses same). 5.7 adds `using` declarations and satisfies-as patterns useful for resource cleanup (WebSocket sessions, file handles). | HIGH |
| pnpm | >=9.x | Package manager | PRD constraint. Strict dependency isolation prevents phantom deps. Workspace support for future monorepo if SDK package is added. | HIGH |
| tsdown | ~0.20.x | Build/bundle | PRD constraint. Latest is 0.20.3. Rolldown-powered, ESM-first, drop-in tsup replacement. Produces CJS+ESM dual output. Requires Node >=20.19. | HIGH |
| vitest | ~4.0.x | Testing | PRD constraint. Latest is 4.0.18. Native TypeScript, fast watch mode, built-in coverage via v8. 80% coverage thresholds configurable in `vitest.config.ts`. | HIGH |
| @sinclair/typebox | ~0.34.x | Schema validation | PRD constraint. Latest is 0.34.48. JSON Schema Type Builder with static TypeScript inference. Used for all data models, config validation, and API request/response validation. Produces standard JSON Schema (reusable for OpenAPI 3.1 generation). | HIGH |

### Server Infrastructure

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Node.js `node:http` | built-in | HTTP server | PRD constraint: no Express, no Fastify. Use `http.createServer()` with manual routing. Pattern: parse `req.url` + `req.method`, dispatch to handler functions. `node:http` is stable, well-documented, and sufficient for the ~20 REST endpoints defined in the PRD. | HIGH |
| ws | ^8.19.0 | WebSocket server | Node.js 22 has a stable WebSocket *client* (via Undici), but **no built-in WebSocket server**. `ws` is the de facto standard: 80M+ weekly downloads, passes Autobahn test suite, integrates with `node:http` via `handleUpgrade()` for shared port. Single native dependency (optional `bufferutil`/`utf-8-validate` for performance). | HIGH |
| @homebridge/ciao | ^1.3.5 | mDNS/DNS-SD | RFC 6763 compliant DNS-SD library advertising over mDNS (RFC 6762). Pure TypeScript, actively maintained (published 6 days ago), successor to `bonjour-hap`. Service type advertisement (`_careagent-neuron._tcp`) with TXT records. Used by Homebridge ecosystem (proven at scale in IoT/home automation). | MEDIUM |

### Cryptography

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Node.js `node:crypto` | built-in | Ed25519 signing/verification, SHA-256 hashing | Ed25519 is fully supported in Node.js `crypto` module since Node 15+. `crypto.sign()` and `crypto.verify()` accept `'ed25519'` algorithm directly. `crypto.generateKeyPairSync('ed25519')` for key generation. `crypto.createHash('sha256')` for audit log chain hashing. Zero dependencies needed. | HIGH |

**Ed25519 usage pattern:**
```typescript
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto'

// Key generation
const { publicKey, privateKey } = generateKeyPairSync('ed25519')

// Sign
const signature = sign(null, Buffer.from(data), privateKey)

// Verify
const isValid = verify(null, Buffer.from(data), publicKey, signature)

// SHA-256 for audit chain
const hash = createHash('sha256').update(canonicalJson).digest('hex')
```

### Storage

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| better-sqlite3 | ^12.6.2 | Persistent storage | Use SQLite via better-sqlite3 as the **primary storage engine**, not file-backed JSON. Rationale below. Synchronous API (simpler error handling), ACID transactions, indexing for time-range queries (appointments, billing), concurrent-read safe. Single-file database. Node.js 22 compatible with prebuilt binaries. | HIGH |

**Why SQLite over file-backed JSON:**

The PRD lists file-backed JSON as an option, but SQLite is the stronger choice for Neuron's requirements:

1. **Query patterns demand it.** The PRD specifies time-range queries for appointments (`by date range, provider, status`), billing records, and availability. File-backed JSON requires loading entire collections into memory and filtering in JS. SQLite indexes make these queries O(log n).

2. **Multiple collections with referential integrity.** Neuron has 7+ data types (relationships, appointments, availability, billing, termination records, sync state, cached chart entries) that reference each other via `relationship_id`. SQLite enforces this; JSON files cannot.

3. **Append-only audit log is still JSONL.** The hash-chained audit log remains a separate JSONL file (append-only, tamper-evident). SQLite is for structured queryable data; JSONL is for the append-only audit trail.

4. **`node:sqlite` is still experimental.** Node.js 22+ includes `node:sqlite` but it requires `--experimental-sqlite` and the maintainers recommend against production use. better-sqlite3 is battle-tested with prebuilt binaries.

5. **Single-file portability.** SQLite databases are single files, trivially backed up with `cp`, and portable across platforms. Same operational simplicity as JSON files.

**Why NOT `node:sqlite`:** Still experimental in Node.js 22-25. Requires CLI flag. API is less mature than better-sqlite3. No prebuilt binary advantage (it's compiled into Node itself, but the API surface is limited). Revisit when it exits experimental status.

### CLI

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| commander | ^14.0.3 | CLI framework | Most widely used CLI framework (130M+ weekly downloads). Tree of subcommands maps perfectly to Neuron's CLI structure (`neuron init`, `neuron start`, `neuron provider add`, `neuron api-key create`). Auto-generated help, typed options, async action handlers. Single dependency, no native code. | HIGH |

**Why commander over alternatives:**
- **Over `util.parseArgs` (built-in):** `parseArgs` handles flat argument parsing but has no subcommand support, no auto-generated help, no validation. Neuron's CLI has nested subcommands (`neuron provider add/remove/list`, `neuron api-key create/revoke/list`). Building this on `parseArgs` would mean reimplementing what commander already does.
- **Over yargs:** Similar capabilities but heavier API. Commander's programmatic/OOP style fits better with TypeScript class-based command definitions.
- **Over citty (UnJS):** Newer, lighter, but marked "under heavy development." Fewer downloads, smaller ecosystem. Commander is the proven choice.

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| uuid | ^11.x | UUID v4 generation | Every data model in the PRD uses UUID v4 for IDs (session_id, relationship_id, appointment_id, billing_id, etc.). Could use `crypto.randomUUID()` built-in instead -- see note below. | MEDIUM |
| pino | ^9.x | Structured logging (operational) | Fast JSON logger for operational logs (not the audit log). Useful for debugging, startup info, heartbeat failures, connection events. Separate concern from the hash-chained audit JSONL. | MEDIUM |

**Note on UUID generation:** Node.js 22 has `crypto.randomUUID()` built-in (stable since Node 19). This produces UUIDv4 and is sufficient for all ID generation needs. **Recommendation: Use `crypto.randomUUID()` -- no `uuid` package needed.** This eliminates one dependency.

**Note on logging:** Pino is optional. For v1 demo, `console.log` with JSON formatting may suffice. Add pino if structured log levels, child loggers, or log rotation become needed.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsdown ~0.20.x | Build | Config via `tsdown.config.ts`. Target `node22`. Output `dist/` with CJS+ESM. |
| vitest ~4.0.x | Test runner | Config via `vitest.config.ts`. Coverage provider: `v8`. Threshold: 80% statements/branches/functions/lines. |
| typescript ~5.7.x | Type checking | Strict mode. `moduleResolution: "bundler"`. `target: "es2022"`. |
| @types/ws | ^8.x | ws type definitions | TypeScript declarations for the ws WebSocket library. |
| @types/better-sqlite3 | ^7.x | better-sqlite3 type definitions | TypeScript declarations for better-sqlite3. |

## Installation

```bash
# Core runtime dependencies
pnpm add ws better-sqlite3 @homebridge/ciao @sinclair/typebox commander

# Dev dependencies
pnpm add -D typescript tsdown vitest @types/node @types/ws @types/better-sqlite3
```

**Total runtime dependencies: 5** (`ws`, `better-sqlite3`, `@homebridge/ciao`, `@sinclair/typebox`, `commander`)

This is minimal for a standalone server. Each dependency is justified:
- `ws`: No built-in WebSocket server exists in Node.js
- `better-sqlite3`: SQLite is needed for queryable structured data; `node:sqlite` is experimental
- `@homebridge/ciao`: mDNS/DNS-SD requires multicast UDP handling too complex to hand-roll
- `@sinclair/typebox`: PRD constraint; schema validation + TypeScript inference
- `commander`: CLI subcommand tree too complex for `util.parseArgs`

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| WebSocket server | ws ^8.19.0 | Node.js built-in WebSocket | Node.js 22 only has a WebSocket *client*. No server implementation exists in core. `ws` is required. |
| WebSocket server | ws ^8.19.0 | socket.io | Massive overhead (engine.io, polling fallback). Neuron needs raw WebSocket for CareAgent protocol messages, not a framework. |
| mDNS/DNS-SD | @homebridge/ciao ^1.3.5 | bonjour-service ^1.3.0 | bonjour-service works but last published 1 year ago. ciao is RFC-compliant, actively maintained (6 days ago), TypeScript native, and battle-tested in Homebridge ecosystem. |
| mDNS/DNS-SD | @homebridge/ciao ^1.3.5 | mdns (node_mdns) | Requires native compilation against system mDNS stack. ciao is pure JS/TS, no native deps. |
| mDNS/DNS-SD | @homebridge/ciao ^1.3.5 | multicast-dns ^7.2.5 | Low-level raw packet handling. Would need to build DNS-SD service type/TXT record layer on top. ciao provides this out of the box. |
| Storage | better-sqlite3 ^12.6.2 | File-backed JSON (fs.readFile/writeFile) | No indexing, no transactions, entire file must be read/parsed for queries. Breaks down with multiple concurrent operations and query patterns in PRD. |
| Storage | better-sqlite3 ^12.6.2 | node:sqlite (built-in) | Experimental, requires `--experimental-sqlite` flag, maintainers recommend against production use. Revisit when stable. |
| Storage | better-sqlite3 ^12.6.2 | lowdb | JSON-file-based, lodash-powered. Same limitations as raw JSON for queries. Better API but wrong storage model for Neuron's needs. |
| CLI | commander ^14.0.3 | util.parseArgs (built-in) | No subcommand support. Neuron has nested commands (`neuron provider add`). Would require building subcommand dispatch, help generation, and validation from scratch. |
| CLI | commander ^14.0.3 | citty (UnJS) | Marked "under heavy development." Fewer than 500K weekly downloads vs commander's 130M+. Risk of API churn. |
| CLI | commander ^14.0.3 | yargs | Viable alternative but chained API is less TypeScript-friendly. Commander's explicit `.command()` / `.action()` pattern maps more cleanly to Neuron's command tree. |
| Crypto | node:crypto (built-in) | @noble/ed25519 | Built-in is sufficient. `crypto.sign()` / `crypto.verify()` with Ed25519 works out of the box. No need for external crypto unless interop with non-DER key formats is needed. |
| Schema | @sinclair/typebox | zod | PRD constraint specifies TypeBox. Additionally, TypeBox produces standard JSON Schema (needed for OpenAPI 3.1 generation), while zod does not natively produce JSON Schema. |
| HTTP server | node:http (built-in) | Express / Fastify / Hono | PRD constraint: "Node.js built-in http module (no Express, no Fastify)." Ecosystem consistency with other CareAgent repos. |
| Logging | console + pino (optional) | winston | Winston is heavier, slower. Pino is 5-10x faster for JSON structured logging. For v1 demo, even console may suffice. |
| UUID | crypto.randomUUID() (built-in) | uuid package | Built-in is sufficient for UUIDv4. No dependency needed. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Express / Fastify / Hono | PRD constraint. These add routing, middleware, body parsing layers that conflict with the "bare http module" requirement. Also adds unnecessary abstraction over a ~20-endpoint API. | `node:http` with manual route dispatch |
| socket.io | Massive abstraction layer (engine.io, polling fallback, rooms, namespaces). Neuron needs raw WebSocket for protocol-level CareAgent messages. socket.io's framing is incompatible with the AxonMessage format. | `ws` for raw WebSocket |
| node:sqlite | Experimental in Node.js 22-25. Requires `--experimental-sqlite` flag. API is limited compared to better-sqlite3. Not recommended for production by Node.js maintainers themselves. | `better-sqlite3` |
| mongoose / sequelize / prisma / drizzle | ORM overhead for what is a single-file SQLite database. Neuron's queries are straightforward CRUD + time-range + status filters. Raw SQL with better-sqlite3's prepared statements is simpler and faster. | `better-sqlite3` with raw SQL |
| jsonwebtoken (JWT) | Neuron uses Ed25519 consent tokens (custom protocol), not JWTs. JWT adds unnecessary claims structure and algorithm negotiation. The consent token format is defined by the Axon protocol spec. | `node:crypto` Ed25519 sign/verify |
| bcrypt / argon2 | No password hashing needed. API keys are generated secrets (compare with timing-safe equality). Consent tokens use Ed25519 signatures. | `crypto.timingSafeEqual()` for API key comparison |
| dotenv | Node.js 22 has built-in `--env-file` flag. PRD uses `NEURON_` prefixed env vars with a custom loader, not `.env` files. | Custom env var loader reading `process.env` |

## Architecture Patterns

### HTTP Routing Without a Framework

Since the PRD mandates `node:http` with no framework, use this pattern:

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'node:http'

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>

interface Route {
  method: string
  pattern: RegExp
  paramNames: string[]
  handler: Handler
}

// Route registration
function route(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = []
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    }) + '$'
  )
  return { method, pattern, paramNames, handler }
}

// Dispatch
const routes: Route[] = [
  route('GET', '/api/v1/organization', getOrganization),
  route('GET', '/api/v1/appointments/:id', getAppointment),
  // ... all routes
]

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  for (const r of routes) {
    if (req.method !== r.method) continue
    const match = url.pathname.match(r.pattern)
    if (!match) continue
    const params: Record<string, string> = {}
    r.paramNames.forEach((name, i) => { params[name] = match[i + 1] })
    await r.handler(req, res, params)
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not Found' }))
})
```

### WebSocket + HTTP on Shared Infrastructure

```typescript
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const server = createServer(httpHandler)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  // Route WebSocket upgrades by path
  const url = new URL(request.url!, `http://${request.headers.host}`)
  if (url.pathname === '/ws/patient') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})
```

### Hash-Chained Audit Log Pattern

```typescript
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

interface AuditEntry {
  entry_id: string
  timestamp: string
  event_type: string
  actor: string
  details: Record<string, unknown>
  previous_hash: string
  entry_hash: string
}

function computeHash(entry: Omit<AuditEntry, 'entry_hash'>): string {
  // Canonical JSON: sorted keys, deterministic serialization
  const canonical = JSON.stringify(entry, Object.keys(entry).sort())
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

let previousHash = '' // Empty string for first entry

function appendAuditEntry(eventType: string, actor: string, details: Record<string, unknown>): void {
  const partial = {
    entry_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    actor,
    details,
    previous_hash: previousHash,
  }
  const entry_hash = computeHash(partial)
  const entry: AuditEntry = { ...partial, entry_hash }
  appendFileSync(auditPath, JSON.stringify(entry) + '\n')
  previousHash = entry_hash
}
```

### TypeBox Schema Validation Pattern

```typescript
import { Type, type Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

// Define schema (produces JSON Schema + TypeScript type)
const NeuronConfig = Type.Object({
  organization: Type.Object({
    name: Type.String(),
    npi: Type.String({ pattern: '^\\d{10}$' }),
  }),
  // ...
})

type NeuronConfig = Static<typeof NeuronConfig>

// Compile for fast repeated validation
const ConfigValidator = TypeCompiler.Compile(NeuronConfig)

// Validate
function validateConfig(data: unknown): NeuronConfig {
  if (ConfigValidator.Check(data)) {
    return data // TypeScript narrows to NeuronConfig
  }
  const errors = [...ConfigValidator.Errors(data)]
  throw new Error(`Invalid config: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`)
}
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| ws@8.19.0 | Node.js >=10 | Stable on Node 22. `handleUpgrade()` integrates with `node:http`. |
| better-sqlite3@12.6.2 | Node.js 14-24 | Prebuilt binaries for Node 22 LTS. Known issues with Node 25+; not a concern for Node 22. |
| @homebridge/ciao@1.3.5 | Node.js >=16 | Pure TypeScript, no native deps. |
| @sinclair/typebox@0.34.48 | TypeScript >=4.x | No Node version constraints. Pure TypeScript library. |
| commander@14.0.3 | Node.js >=18 | Commander 15 scheduled May 2026; v14 gets maintenance until May 2027. |
| tsdown@0.20.3 | Node.js >=20.19 | Rolldown-powered. Compatible with vitest 4.x and TypeScript 5.7.x. |
| vitest@4.0.18 | Node.js >=18 | Uses Vite 6 under the hood. Compatible with TypeScript 5.7.x. |

## Storage Decision Matrix

| Criterion | File-backed JSON | better-sqlite3 | node:sqlite |
|-----------|-----------------|-----------------|-------------|
| Query performance | Poor (full scan) | Excellent (indexes) | Good (indexes) |
| Transactions | None | ACID | ACID |
| Concurrent reads | Risky (file locking) | Safe (WAL mode) | Safe |
| Dependencies | 0 (built-in fs) | 1 (native addon) | 0 (built-in) |
| Stability | Proven | Proven | Experimental |
| Time-range queries | Manual in JS | SQL WHERE + INDEX | SQL WHERE + INDEX |
| Referential integrity | Manual | FOREIGN KEY | FOREIGN KEY |
| Backup | cp file.json | cp database.sqlite | cp database.sqlite |
| PRD suitability | Low (7+ collections, time queries) | **High** | Medium (experimental) |

**Decision: better-sqlite3.** The query patterns in the PRD (time-range appointment queries, status-based billing filters, relationship lookups by multiple keys) demand indexing and structured queries. SQLite provides this with single-file simplicity.

## Sources

- [Node.js WebSocket documentation](https://nodejs.org/en/learn/getting-started/websocket) -- confirmed built-in WebSocket is client-only (HIGH)
- [ws GitHub releases](https://github.com/websockets/ws/releases) -- v8.19.0 latest, Jan 2025 (HIGH)
- [ws npm package](https://www.npmjs.com/package/ws) -- 80M+ weekly downloads (HIGH)
- [Node.js crypto documentation](https://nodejs.org/api/crypto.html) -- Ed25519 sign/verify stable (HIGH)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) -- v12.6.2, Node 22 compatible (HIGH)
- [better-sqlite3 vs node:sqlite discussion](https://github.com/WiseLibs/better-sqlite3/discussions/1245) -- maintainer recommends against node:sqlite for production (HIGH)
- [Node.js SQLite docs](https://nodejs.org/api/sqlite.html) -- still experimental, requires flag (HIGH)
- [@homebridge/ciao npm](https://www.npmjs.com/package/@homebridge/ciao) -- v1.3.5, published Feb 2026 (MEDIUM)
- [@sinclair/typebox npm](https://www.npmjs.com/package/@sinclair/typebox) -- v0.34.48, actively maintained (HIGH)
- [commander npm](https://www.npmjs.com/package/commander) -- v14.0.3, Feb 2026 (HIGH)
- [tsdown npm](https://www.npmjs.com/package/tsdown) -- v0.20.3, Feb 2026 (HIGH)
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) -- v4.0.18 latest, Oct 2025 release (HIGH)
- [Node.js util.parseArgs docs](https://nodejs.org/api/util.html) -- stable since Node 20, no subcommands (HIGH)
- [bonjour-service npm](https://www.npmjs.com/package/bonjour-service) -- v1.3.0, last published 1 year ago (MEDIUM)
- [Node.js v22 release announcement](https://nodejs.org/en/blog/announcements/v22-release-announce) -- LTS, stable WebSocket client (HIGH)

---
*Stack research for: @careagent/neuron healthcare organizational endpoint server*
*Researched: 2026-02-21*
