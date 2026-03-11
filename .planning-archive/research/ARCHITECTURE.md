# Architecture Research

**Domain:** Healthcare organizational endpoint server (CareAgent Neuron)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
                          ┌────────────────────────────┐
                          │   National Axon Registry    │
                          │   (upstream authority)      │
                          └────────────┬───────────────┘
                                       │
                  Registration, heartbeat, credential mgmt (HTTPS)
                                       │
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                            NEURON SERVER                                    │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐  │
│  │                         SERVER CORE (server.ts)                       │  │
│  │         HTTP Server (port 3000) + WebSocket Server (port 3002)        │  │
│  │                    + mDNS Advertiser (port 3001)                      │  │
│  └────┬──────────────┬──────────────┬──────────────┬────────────────────┘  │
│       │              │              │              │                        │
│  ┌────┴────┐  ┌──────┴──────┐  ┌───┴────┐  ┌─────┴──────┐                │
│  │  REST   │  │  WebSocket  │  │  mDNS  │  │    CLI     │                │
│  │  API    │  │  Routing    │  │  Disc. │  │  Commands  │                │
│  │ Layer   │  │  Layer      │  │  Layer │  │            │                │
│  └────┬────┘  └──────┬──────┘  └───┬────┘  └─────┬──────┘                │
│       │              │              │              │                        │
│  ┌────┴──────────────┴──────────────┴──────────────┴────────────────────┐  │
│  │                      DOMAIN MODULES                                   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐             │  │
│  │  │ Regist-  │ │ Consent  │ │ Relation- │ │ Termi-     │             │  │
│  │  │ ration   │ │ Verify   │ │ ships     │ │ nation     │             │  │
│  │  └──────────┘ └──────────┘ └───────────┘ └────────────┘             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐                            │  │
│  │  │ Sched-   │ │ Billing  │ │ Chart     │                            │  │
│  │  │ uling    │ │          │ │ Sync      │                            │  │
│  │  └──────────┘ └──────────┘ └───────────┘                            │  │
│  └──────────────────────┬───────────────────────────────────────────────┘  │
│                         │                                                   │
│  ┌──────────────────────┴───────────────────────────────────────────────┐  │
│  │                     INFRASTRUCTURE LAYER                              │  │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────┐        │  │
│  │  │ Storage  │  │  Audit    │  │  Config  │  │  Types/      │        │  │
│  │  │ Abstract │  │  Logger   │  │  Loader  │  │  Schemas     │        │  │
│  │  └──────────┘  └───────────┘  └──────────┘  └──────────────┘        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────┴────┐        ┌──────┴──────┐      ┌─────┴──────┐
    │ Third-  │        │  Patient    │      │  Provider  │
    │ Party   │        │  CareAgent  │      │  CareAgent │
    │ Apps    │        │ (inbound)   │      │ (local)    │
    │ (REST)  │        │ (WebSocket) │      │ (WebSocket)│
    └─────────┘        └─────────────┘      └────────────┘
