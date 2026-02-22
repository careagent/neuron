# Phase 1: Foundation - Research

**Researched:** 2026-02-21
**Domain:** TypeScript project scaffold, config validation, SQLite storage, audit logging, NPI validation, CLI framework
**Confidence:** HIGH

## Summary

Phase 1 establishes the infrastructure layer for the Neuron server. The technology stack is well-defined by user decisions: pnpm + TypeScript 5.7.x, tsdown 0.20.x for builds, vitest 4.0.x for testing, TypeBox for schema validation, better-sqlite3 for storage, and Commander.js v14 for CLI. All are mature, actively maintained libraries with large ecosystems.

The primary technical challenges are: (1) implementing a correct hash-chained JSONL audit log with deterministic serialization, (2) correctly implementing the NPI Luhn check digit algorithm with the CMS-specific constant 24 prefix, and (3) designing a storage abstraction that's thin enough to not over-engineer but flexible enough for a future PostgreSQL swap.

**Primary recommendation:** Build module-by-module with TypeBox schemas as the shared foundation -- schemas first, then config, storage, audit, NPI validation, and CLI last since it wires everything together.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- pnpm workspace with TypeScript ~5.7.x, tsdown ~0.20.x for build, vitest ~4.0.x for testing
- 80% coverage thresholds enforced
- Single `src/` directory with module-per-concern structure (not monorepo)
- Entry point: `src/cli/index.ts` -> `bin/neuron`
- TypeBox schema defines `neuron.config.json` structure with all fields typed
- Config loader: read file -> apply `NEURON_` env var overrides -> validate against schema
- Invalid config = clear error message + `process.exit(1)` -- never start with bad config
- Environment variables override nested config via `NEURON_SERVER_PORT` -> `server.port` convention (double underscore for nesting: `NEURON_SERVER__PORT`)
- SQLite via better-sqlite3 from day one
- Thin storage abstraction interface so tests can use in-memory SQLite
- Storage path configurable in `neuron.config.json`, defaults to `./data/neuron.db`
- Schema migrations embedded in code (simple version table + up migrations)
- Hash-chained JSONL file: each entry contains SHA-256 hash of previous entry for tamper evidence
- Deterministic JSON serialization (sorted keys) before hashing
- Event categories: registration, connection, consent, api_access, sync, admin, termination
- Audit chain integrity verification utility as a standalone function
- Audit log path configurable, defaults to `./data/audit.jsonl`
- Pure utility function for NPI: 10-digit format check + Luhn check digit algorithm
- Commander.js (commander ^14) for CLI framework
- Stub commands: `neuron init`, `neuron start`, `neuron stop`, `neuron status`
- All TypeBox schemas for core data models exported from `src/types/`

### Claude's Discretion
- Exact directory structure within `src/` (module naming, barrel exports vs direct imports)
- SQLite schema design (table names, column types, index strategy)
- Audit entry serialization format details beyond the hash chain requirement
- Commander.js command organization (single file vs per-command files)
- Error message wording and formatting
- Test file organization and naming conventions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUN-01 | pnpm TypeScript project scaffold with tsdown build, vitest testing | Standard stack section: tsdown 0.20.x, vitest 4.0.x, TypeScript 5.7.x |
| FOUN-02 | TypeBox schema for `neuron.config.json` with full validation at startup | TypeBox 0.34.x patterns, `Type.Object` + `Value.Check` + `Value.Errors` |
| FOUN-03 | Configuration loader reads config file, applies NEURON_ env overrides, validates | Config loader pattern with env var mapping (`__` -> nested path) |
| FOUN-04 | Invalid configuration prevents startup with clear error messages and non-zero exit | TypeBox `Value.Errors()` for detailed field-level error messages |
| FOUN-05 | NPI validation utility (10-digit format, Luhn check) | CMS Luhn algorithm with constant 24 prefix documented |
| FOUN-06 | CLI entry point with stub commands | Commander.js v14 patterns, per-command file organization |
| FOUN-07 | Storage abstraction interface with SQLite implementation | better-sqlite3 12.x patterns, in-memory mode for tests |
| FOUN-08 | All TypeBox schemas for core data models exported from `src/types/` | TypeBox `Static<typeof Schema>` pattern for type inference |
| AUDT-01 | Hash-chained JSONL audit log with SHA-256 tamper-evident chain | Hash chain pattern: `prev_hash` -> SHA-256(canonical JSON) -> `hash` |
| AUDT-02 | Audit events for: registration, connection, consent, API access, sync, admin, termination | Event category enum with TypeBox union types |
| AUDT-03 | Audit chain integrity verification utility | Chain walk algorithm: read line-by-line, verify hash linkage |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | ~5.7.x | Type system and compiler | User-specified; current stable TypeScript |
| @sinclair/typebox | ^0.34.48 | JSON Schema + TypeScript type inference | User-specified; generates runtime schemas that infer as TS types via `Static<typeof>` |
| better-sqlite3 | ^12.6.2 | SQLite database driver | User-specified; synchronous API, fastest Node.js SQLite driver, native bindings |
| commander | ^14.0.3 | CLI framework | User-specified; most widely-used Node.js CLI framework (114K+ dependents) |
| tsdown | ~0.20.3 | TypeScript/JS bundler | User-specified; Rolldown-powered bundler, fast builds, .d.ts generation |
| vitest | ~4.0.18 | Test framework | User-specified; Vite-powered, ESM-native, compatible with Jest API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/better-sqlite3 | latest | TypeScript types for better-sqlite3 | Always -- better-sqlite3 ships no built-in types |
| pnpm | ^9.x | Package manager | User-specified; workspace support, fast, disk-efficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | sql.js (WASM) | sql.js is pure JS (no native build) but slower and higher memory for production use |
| TypeBox | Zod | Zod is more popular but doesn't generate JSON Schema; TypeBox is both validator and schema |
| commander | yargs/oclif | Commander is lighter-weight, sufficient for this CLI complexity level |
| tsdown | tsup | tsup is more mature but tsdown is Rolldown-powered (faster), user-specified |

