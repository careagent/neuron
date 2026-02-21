# Phase 1: Foundation - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The Neuron can load validated configuration, persist data to SQLite, produce tamper-evident hash-chained audit logs, validate NPI numbers, and expose a CLI skeleton with stub commands. This phase delivers the infrastructure layer that every subsequent phase builds on — no network, no WebSockets, no external connections.

</domain>

<decisions>
## Implementation Decisions

### Project scaffold
- pnpm workspace with TypeScript ~5.7.x, tsdown ~0.20.x for build, vitest ~4.0.x for testing
- 80% coverage thresholds enforced
- Single `src/` directory with module-per-concern structure (not monorepo)
- Entry point: `src/cli/index.ts` → `bin/neuron`

### Configuration system
- TypeBox schema defines `neuron.config.json` structure with all fields typed
- Config loader: read file → apply `NEURON_` env var overrides → validate against schema
- Invalid config = clear error message + `process.exit(1)` — never start with bad config
- Environment variables override nested config via `NEURON_SERVER_PORT` → `server.port` convention (double underscore for nesting: `NEURON_SERVER__PORT`)

### Storage engine
- SQLite via better-sqlite3 from day one (research recommendation — query patterns demand indexing)
- Thin storage abstraction interface so tests can use in-memory SQLite
- Storage path configurable in `neuron.config.json`, defaults to `./data/neuron.db`
- Schema migrations embedded in code (simple version table + up migrations)

### Audit logging
- Hash-chained JSONL file: each entry contains SHA-256 hash of previous entry for tamper evidence
- Deterministic JSON serialization (sorted keys) before hashing
- Event categories: registration, connection, consent, api_access, sync, admin, termination
- Audit chain integrity verification utility as a standalone function (used by CLI and tests)
- Audit log path configurable, defaults to `./data/audit.jsonl`

### NPI validation
- Pure utility function: 10-digit format check + Luhn check digit algorithm
- Used for organization NPI at startup and provider NPIs at registration
- Reusable across organization and provider validation contexts

### CLI design
- Commander.js (commander ^14) for CLI framework
- Stub commands for v1: `neuron init`, `neuron start`, `neuron stop`, `neuron status`
- `neuron init` generates a starter `neuron.config.json` interactively
- `neuron start` loads config, validates, initializes storage, starts audit logger
- All CLI output follows a consistent format (no emojis, clear error/success messages)

### TypeBox schemas
- All core data model schemas exported from `src/types/`
- Models: NeuronConfig, RelationshipRecord, Appointment, ProviderAvailability, BillingRecord, CPTEntry, AuditEntry, TerminationRecord, CachedChartEntry, SyncState
- Schemas used for both validation and TypeScript type inference (`Static<typeof Schema>`)
- Shared ID format: UUIDs for relationship_id, appointment_id, billing_id; 10-digit strings for NPIs

### Claude's Discretion
- Exact directory structure within `src/` (module naming, barrel exports vs direct imports)
- SQLite schema design (table names, column types, index strategy)
- Audit entry serialization format details beyond the hash chain requirement
- Commander.js command organization (single file vs per-command files)
- Error message wording and formatting
- Test file organization and naming conventions

</decisions>

<specifics>
## Specific Ideas

- Storage abstraction should make it trivial to swap SQLite for PostgreSQL in v2 (but don't over-abstract — just interface + one implementation)
- Config validation errors should tell you exactly which field failed and why, not just "invalid config"
- The audit chain must be verifiable offline — no external dependencies for integrity check
- NPI Luhn check follows the standard CMS algorithm (multiply alternating digits by 2, sum, check mod 10)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-02-21*