```

### Four-Layer Architecture

The Neuron follows a **four-layer architecture** — not as a dogmatic pattern, but because it maps naturally to the system's responsibilities:

1. **Network Layer** (server core): Manages HTTP, WebSocket, and mDNS listener lifecycles. Owns port binding, TLS termination, and connection acceptance. The CLI also operates at this layer as it directly controls the server process.

2. **Interface Layer** (REST API, WebSocket routing, mDNS discovery): Translates protocol-specific concerns into domain operations. The REST API layer handles middleware pipelines (auth, CORS, rate limiting). The WebSocket routing layer handles connection authentication and session bridging. The mDNS layer handles service advertisement.

3. **Domain Layer** (registration, consent, relationships, termination, scheduling, billing, chart sync): Pure business logic. Each module owns its data model, validation rules, and state transitions. Modules communicate through direct function calls with typed interfaces -- no event bus, no message queue, no unnecessary indirection for a single-process server.

4. **Infrastructure Layer** (storage, audit, config, types): Cross-cutting concerns shared by all domain modules. The storage abstraction provides a consistent interface for persistence regardless of backend (JSON files or SQLite). The audit logger is injected into domain modules. Config is loaded once at startup and passed down.

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **server.ts** | HTTP + WebSocket server lifecycle, startup/shutdown orchestration | All modules (initialization), config |
| **config/** | Load neuron.config.json, apply env overrides, validate with TypeBox, fail fast on invalid config | server.ts (startup), all modules (read config) |
| **registration/** | Axon registration, heartbeat, provider management, registration state persistence | Axon (outbound HTTPS), config, storage, audit |
| **routing/** | WebSocket server, connection auth pipeline, session bridging, session tracking | consent (verify tokens), relationships (lookup), provider CareAgents (outbound WS), audit |
| **discovery/** | mDNS/DNS-SD advertisement lifecycle (start/stop with server) | config (ports, NPI), routing (shares WebSocket for local connections) |
| **consent/** | Ed25519 token verification, challenge-response generation | Node.js crypto (Ed25519 verify), relationships (check existence) |
| **relationships/** | RelationshipRecord CRUD, consent handshake handler, relationship queries | consent (during handshake), storage, audit |
| **scheduling/** | Appointment CRUD, provider availability management, time-based queries | relationships (validate relationship_id), storage, audit |
| **billing/** | BillingRecord CRUD, CPT/ICD code management, status tracking | scheduling (appointment reference), relationships (validate relationship_id), storage, audit |
| **sync/** | Chart sync receiver, authorization check, incremental sync, access revocation | relationships (check consent scope), routing (uses WS sessions), storage, audit |
| **termination/** | Termination flow, state protocol validation, permanent relationship deactivation | relationships (update status), routing (stop routing), audit |
| **api/** | REST route dispatch, middleware pipeline, API key management, OpenAPI spec | scheduling, billing, relationships, registration (read data), config, audit |
| **audit/** | Hash-chained JSONL log, tamper-evident chain, integrity verification | storage (writes log file), all domain modules (receives events) |
| **cli/** | Command parsing, interactive init flow, provider/api-key management commands | server.ts (start/stop), registration, api (key management) |
| **types/** | TypeBox schema definitions, type exports | All modules (import schemas and types) |

## Recommended Project Structure

```
src/
├── index.ts                    # Entry point: CLI dispatch or server start
├── server.ts                   # Server lifecycle orchestrator
├── config/
│   ├── index.ts                # Config loader: file + env merge + validate
│   ├── schema.ts               # NeuronConfig TypeBox schema
│   └── env.ts                  # NEURON_ prefix env var parser
├── registration/
│   ├── index.ts                # Public API surface for registration module
│   ├── axon-client.ts          # AxonRegistry HTTP client wrapper
│   ├── heartbeat.ts            # setInterval-based heartbeat with backoff
│   ├── provider-manager.ts     # Provider CRUD against Axon + local state
│   └── state.ts                # NeuronRegistrationState persistence
├── routing/
│   ├── index.ts                # WebSocket server setup
│   ├── websocket.ts            # Connection accept, upgrade handling
│   ├── session-manager.ts      # Active session tracking, concurrency limits
│   └── bridge.ts               # Bidirectional message pipe (patient <-> provider)
├── discovery/
│   ├── index.ts                # mDNS lifecycle (advertise on start, unadvertise on stop)
│   └── mdns.ts                 # mDNS/DNS-SD TXT record construction, multicast
├── consent/
│   ├── index.ts                # Public consent verification API
│   ├── token-verifier.ts       # Ed25519 verify using Node.js crypto
│   └── challenge.ts            # Challenge-response nonce generation
├── relationships/
│   ├── index.ts                # Public relationships API
│   ├── store.ts                # RelationshipRecord persistence
│   ├── handshake.ts            # Consent handshake state machine
│   └── query.ts                # Query by patient, provider, relationship ID
├── scheduling/
│   ├── index.ts                # Public scheduling API
│   ├── appointments.ts         # Appointment CRUD + status lifecycle
│   ├── availability.ts         # Provider availability windows + slot queries
│   └── store.ts                # Scheduling data persistence
├── billing/
│   ├── index.ts                # Public billing API
│   ├── records.ts              # BillingRecord CRUD + CPT/ICD management
│   └── store.ts                # Billing data persistence
├── api/
│   ├── index.ts                # HTTP server creation, route registration
│   ├── router.ts               # Method + path dispatch (manual, no framework)
│   ├── middleware/
│   │   ├── auth.ts             # API key lookup + validation
│   │   ├── rate-limit.ts       # Token bucket per API key
│   │   ├── cors.ts             # Origin check + header injection
│   │   └── error-handler.ts    # Structured error responses
│   ├── routes/
│   │   ├── organization.ts     # GET /api/v1/organization, /providers
│   │   ├── appointments.ts     # CRUD /api/v1/appointments
│   │   ├── availability.ts     # CRUD /api/v1/availability/:npi
│   │   ├── billing.ts          # CRUD /api/v1/billing
│   │   ├── relationships.ts    # GET /api/v1/relationships (read-only)
│   │   └── status.ts           # GET /api/v1/status
│   ├── openapi.ts              # OpenAPI 3.1 spec builder from TypeBox schemas
│   └── api-keys.ts             # API key generation, storage, revocation
├── sync/
│   ├── index.ts                # Sync module public API
│   ├── receiver.ts             # WebSocket message handler for chart sync
│   ├── store.ts                # CachedChartEntry persistence
│   └── revocation.ts           # Purge cache on access revocation
├── termination/
│   ├── index.ts                # Termination module public API
│   ├── handler.ts              # Termination flow coordinator
│   └── store.ts                # TerminationRecord persistence
├── audit/
│   ├── index.ts                # AuditLogger public API
│   └── logger.ts               # Hash-chained JSONL writer + chain verifier
├── cli/
│   ├── index.ts                # CLI arg parser and command dispatch
│   ├── init.ts                 # neuron init (interactive registration)
│   ├── start.ts                # neuron start (launch server)
│   ├── stop.ts                 # neuron stop (graceful shutdown)
│   ├── status.ts               # neuron status (health check)
│   ├── provider.ts             # neuron provider add/remove/list
│   └── api-key.ts              # neuron api-key create/revoke/list
└── types/
    ├── index.ts                # Re-export barrel
    ├── registration.ts         # NeuronRegistrationState, ProviderRecord
    ├── routing.ts              # RoutingSession
    ├── relationships.ts        # RelationshipRecord
    ├── scheduling.ts           # Appointment, ProviderAvailability
    ├── billing.ts              # BillingRecord, CPTEntry
    ├── sync.ts                 # CachedChartEntry, SyncState
    ├── termination.ts          # TerminationRecord
    ├── api.ts                  # API request/response types
    ├── discovery.ts            # DiscoveryPayload
    └── audit.ts                # AuditEntry