**Installation:**
```bash
pnpm add @sinclair/typebox better-sqlite3 commander
pnpm add -D typescript tsdown vitest @types/better-sqlite3 @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli/                # CLI entry point and commands
│   ├── index.ts        # Commander program setup, bin entry
│   ├── commands/       # Per-command files
│   │   ├── init.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   └── status.ts
│   └── output.ts       # Consistent output formatting utilities
├── config/             # Configuration loading and validation
│   ├── schema.ts       # TypeBox schema for neuron.config.json
│   ├── loader.ts       # File read + env override + validate
│   └── defaults.ts     # Default configuration values
├── storage/            # Storage abstraction + SQLite implementation
│   ├── interface.ts    # Storage interface definition
│   ├── sqlite.ts       # better-sqlite3 implementation
│   └── migrations.ts   # Schema versioning and migrations
├── audit/              # Audit logging system
│   ├── logger.ts       # Append-only hash-chained logger
│   ├── verifier.ts     # Chain integrity verification
│   └── serialize.ts    # Deterministic JSON serialization
├── validators/         # Validation utilities
│   └── npi.ts          # NPI format + Luhn check digit
└── types/              # TypeBox schema definitions (shared)
    ├── index.ts        # Barrel export of all schemas
    ├── config.ts       # NeuronConfig schema
    ├── relationship.ts # RelationshipRecord schema
    ├── appointment.ts  # Appointment, ProviderAvailability schemas
    ├── billing.ts      # BillingRecord, CPTEntry schemas
    ├── audit.ts        # AuditEntry schema
    ├── termination.ts  # TerminationRecord schema
    ├── sync.ts         # CachedChartEntry, SyncState schemas
    └── common.ts       # Shared types (IDs, enums, timestamps)
```

### Pattern 1: TypeBox Schema + Static Type Inference
**What:** Define runtime-validatable JSON Schema objects that automatically infer TypeScript types
**When to use:** Every data model definition
**Example:**
```typescript
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

// Define schema (runtime JSON Schema object)
const NeuronConfig = Type.Object({
  organization: Type.Object({
    npi: Type.String({ pattern: '^\\d{10}$' }),
    name: Type.String({ minLength: 1 }),
    type: Type.Union([
      Type.Literal('practice'),
      Type.Literal('hospital'),
      Type.Literal('pharmacy'),
      Type.Literal('imaging_center'),
      Type.Literal('laboratory'),
      Type.Literal('urgent_care'),
      Type.Literal('specialty_clinic'),
      Type.Literal('other')
    ])
  }),
  server: Type.Object({
    port: Type.Number({ minimum: 1, maximum: 65535, default: 3000 }),
    host: Type.String({ default: '0.0.0.0' })
  }),
  storage: Type.Object({
    path: Type.String({ default: './data/neuron.db' })
  }),
  audit: Type.Object({
    path: Type.String({ default: './data/audit.jsonl' })
  })
})

// Infer TypeScript type from schema
type NeuronConfig = Static<typeof NeuronConfig>

// Validate at runtime
function validateConfig(data: unknown): NeuronConfig {
  if (Value.Check(NeuronConfig, data)) {
    return data
  }
  // Collect all errors for clear reporting
  const errors = [...Value.Errors(NeuronConfig, data)]
  throw new ConfigValidationError(errors)
}
```

