# CLAUDE.md -- @careagent/neuron

## Project Overview

Neuron is the **organizational boundary server** for the CareAgent ecosystem. It runs at a healthcare organization (clinic, hospital, practice group) and manages the consent handshake between patient CareAgents and provider agents. Neuron handles relationship lifecycle, WebSocket-based protocol sessions, mDNS discovery, REST API for organization management, and hash-chained audit logging. It stores all state in a local SQLite database via better-sqlite3.

## The Irreducible Risk Hypothesis

Clinical AI agents carry irreducible risk of harm. Neuron manages this risk as the **organizational gatekeeper** -- every patient-provider connection must pass through a consent handshake with Ed25519 token verification before any clinical data flows. Neuron enforces a safety ceiling on concurrent handshakes (queues rather than rejects -- "no patient CareAgent should ever be turned away") and maintains a tamper-evident hash-chained audit log of every security-relevant event.

## Directory Structure

```
neuron/
  bin/                  # CLI entry point
  src/
    api/                # REST API server
      routes/           # Route handlers (relationships, status, organization, openapi)
      router.ts         # HTTP request router
      keys.ts           # API key management
      rate-limiter.ts   # Rate limiting
    audit/              # Hash-chained JSONL audit logger + chain verifier
    cli/                # Commander-based CLI
      commands/         # init, start, stop, status, discover, provider, api-key, verify-audit
    config/             # Configuration loader and defaults
    consent/            # Ed25519 consent token verifier, challenge-response
    discovery/          # mDNS/DNS-SD service advertisement (bonjour-service)
    ipc/                # Unix domain socket IPC (client/server)
    registration/       # Axon registry registration + heartbeat
    relationships/      # Relationship store, consent handshake handler, termination
    routing/            # WebSocket protocol server + session management
    storage/            # SQLite storage layer + 5 migrations
    types/              # TypeBox schemas (config, audit, registration, relationships, etc.)
    validators/         # NPI Luhn-10 validator
    index.ts            # Public API (re-exports types only)
  test/                 # Co-located unit tests (*.test.ts in src/) + test/ directory
  tests/                # Additional test files
```

## Commands

```bash
pnpm build             # Build with tsdown
pnpm test              # Run tests: vitest run
pnpm test:watch        # Watch mode: vitest
pnpm test:coverage     # Coverage: vitest run --coverage
pnpm dev               # Dev mode: tsx src/cli/index.ts
pnpm lint              # Type check: tsc --noEmit
```

## Code Conventions

- **ESM-only** -- `"type": "module"` in package.json. All imports use `.js` extensions.
- **TypeBox for all schemas** -- `@sinclair/typebox` is a runtime dependency. Schemas in `src/types/*.ts`. Use `Type.Object()`, `Type.Union()`, `Type.Literal()` patterns.
- **TypeScript types derived from TypeBox** -- `type Foo = Static<typeof FooSchema>`. Do NOT define standalone interfaces when a schema exists.
- **Barrel exports** -- every subdirectory has an `index.ts`.
- **Co-located tests** -- unit tests live alongside source files as `*.test.ts`. Additional tests in `test/` and `tests/` directories.
- **Naming**: PascalCase for classes and schemas (suffix `Schema`), camelCase for functions, UPPER_SNAKE for constants.
- **better-sqlite3** for all persistent storage -- synchronous API, WAL mode, transactions via `db.transaction()`.
- **Node.js >= 20.19.0** required.
- **pnpm** as package manager.
- **Vitest** for testing.

## Anti-Patterns

- **Do NOT add additional npm runtime dependencies** without careful consideration. Neuron intentionally keeps a minimal dependency surface (better-sqlite3, ws, bonjour-service, commander, typebox).
- **Do NOT use async SQLite.** better-sqlite3 is synchronous by design. Never wrap it in promises or use async patterns for DB calls.
- **Do NOT skip audit logging for security-relevant events.** Every handshake attempt, relationship change, consent verification, and API key operation must be logged to the hash-chained audit trail.
- **Do NOT break the audit hash chain.** The genesis hash is 64 zeros. Each subsequent entry's `prev_hash` is the SHA-256 of the previous entry's canonical JSON. Never edit or delete audit entries.
- **Do NOT reject connections when the handshake ceiling is reached.** Queue them instead (safety ceiling behavior).
- **Do NOT use relative imports without `.js` extension.** ESM requires explicit extensions.
- **Do NOT verify consent token contents.** Neuron verifies the Ed25519 signature on consent tokens but treats `consented_actions` as opaque (CSNT-04). Only the patient agent decides what actions are consented.

## Key Technical Details

### Database Migrations (5 versions)

Migrations are defined in `src/storage/migrations.ts` and run automatically on startup:

1. Core tables: relationships, appointments, billing, termination, chart cache, sync state
2. Registration tables: neuron_registration, provider_registrations
3. Add patient_public_key to relationships
4. API keys table for REST API authentication
5. Provider name, types, and specialty columns

### WebSocket Consent Handshake

The routing server (`src/routing/server.ts`) uses `ws` in noServer mode attached to `node:http`. Sessions go through challenge-response with Ed25519 consent tokens. The `HandshakeSessionManager` tracks active sessions. When `maxConcurrentHandshakes` is reached, new connections are queued (never rejected).

### Ed25519 Consent Tokens

Consent tokens (`src/consent/token.ts`) contain:
- `patient_agent_id`, `provider_npi`, `consented_actions[]`
- `exp` and `iat` Unix timestamps
- Optional `nonce` for replay prevention

The verifier checks the Ed25519 signature against the patient's public key. The `consented_actions` list is opaque to Neuron.

### mDNS Discovery

`src/discovery/service.ts` uses bonjour-service to advertise `_careagent-neuron._tcp` with TXT records: `npi`, `ver` (protocol version), `ep` (WebSocket endpoint URL). Follows RFC 6763 Section 6.4 key naming.

### Hash-Chained Audit

`src/audit/logger.ts` -- append-only JSONL format. Each entry has a SHA-256 hash linking to the previous entry (genesis = 64 zeros). Entries are canonicalized before hashing. The `verify-audit` CLI command validates chain integrity.

### CLI Commands

`init`, `start`, `stop`, `status`, `discover`, `provider`, `api-key`, `verify-audit` -- all via Commander.

### REST API

Routes: `/status`, `/relationships`, `/organization`, `/openapi`. API key authentication with SHA-256 hashed keys stored in SQLite.