```

### Structure Rationale

- **One folder per domain module:** Each of the 9 core functionalities gets its own directory. This creates clear ownership boundaries -- when you need to change how billing works, everything billing-related is in `billing/`. No hunting across a flat file structure.
- **index.ts as public API:** Each module's `index.ts` exports only what other modules need. Internal files (store.ts, handler.ts) are implementation details. This enforces module boundaries without a monorepo or separate packages.
- **types/ separated from modules:** TypeBox schemas are shared across modules (the API layer validates against the same schemas as the domain layer). Centralizing them prevents circular imports and ensures a single source of truth for data shapes.
- **api/middleware/ and api/routes/ subdirectories:** The REST API has enough files to justify grouping. Middleware is reusable across routes. Routes map 1:1 to PRD route groups.
- **Infrastructure at the root level:** server.ts, config/, audit/, and types/ are cross-cutting. They sit at the module root rather than nesting deeper, because every domain module depends on them.

## Architectural Patterns

### Pattern 1: Middleware Pipeline (REST API)

**What:** Incoming HTTP requests pass through an ordered chain of middleware functions before reaching the route handler. Each middleware can short-circuit (return early with an error response) or pass control to the next function.

**When to use:** For the REST API layer where every request needs CORS, authentication, and rate limiting in a consistent order.

**Trade-offs:** Explicit ordering makes the pipeline readable and debuggable. Without a framework, you own the pipeline -- more code to write, but no hidden magic. The downside is that adding middleware requires updating the pipeline manually.

**Example:**
```typescript
// Composable middleware pipeline without a framework
type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext
) => Promise<boolean> // true = continue, false = response already sent

const pipeline: Middleware[] = [
  corsMiddleware,
  authMiddleware,
  rateLimitMiddleware,
]

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext
): Promise<void> {
  for (const mw of pipeline) {
    const proceed = await mw(req, res, context)
    if (!proceed) return // middleware sent the response
  }
  await routeDispatcher(req, res, context)
}
```

**Confidence:** HIGH -- this is the standard pattern for framework-free Node.js HTTP servers. Middleware pipeline composition is well-documented in Node.js ecosystem literature.

### Pattern 2: Storage Abstraction with Pluggable Backend

**What:** A `Store<T>` interface that domain modules program against, with concrete implementations for file-backed JSON (v1) and SQLite (migration path). The abstraction is intentionally thin -- CRUD plus query, not a full ORM.

**When to use:** When the PRD explicitly calls for a migration path from JSON files to SQLite, and multiple domain modules (relationships, scheduling, billing, sync, termination) all need persistent storage.

**Trade-offs:** The abstraction adds a small layer of indirection but prevents domain modules from coupling to a specific storage mechanism. Keep the interface minimal (get, list, create, update, delete, query) -- over-abstracting storage is a classic trap that creates a bad ORM.

**Example:**
```typescript
interface Store<T> {
  get(id: string): Promise<T | null>
  list(filter?: Record<string, unknown>): Promise<T[]>
  create(id: string, data: T): Promise<void>
  update(id: string, data: Partial<T>): Promise<void>
  delete(id: string): Promise<void>
}