### Pattern 2: Environment Variable Override with Double Underscore Nesting
**What:** Map `NEURON_` prefixed env vars to nested config paths
**When to use:** Configuration loading
**Example:**
```typescript
function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const prefix = 'NEURON_'
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue
    // NEURON_SERVER__PORT -> server.port
    const path = key.slice(prefix.length).toLowerCase().split('__')
    setNestedValue(config, path, coerceValue(value))
  }
  return config
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current) || typeof current[path[i]] !== 'object') {
      current[path[i]] = {}
    }
    current = current[path[i]] as Record<string, unknown>
  }
  current[path[path.length - 1]] = value
}
```

### Pattern 3: Storage Abstraction Interface
**What:** Thin interface over database operations; SQLite implementation underneath
**When to use:** All data persistence
**Example:**
```typescript
// Interface — thin, not over-abstracted
interface StorageEngine {
  initialize(): void
  close(): void
  run(sql: string, params?: unknown[]): void
  get<T>(sql: string, params?: unknown[]): T | undefined
  all<T>(sql: string, params?: unknown[]): T[]
  transaction<T>(fn: () => T): T
}

// SQLite implementation
class SqliteStorage implements StorageEngine {
  private db: Database

  constructor(path: string) {
    // path = ':memory:' for tests
    this.db = new BetterSqlite3(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  initialize(): void {
    this.runMigrations()
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
  // ... other methods wrap db calls
}
```

### Pattern 4: Hash-Chained Audit Log
**What:** Each JSONL entry includes SHA-256 hash of previous entry, forming a tamper-evident chain
**When to use:** All auditable events
**Example:**
```typescript
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

function canonicalize(obj: Record<string, unknown>): string {
  // Deterministic JSON: sorted keys recursively
  return JSON.stringify(obj, Object.keys(obj).sort())
}

function hashEntry(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex')
}

class AuditLogger {
  private lastHash: string = '0'.repeat(64) // genesis hash

  append(event: AuditEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      sequence: this.sequence++,
      category: event.category,
      action: event.action,
      details: event.details,
      prev_hash: this.lastHash,
    }
    const canonical = canonicalize(entry)
    const hash = hashEntry(canonical)
    const record = { ...entry, hash }
    const line = JSON.stringify(record)
    appendFileSync(this.auditPath, line + '\n')
    this.lastHash = hash
  }
}
```