// File-backed JSON implementation
class JsonFileStore<T> implements Store<T> {
  constructor(private filePath: string) {}
  // Reads entire file, deserializes, operates on in-memory map, writes back
  // Simple but does not scale past ~10k records or concurrent writes
}

// SQLite implementation (migration path)
class SqliteStore<T> implements Store<T> {
  constructor(private db: Database, private table: string) {}
  // Uses parameterized SQL queries
  // Handles concurrent access, indexing, ACID transactions
}
```

**Confidence:** HIGH -- the storage abstraction pattern is standard for applications with known migration paths. Node.js 22+ includes experimental `node:sqlite`, but `better-sqlite3` is the proven choice for synchronous SQLite in Node.js. For v1, file-backed JSON is adequate given the single-process constraint and expected data volumes.

### Pattern 3: Connection Authentication Pipeline (WebSocket)

**What:** WebSocket connections pass through a multi-step authentication pipeline before a session is established. Unlike REST middleware (which runs per-request), this runs once at connection time and gates the entire session.

**When to use:** For the WebSocket routing layer where patient CareAgent connections require consent verification, relationship lookup, and provider routing before any messages flow.

**Trade-offs:** Front-loading all verification at connection time means the session is fully authenticated once established -- no per-message auth overhead. The downside is that connection setup is heavier (multiple async steps), and the connection is dropped entirely if any step fails.

**Example:**
```typescript
// WebSocket connection authentication pipeline
async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  // Step 1: Extract consent token from connection handshake
  const token = extractConsentToken(req)
  if (!token) return ws.close(4001, 'Missing consent token')

  // Step 2: Verify Ed25519 signature
  const verified = await consentVerifier.verify(token)
  if (!verified) return ws.close(4002, 'Invalid consent token')

  // Step 3: Check token expiration
  if (token.expires_at < Date.now()) return ws.close(4003, 'Expired consent token')

  // Step 4: Look up active relationship
  const relationship = await relationshipStore.findByPatientAndProvider(
    token.patient_agent_id, token.provider_npi
  )
  if (!relationship || relationship.status !== 'active')
    return ws.close(4004, 'No active relationship')

  // Step 5: Route to provider CareAgent
  const session = await sessionManager.createBridge(ws, relationship)
  auditLogger.log('connection.session_established', { sessionId: session.id })
}
```

**Confidence:** HIGH -- this is the standard pattern for authenticated WebSocket servers. The close codes (4000-4999 range) are application-specific per RFC 6455.

### Pattern 4: Hash-Chained Append-Only Log

**What:** Each audit entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain. Entries are serialized as JSONL (one JSON object per line) and appended to a file. Chain integrity can be verified by replaying the file and checking each hash.

**When to use:** For the audit log, where tamper evidence is a requirement and the data is append-only.

**Trade-offs:** Hash chaining is simple and effective for single-writer append-only logs. It detects tampering (modification or deletion of entries) but does not prevent it -- an attacker with file access can rewrite the entire chain. For v1 (single-process, local filesystem), this is appropriate. Production hardening (remote log shipping, independent witnesses) is v2.

**Example:**
```typescript
// Hash-chained JSONL audit log
function appendAuditEntry(entry: Omit<AuditEntry, 'entry_hash'>): void {
  const previousHash = getLastEntryHash() // '' for first entry
  const entryWithPrev = { ...entry, previous_hash: previousHash }

  // Compute hash over canonical JSON (deterministic key order)
  const canonical = JSON.stringify(entryWithPrev, Object.keys(entryWithPrev).sort())
  const entryHash = createHash('sha256').update(canonical).digest('hex')

  const fullEntry: AuditEntry = { ...entryWithPrev, entry_hash: entryHash }
  appendFileSync(auditPath, JSON.stringify(fullEntry) + '\n')
}
```

**Confidence:** HIGH -- hash-chained logging is a well-established pattern documented in academic literature (Crosby & Wallach, "Efficient Data Structures for Tamper-Evident Logging," USENIX Security 2009) and implemented in systems like Certificate Transparency logs.

### Pattern 5: Module Initialization with Dependency Injection

**What:** The server startup function creates all infrastructure dependencies (config, storage, audit logger) and passes them into domain module constructors. Modules declare their dependencies explicitly rather than importing global singletons.

**When to use:** For the Neuron server startup, where modules need config values, storage instances, and the audit logger but should not reach for global state.

**Trade-offs:** Makes testing straightforward (inject mocks). Makes the dependency graph visible in one place (server.ts). Slightly more verbose than global imports, but prevents hidden coupling between modules.

**Example:**
```typescript
// server.ts - startup orchestration
async function startNeuron(config: NeuronConfig): Promise<NeuronServer> {
  const storage = createStorage(config.storage)        // JSON or SQLite
  const auditLogger = new AuditLogger(config.audit)
  const relationshipStore = new RelationshipStore(storage, auditLogger)
  const consentVerifier = new ConsentVerifier()
  const sessionManager = new SessionManager(config.websocket, auditLogger)
  const registration = new RegistrationModule(config, storage, auditLogger)

  // Domain modules receive their dependencies at construction
  const routing = new RoutingModule(consentVerifier, relationshipStore, sessionManager)
  const scheduling = new SchedulingModule(storage, auditLogger)
  const billing = new BillingModule(storage, auditLogger)
  const api = new ApiModule(config.api, scheduling, billing, relationshipStore, registration)

  // Start listeners
  await registration.startHeartbeat()
  await routing.listen(config.websocket.port)
  await api.listen(config.api.port)
  if (config.localNetwork.enabled) await startMdns(config)

  return { stop: () => gracefulShutdown(/* all modules */) }
}
```

**Confidence:** HIGH -- constructor injection is the simplest dependency injection pattern and is standard practice in Node.js server applications. No DI container needed for a project of this size.

## Data Flow

### Flow 1: Patient Connection (Remote, via Axon Lookup)

```
Patient CareAgent
    │
    │  1. Looks up organization in Axon registry by provider NPI
    │  2. Receives Neuron endpoint URL
    │
    ▼