### Anti-Patterns to Avoid
- **Over-abstracting storage:** Don't create repository classes per entity in Phase 1. A thin `StorageEngine` interface with raw SQL is sufficient. Repositories come later when query patterns are established.
- **Config validation at use-site:** Validate once at startup, pass typed config everywhere. Never re-validate or check `undefined` at point of use.
- **Mutable config after startup:** Config should be immutable after validation. Use `Object.freeze()` or readonly types.
- **Non-deterministic JSON serialization:** `JSON.stringify` key order depends on insertion order. MUST sort keys recursively for audit hash consistency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema validation | Custom validator | TypeBox `Value.Check()` + `Value.Errors()` | Edge cases in format validation, nested errors, type coercion |
| CLI argument parsing | Manual argv parsing | Commander.js | Subcommands, help generation, option types, error handling |
| SQLite connection management | Custom connection pool | better-sqlite3 (synchronous) | better-sqlite3 is synchronous by design; no connection pool needed |
| UUID generation | Custom ID generator | `crypto.randomUUID()` | Built into Node.js 19+, cryptographically secure |
| Luhn check digit | Random npm package | Hand-roll (it's 15 lines) | NPI Luhn has a CMS-specific constant (24) that generic Luhn libraries don't handle |

**Key insight:** The NPI Luhn algorithm is one of the few things worth hand-rolling because the CMS-specific constant 24 (from the "80840" prefix) makes generic Luhn libraries incorrect for NPI validation.

## Common Pitfalls

### Pitfall 1: Non-Deterministic JSON Serialization for Audit Hashing
**What goes wrong:** `JSON.stringify()` produces different key orders depending on object creation order, breaking hash chain verification across restarts or different code paths
**Why it happens:** JavaScript object property order follows insertion order, not alphabetical order. Two objects with the same data created differently produce different JSON strings.
**How to avoid:** Always use a recursive key-sorting serializer. The `canonicalize()` function must handle nested objects and arrays correctly.
**Warning signs:** Audit chain verification fails intermittently; works in tests but fails in production.

### Pitfall 2: NPI Luhn Algorithm Without the Constant 24
**What goes wrong:** Generic Luhn implementations validate credit card numbers but reject valid NPIs (or accept invalid ones)
**Why it happens:** The NPI Luhn check uses the ISO standard with a CMS-specific modification: add 24 to the digit sum for 10-position NPIs to account for the implicit "80840" prefix
**How to avoid:** Implement the CMS-specific algorithm: (1) double alternate digits from right, (2) sum all digits, (3) add 24, (4) check mod 10 === 0
**Warning signs:** Known-valid NPIs fail validation; test with published NPI examples from CMS

### Pitfall 3: better-sqlite3 WAL Mode Not Enabled
**What goes wrong:** Concurrent reads block during writes, causing performance issues when audit logging happens during request handling
**Why it happens:** SQLite defaults to rollback journal mode. WAL (Write-Ahead Logging) mode allows concurrent reads during writes.
**How to avoid:** Set `db.pragma('journal_mode = WAL')` immediately after opening the database connection
**Warning signs:** Intermittent "database is locked" errors under load

### Pitfall 4: TypeBox Value.Errors() Returns an Iterator, Not an Array
**What goes wrong:** Calling `Value.Errors()` and treating the result as an array loses errors or causes confusing behavior
**Why it happens:** `Value.Errors()` returns a generator/iterator for performance. Must spread or iterate to collect all errors.
**How to avoid:** Always use `[...Value.Errors(schema, data)]` or iterate with `for...of`
**Warning signs:** Only first validation error reported; error count inconsistent

### Pitfall 5: Env Var Type Coercion
**What goes wrong:** Environment variables are always strings; `NEURON_SERVER__PORT=3000` sets `server.port` to the string `"3000"` instead of the number `3000`, failing TypeBox number validation
**Why it happens:** `process.env` values are always strings
**How to avoid:** Implement type coercion in the env override layer: detect numeric strings, booleans ("true"/"false"), and convert before merging with config
**Warning signs:** Config validation fails for numeric/boolean fields set via environment variables

### Pitfall 6: Audit Log File Corruption on Crash
**What goes wrong:** Partial writes leave a truncated JSON line at the end of the audit JSONL file
**Why it happens:** `appendFileSync` can be interrupted by process crash mid-write
**How to avoid:** On startup, read the last line of the audit file; if it's not valid JSON, truncate it and log a warning. The hash chain will still be verifiable up to the last complete entry.
**Warning signs:** Audit verification fails after unclean shutdown; last entry is corrupted

## Code Examples

### NPI Luhn Validation (CMS Algorithm)
```typescript
/**
 * Validates an NPI using the CMS Luhn check digit algorithm.
 * The NPI is a 10-digit number where the last digit is a check digit.
 * For 10-position NPIs, add constant 24 to account for "80840" prefix.
 *
 * Source: https://www.eclaims.com/articles/how-to-calculate-the-npi-check-digit/
 */
export function isValidNpi(npi: string): boolean {
  // Must be exactly 10 digits
  if (!/^\d{10}$/.test(npi)) return false

  const digits = npi.split('').map(Number)
  let sum = 24 // Constant for 10-position NPI ("80840" prefix)

  // Process digits right-to-left, doubling alternate digits
  // Starting from the rightmost digit (check digit), double every second digit
  for (let i = digits.length - 2; i >= 0; i--) {
    // Odd positions from right (0-indexed from left: 8, 6, 4, 2, 0) get doubled
    const isAlternate = (digits.length - 1 - i) % 2 === 1
    if (isAlternate) {
      let doubled = digits[i] * 2
      if (doubled > 9) doubled -= 9 // Same as summing digits (e.g., 16 -> 1+6=7, or 16-9=7)
      sum += doubled
    } else {
      sum += digits[i]
    }
  }

  // Add the check digit
  sum += digits[digits.length - 1]

  return sum % 10 === 0
}
```

### Deterministic JSON Canonicalization
```typescript
/**
 * Produces deterministic JSON by sorting object keys recursively.
 * Arrays maintain their order (elements are not sorted).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort()
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + canonicalize((value as Record<string, unknown>)[key])
  )
  return '{' + pairs.join(',') + '}'
}
```

### better-sqlite3 Migration Pattern
```typescript
import Database from 'better-sqlite3'

interface Migration {
  version: number
  description: string
  up: string
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create schema version table and core tables',
    up: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      );
      CREATE TABLE IF NOT EXISTS relationships (
        relationship_id TEXT PRIMARY KEY,
        patient_agent_id TEXT NOT NULL,
        provider_npi TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_rel_patient ON relationships(patient_agent_id);
      CREATE INDEX idx_rel_provider ON relationships(provider_npi);
      CREATE INDEX idx_rel_status ON relationships(status);
    `
  }
]

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
  )`)

  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null }

  const current = currentVersion?.version ?? 0

  const pending = migrations.filter((m) => m.version > current)
  if (pending.length === 0) return

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.up)
      db.prepare(
        'INSERT INTO schema_version (version, description) VALUES (?, ?)'
      ).run(migration.version, migration.description)
    }
  })
  runAll()
}
```