Neuron WebSocket Server (port 3002)
    │
    │  3. Patient connects with consent token in handshake headers
    │
    ├─── Consent Verifier
    │       │  4. Extract Ed25519 public key from token
    │       │  5. Verify signature using Node.js crypto.verify()
    │       │  6. Check expiration timestamp
    │       └── PASS / FAIL (close 4001-4003)
    │
    ├─── Relationship Store
    │       │  7. Query by (patient_agent_id, provider_npi)
    │       │  8. Confirm status === 'active'
    │       └── FOUND / NOT FOUND (close 4004)
    │
    ├─── Session Manager
    │       │  9. Check per-provider concurrency limit
    │       │  10. Create RoutingSession record
    │       └── WITHIN LIMIT / EXCEEDED (close 4005)
    │
    ├─── Bridge
    │       │  11. Connect to provider CareAgent's local WebSocket endpoint
    │       │  12. Pipe messages bidirectionally (patient <-> provider)
    │       └── Session active until either side disconnects
    │
    └─── Audit Logger
            13. Log: connection.session_established
            14. Log: connection.session_terminated (on close)
```

### Flow 2: REST API Request

```
Third-Party Application
    │
    │  HTTP request with API key in Authorization header
    │
    ▼
Neuron HTTP Server (port 3000)
    │
    ├─── CORS Middleware
    │       │  Check Origin header against allowedOrigins config
    │       │  Set Access-Control-* response headers
    │       └── PASS / BLOCK (403)
    │
    ├─── Auth Middleware
    │       │  Extract API key from Authorization: Bearer <key>
    │       │  Look up key in local key store
    │       │  Check key not expired, not revoked
    │       └── VALID / INVALID (401)
    │
    ├─── Rate Limit Middleware
    │       │  Token bucket per API key
    │       │  Check remaining tokens
    │       └── ALLOWED / EXCEEDED (429 + Retry-After)
    │
    ├─── Route Dispatcher
    │       │  Match (method, path) to handler function
    │       │  Extract path params (:id, :npi)
    │       │  Parse query params (date range, status filter)
    │       └── MATCHED / NOT FOUND (404)
    │
    ├─── Route Handler
    │       │  Call domain module function (e.g., scheduling.listAppointments)
    │       │  Validate request body with TypeBox (POST/PATCH)
    │       │  Serialize response as JSON
    │       └── SUCCESS (200/201) / VALIDATION ERROR (400)
    │
    └─── Audit Logger
            Log: api.request (method, path, key label, status code)