### Commander.js v14 CLI Setup
```typescript
import { Command } from 'commander'

const program = new Command()

program
  .name('neuron')
  .description('CareAgent organizational boundary server')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize a new Neuron configuration')
  .action(async () => {
    // Interactive config generation
  })

program
  .command('start')
  .description('Start the Neuron server')
  .option('-c, --config <path>', 'Config file path', 'neuron.config.json')
  .action(async (options) => {
    // Load config -> validate -> init storage -> start audit -> start server
  })

program
  .command('stop')
  .description('Stop the Neuron server')
  .action(async () => {
    // Graceful shutdown
  })

program
  .command('status')
  .description('Show Neuron server status')
  .action(async () => {
    // Check running state and display info
  })

program.parse()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tsup for TS library bundling | tsdown (Rolldown-powered) | 2025 | Faster builds, same config patterns, Rust-based engine |
| Jest for testing | Vitest 4.0 | 2024-2025 | ESM-native, faster, compatible API, browser mode stable |
| Zod for validation | TypeBox for JSON Schema + TS types | 2023-2024 | TypeBox generates actual JSON Schema (not just TS types), better for config files |
| node-sqlite3 (async) | better-sqlite3 (sync) | 2020+ | Synchronous API is simpler, faster for single-process servers, no callback hell |
| Manual JSON schema | TypeBox Type.Object() | 2023+ | Single source of truth for runtime validation AND TypeScript types |

**Deprecated/outdated:**
- `ts-node`: Use `tsx` for development, `tsdown` for production builds
- `jest`: Vitest is the standard for new TypeScript projects
- `node-sqlite3`: better-sqlite3 is the preferred SQLite driver for Node.js

## Open Questions

1. **TypeBox `Value.Default()` for config defaults**
   - What we know: TypeBox supports `default` in schema definitions and `Value.Default()` to apply them
   - What's unclear: Whether `Value.Default()` mutates in place or returns a new object in current 0.34.x
   - Recommendation: Test behavior; if it mutates, clone config before applying defaults

2. **Audit log rotation**
   - What we know: Phase 1 only needs append-only JSONL with hash chain
   - What's unclear: Whether log rotation should be handled in Phase 1 or deferred
   - Recommendation: Defer rotation to a later phase; Phase 1 just appends. Document that rotation must preserve chain integrity.

## Sources

### Primary (HIGH confidence)
- [npm: @sinclair/typebox](https://www.npmjs.com/package/@sinclair/typebox) - Version 0.34.48, API patterns
- [npm: better-sqlite3](https://www.npmjs.com/package/better-sqlite3) - Version 12.6.2, synchronous API
- [npm: commander](https://www.npmjs.com/package/commander) - Version 14.0.3, CLI framework
- [npm: tsdown](https://www.npmjs.com/package/tsdown) - Version 0.20.3, bundler configuration
- [npm: vitest](https://www.npmjs.com/package/vitest) - Version 4.0.18, test framework
- [Eclaims NPI Check Digit](https://www.eclaims.com/articles/how-to-calculate-the-npi-check-digit/) - CMS Luhn algorithm

### Secondary (MEDIUM confidence)
- [Wikipedia: NPI](https://en.wikipedia.org/wiki/National_Provider_Identifier) - NPI format and structure
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) - Breaking changes and new features
- [tsdown.dev](https://tsdown.dev/guide/) - Configuration and setup guide

### Tertiary (LOW confidence)
- [Clawprint hash chain pattern](https://github.com/cyntrisec/clawprint) - Hash chain implementation reference (third-party, not official)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are user-specified with pinned version ranges; verified current versions on npm
- Architecture: HIGH - Patterns are well-established for these libraries; TypeBox + better-sqlite3 + Commander.js are mature
- Pitfalls: HIGH - Hash chain determinism and NPI Luhn constant are well-documented issues; better-sqlite3 WAL mode is standard practice

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days - stable stack, no fast-moving dependencies)