```

### Flow 3: Consent Handshake (New Relationship Establishment)

```
Patient CareAgent                    Neuron                         Axon
    │                                  │                              │
    │  1. Connect to Neuron            │                              │
    │     (via Axon lookup             │                              │
    │      or mDNS discovery)          │                              │
    ├─────────────────────────────────>│                              │
    │                                  │                              │
    │  2. Neuron presents provider     │                              │
    │     credentials + relationship   │                              │
    │     terms (consented actions)    │                              │
    │<─────────────────────────────────┤                              │
    │                                  │                              │
    │  3. Patient reviews terms,       │                              │
    │     signs consent token with     │                              │
    │     Ed25519 private key          │                              │
    ├─────────────────────────────────>│                              │
    │                                  │                              │
    │                                  │  4. Verify token signature   │
    │                                  │  5. Create RelationshipRecord│
    │                                  │     (status: active)         │
    │                                  │  6. Log to audit trail       │
    │                                  │                              │
    │  7. Confirmation + relationship  │                              │
    │     ID returned to patient       │                              │
    │<─────────────────────────────────┤                              │
    │                                  │                              │
    │  8. Patient CareAgent writes     │                              │
    │     relationship to Patient      │                              │
    │     Chart (patient side, not     │                              │
    │     Neuron)                      │                              │
    │                                  │                              │
    │  9. Session established          │                              │
    │     (bidirectional bridge)       │                              │
    │<════════════════════════════════>│                              │
```

### Flow 4: Server Startup

```
neuron start
    │
    ├── 1. Load neuron.config.json
    │      Apply NEURON_ env overrides
    │      Validate against TypeBox NeuronConfig schema
    │      Validate all NPIs (Luhn check)
    │      FAIL FAST if invalid → exit(1) with clear error
    │
    ├── 2. Initialize infrastructure
    │      Create storage backend (JSON or SQLite)
    │      Create audit logger (open/create JSONL file)
    │      Log: admin.neuron_started
    │
    ├── 3. Load persisted state
    │      Registration state (organization + providers)
    │      Relationship records
    │      Scheduling data, billing data
    │
    ├── 4. Start heartbeat
    │      Begin periodic Axon updateEndpoint calls
    │      On failure: log warning, continue operating
    │
    ├── 5. Start listeners
    │      HTTP server on api.port (default 3000)
    │      WebSocket server on websocket.port (default 3002)
    │
    ├── 6. Start mDNS (if localNetwork.enabled)
    │      Advertise _careagent-neuron._tcp
    │      TXT record: org NPI, protocol version, local endpoint
    │
    └── 7. Ready
           All listeners active, heartbeat running
           Neuron is operational
```

### Key Data Flows

1. **Registration (outbound):** Neuron --> Axon. HTTP POST/PUT requests to register organization, register providers, update endpoint, refresh credentials. Bearer token authentication. Data flows outward; Axon never pushes to Neuron.

2. **Patient connection (inbound):** Patient CareAgent --> Neuron WebSocket. Consent token in handshake headers. After authentication, bidirectional message bridge to provider CareAgent. Neuron does not inspect message content.

3. **REST API (inbound):** Third-party app --> Neuron HTTP. API key in Authorization header. Request/response cycle. Read-only for relationships and organization data. CRUD for scheduling and billing.

4. **Chart sync (inbound):** Patient CareAgent --> Neuron over existing WebSocket session. Incremental delta of chart entries. Authorization checked against relationship consent scope. Cached locally; purged on revocation.

5. **Audit (internal):** Every domain module --> Audit Logger. Append-only. Hash-chained. Never read during normal operation (read only for verification or investigation).

6. **Local discovery (broadcast):** Neuron --> local network (mDNS multicast on 224.0.0.251:5353). Patient CareAgent scans for `_careagent-neuron._tcp` services. Connection proceeds through same WebSocket + consent pipeline as remote.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 providers, <100 relationships | File-backed JSON storage is fine. Single process handles all connections. mDNS on local network. This is the v1 target. |
| 5-50 providers, <1000 relationships | Migrate storage to SQLite for query performance and concurrent safety. Still single process. Add connection pooling for provider CareAgent WebSocket connections. |
| 50+ providers, 1000+ relationships | Multi-process deployment (v2). SQLite becomes a bottleneck -- consider PostgreSQL. Load balancer in front of multiple Neuron instances. Session affinity required for WebSocket connections. Audit log shipping to centralized store. |

### Scaling Priorities

1. **First bottleneck: Storage.** File-backed JSON loads the entire dataset into memory on every read and writes the entire file on every mutation. At ~1000 records across stores, this becomes noticeably slow. SQLite migration resolves this without architectural changes because of the storage abstraction layer.

2. **Second bottleneck: WebSocket concurrency.** A single Node.js process can handle ~10k concurrent WebSocket connections with the `ws` library before event loop saturation. For v1 this is not a concern. If needed, the `ws` server can be scaled by running multiple processes behind a load balancer with sticky sessions.

## Anti-Patterns

### Anti-Pattern 1: Fat Middleware (Leaking Domain Logic into Middleware)

**What people do:** Put business logic (consent verification, relationship lookup, scheduling validation) directly in REST middleware or WebSocket connection handlers.

**Why it's wrong:** Middleware becomes untestable without standing up the full HTTP/WS server. Domain logic gets scattered across two layers (middleware and domain modules). Changes to business rules require modifying infrastructure code.

**Do this instead:** Middleware handles protocol concerns only (extract API key, check rate limit, parse CORS). Route handlers call domain module functions. Domain modules are testable in isolation with no HTTP/WS dependency.

### Anti-Pattern 2: Over-Abstracting Storage

**What people do:** Build a full ORM or generic query builder as the storage abstraction, anticipating every possible future query pattern.

**Why it's wrong:** The Neuron has well-defined query patterns (by ID, by relationship_id, by date range, by status). A generic query language adds complexity without value. It also makes the SQLite migration harder because the abstraction must map to SQL, and a generic one maps poorly.

**Do this instead:** Define specific query methods on each store (e.g., `listAppointmentsByDateRange(start, end, providerId?)`) rather than a generic `query(filter)`. Each store knows its own access patterns. The storage interface is for basic CRUD; complex queries are store-specific methods.

### Anti-Pattern 3: Event-Driven Everything

**What people do:** Connect all modules through an event bus or pub/sub system, even in a single-process server, because it "decouples" modules.

**Why it's wrong:** For a single-process server with 9 domain modules, an event bus adds indirection without benefit. Debugging requires tracing event emissions and subscriptions across files. Error handling becomes ambiguous (who handles a failed event?). The system is harder to reason about than direct function calls.

**Do this instead:** Use direct function calls between modules with typed interfaces. Module A calls Module B's public function and handles the response. The dependency graph is visible in server.ts where modules are wired together. Events are appropriate only for the audit logger (fire-and-forget append) and potentially for session lifecycle notifications.

### Anti-Pattern 4: Shared Mutable State Across Modules

**What people do:** Multiple modules read and write to a shared in-memory data structure (e.g., a global relationships map that both the routing module and the API module mutate).

**Why it's wrong:** Race conditions in async code. No clear ownership of data. Mutations are not auditable because they bypass the store layer.

**Do this instead:** Each domain module owns its store. Other modules access data through the owning module's public API. The relationship store is owned by the relationships module; the routing module queries it, but never mutates it directly.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Axon Registry | Outbound HTTPS client (fetch/undici). Bearer token auth. Retry with exponential backoff on failure. | Axon is not yet built -- mock it in development. Interface must match AxonRegistry API from Axon PRD. |
| Provider CareAgents | Outbound WebSocket client connection to local endpoints. Established during session bridging. | Provider endpoints are configured in neuron.config.json. Connection is short-lived (per session). |
| Patient CareAgents | Inbound WebSocket connections. Patient discovers Neuron via Axon lookup or mDNS. | Neuron is passive -- it accepts connections, it does not initiate them to patients. |
| Local Network | mDNS multicast advertisement on 224.0.0.251:5353. Service type `_careagent-neuron._tcp`. | Requires a Node.js mDNS library (e.g., `multicast-dns` or `bonjour-service`). Lifecycle tied to server start/stop. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| routing --> consent | Direct function call: `consentVerifier.verify(token)` | Synchronous Ed25519 verification. No I/O. |
| routing --> relationships | Direct function call: `relationshipStore.findByPatientAndProvider(...)` | Async (storage I/O). Returns null if not found. |
| routing --> session-manager | Direct function call: `sessionManager.createBridge(ws, relationship)` | Creates bridge, tracks session. Returns session handle. |
| api/routes --> scheduling | Direct function call: `scheduling.listAppointments(filter)` | Route handlers are thin wrappers over domain module functions. |
| api/routes --> billing | Direct function call: `billing.createRecord(data)` | Same pattern as scheduling. |
| api/routes --> relationships | Direct function call: `relationships.list(filter)` | Read-only access. API never mutates relationships directly. |
| all domain modules --> audit | Direct function call: `auditLogger.log(eventType, details)` | Fire-and-forget append. Audit logger is injected into all domain modules. |
| all domain modules --> storage | Interface call: `store.get(id)`, `store.create(id, data)`, etc. | All persistence goes through the storage abstraction. Domain modules never touch the filesystem directly. |
| sync --> routing | Uses existing WebSocket session from routing module | Chart sync messages arrive on already-authenticated WebSocket connections. No separate connection. |
| termination --> relationships | Direct function call: `relationshipStore.update(id, { status: 'terminated' })` | Termination module coordinates the flow; relationships module owns the data. |
| termination --> routing | Direct function call: `sessionManager.terminateByRelationship(relationshipId)` | Active sessions for a terminated relationship are forcibly closed. |

## Build Order (Dependency Chain)

The following build order reflects the actual dependency graph between components. Each phase can only be built after its dependencies are complete.

```
Phase 1: Foundation
  types/ ──────────────┐
  config/ ─────────────┤
  audit/ ──────────────┤── No dependencies on each other.
  storage abstraction ─┤   Can be built in parallel.
  cli/ (stubs) ────────┘

      │
      ▼

Phase 2: Registration
  registration/ ──────── Depends on: config, storage, audit, types
  cli/ (init, provider)

      │
      ▼

Phase 3: Consent + Relationships + Termination
  consent/ ────────────── Depends on: types (no storage needed, stateless)
  relationships/ ──────── Depends on: consent, storage, audit, types
  termination/ ─────────── Depends on: relationships, audit, types

      │
      ▼

Phase 4: WebSocket Routing
  routing/ ──────────────── Depends on: consent, relationships, types, audit
    (websocket, session-manager, bridge)

      │
      ▼

Phase 5: mDNS Discovery
  discovery/ ────────────── Depends on: config, routing (shares WS infrastructure)

Phase 6: Scheduling + Billing (can parallel with Phase 4-5)
  scheduling/ ─────────── Depends on: relationships (relationship_id validation), storage, audit
  billing/ ────────────── Depends on: scheduling (appointment_id reference), relationships, storage, audit

      │
      ▼

Phase 7: REST API
  api/ ──────────────────── Depends on: scheduling, billing, relationships, registration
    (router, middleware, routes, openapi, api-keys)

      │
      ▼

Phase 8: Chart Sync
  sync/ ──────────────────── Depends on: routing (WS sessions), relationships (consent scope), storage, audit

      │
      ▼

Phase 9: Integration Testing + Documentation
  test/integration/ ──────── Depends on: all modules
  docs/ ──────────────────── Depends on: all modules
```

**Critical path:** Phase 1 --> Phase 2 --> Phase 3 --> Phase 4 --> Phase 7 (REST API needs routing for status reporting and all domain modules for data access).

**Parallelizable work:** Phase 6 (scheduling/billing) can be built in parallel with Phases 4-5, since scheduling/billing only depend on Phase 3 (relationships) for `relationship_id` validation. Phase 5 (mDNS) is a thin layer over Phase 4 and can be built immediately after.

**Late additions:** Phase 8 (chart sync) depends on both Phase 4 (WebSocket sessions) and Phase 3 (relationship consent scope). It does not block the REST API. Phase 9 (testing/docs) is naturally last.

## Sources

- [Node.js server without a framework (MDN)](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework) -- patterns for building HTTP servers on Node.js built-in `http` module
- [ws: Node.js WebSocket library (GitHub)](https://github.com/websockets/ws) -- the standard WebSocket implementation for Node.js
- [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html) -- built-in experimental SQLite module in Node.js 22+
- [Getting Started with Native SQLite in Node.js (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) -- practical guide to node:sqlite
- [TypeBox (GitHub)](https://github.com/sinclairzx81/typebox) -- JSON Schema Type Builder with Static Type Resolution for TypeScript
- [How to Implement Custom Middleware Pattern in Node.js (OneUptime)](https://oneuptime.com/blog/post/2026-01-30-how-to-implement-custom-middleware-pattern-in-nodejs/view) -- middleware pipeline patterns without frameworks
- [AuditableLLM: Hash-Chain-Backed Auditable Framework (MDPI)](https://www.mdpi.com/2079-9292/15/1/56) -- hash-chained JSONL audit log implementation reference
- [Efficient Data Structures for Tamper-Evident Logging (Crosby & Wallach, USENIX 2009)](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf) -- foundational work on tamper-evident logging
- [multicast-dns (npm)](https://www.npmjs.com/package/multicast-dns) -- pure JavaScript mDNS implementation for Node.js
- [How to Use Hexadecimal Ed25519 Public Keys in Node.js (Keygen)](https://keygen.sh/blog/how-to-use-hexadecimal-ed25519-keys-in-node/) -- Ed25519 key handling with Node.js crypto
- [Node.js Crypto documentation](https://nodejs.org/api/crypto.html) -- Ed25519 signature operations via crypto.sign() and crypto.verify()
- [How to Build a Unified API Gateway for Healthcare (CapMinds)](https://www.capminds.com/blog/how-to-build-a-unified-api-gateway-for-patient-facing-and-internal-applications/) -- healthcare API gateway architectural patterns
- [Top Node.js Design Patterns 2026 (NareshIT)](https://nareshit.com/blogs/top-nodejs-design-patterns-2026) -- current Node.js architectural patterns

---
*Architecture research for: Healthcare organizational endpoint server (CareAgent Neuron)*
*Researched: 2026-02-21*
