# @careagent/neuron

## What This Is

A standalone Node.js server that serves as the organization-level endpoint for NPI-holding healthcare organizations in the CareAgent ecosystem. The Neuron is the "organizational membrane" between the national Axon network and individual provider CareAgents — it routes patient connections via a broker-and-step-out WebSocket protocol, verifies Ed25519 consent tokens on every connection, advertises on the local network via mDNS, and exposes an authenticated REST API for third-party integrations. Free, open-source infrastructure (Apache 2.0) for any organization that participates in patient care.

## Core Value

Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections to the correct provider, verifies consent before any communication, and never holds clinical data.

## Requirements

### Validated

- ✓ pnpm TypeScript project scaffold with tsdown/vitest — v1.0
- ✓ TypeBox configuration schema with validation at startup — v1.0
- ✓ Configuration loader with NEURON_ env overrides — v1.0
- ✓ Invalid config prevents startup with clear errors — v1.0
- ✓ NPI validation (10-digit format, Luhn check) — v1.0
- ✓ CLI entry point (init, start, stop, status) — v1.0 (stop wired to IPC in Phase 8)
- ✓ SQLite storage with migration system — v1.0
- ✓ TypeBox schemas exported from src/types/ — v1.0
- ✓ Hash-chained JSONL audit log with SHA-256 tamper-evident chain — v1.0
- ✓ Audit events for 6 categories (registration, connection, consent, api_access, admin, termination) — v1.0
- ✓ Audit chain integrity verification via `neuron verify-audit` CLI — v1.0
- ✓ Organization and provider registration with Axon using NPI — v1.0
- ✓ Periodic heartbeat to maintain reachable status — v1.0
- ✓ Dynamic provider management (add/remove/update without restart) — v1.0
- ✓ Registration state persistence across restarts — v1.0
- ✓ Graceful degradation when Axon is unreachable — v1.0
- ✓ Mock Axon registry for development and testing — v1.0
- ✓ Ed25519 consent token verification (stateless, every connection) — v1.0
- ✓ Expired tokens rejected with specific error code — v1.0
- ✓ Consent scope passed to provider CareAgent — v1.0
- ✓ RelationshipRecord store with persistence — v1.0
- ✓ Consent handshake handler (Neuron side of Axon protocol) — v1.0
- ✓ Relationship queries by patient, provider, relationship ID, status — v1.0
- ✓ Challenge-response identity verification — v1.0
- ✓ Provider-initiated termination with state protocol compliance — v1.0
- ✓ Terminated relationships permanently stop routing — v1.0
- ✓ TerminationRecord persistence with audit linkage — v1.0
- ✓ WebSocket server for inbound patient CareAgent connections — v1.0
- ✓ Connection authentication: consent → relationship check → route — v1.0
- ✓ Broker-and-step-out handshake with global safety ceiling (queuing) — v1.0
- ✓ Graceful session cleanup on disconnect — v1.0
- ✓ Implements ProtocolServer interface from provider-core — v1.0
- ✓ mDNS/DNS-SD local network discovery (_careagent-neuron._tcp) — v1.0
- ✓ TXT record with org NPI, protocol version, connection endpoint — v1.0
- ✓ Auto-start/stop with Neuron lifecycle — v1.0
- ✓ Same consent verification for local and remote connections — v1.0
- ✓ HTTP REST API on Node.js built-in http module — v1.0
- ✓ API key authentication with nrn_ prefixed keys (SHA-256 hashed) — v1.0
- ✓ Token bucket rate limiting per API key — v1.0
- ✓ CORS handling with configurable allowed origins — v1.0
- ✓ Organization, relationship (read-only), status routes — v1.0
- ✓ OpenAPI 3.1 specification at GET /openapi.json — v1.0
- ✓ API key CLI (create, revoke, list) — v1.0
- ✓ E2E test: full lifecycle (init → register → consent → terminate) — v1.0
- ✓ E2E test: mDNS discovery → consent-verified connection — v1.0
- ✓ E2E test: REST API key, endpoints, rate limiting — v1.0
- ✓ REST API documentation (docs/api.md) — v1.0
- ✓ Architecture guide with Mermaid diagrams (docs/architecture.md) — v1.0
- ✓ Configuration reference (docs/configuration.md) — v1.0

### Active

(None — all v1.0 requirements shipped. Next milestone TBD via `/gsd:new-milestone`.)

### Out of Scope

- Clinical data storage — Neuron is operational infrastructure, not a clinical system
- LLM or AI reasoning — intelligence lives in CareAgents, not infrastructure
- Writing to Patient Charts — only credentialed provider CareAgents write
- EMR replacement — minimal operational data layer only
- Direct Axon exposure for third parties — closed protocol layer
- Patient identity storage — opaque relationship_id only
- Patient chart sync/caching — Neuron never touches patient data; belongs in patient-core or provider-core
- BLE/NFC discovery — platform-specific native modules; mDNS sufficient for v1
- Multi-site clustering — distributed systems complexity; single-process sufficient for v1
- Production database — SQLite sufficient for v1; PostgreSQL/MySQL deferred
- Data encryption at rest — filesystem-level encryption recommended
- Mutual TLS — bearer tokens sufficient for v1
- OAuth 2.0 for API auth — API keys sufficient for v1
- Scheduling/billing data storage — Neuron is routing/consent infrastructure; deferred to v2
- Claims submission to payers — requires external integration
- External calendar integration — requires OAuth flows
- Full Neuron SDK package — built after API stabilizes

## Context

**Shipped v1.0 MVP** with 11,147 LOC TypeScript, 239 tests (17 test files), 115 commits over 4 days.

**Tech stack:** Node.js >=22.12.0, TypeScript ~5.7.x, pnpm, tsdown, vitest, better-sqlite3, ws, bonjour-service, @sinclair/typebox.

**Ecosystem position:** Neuron sits between Axon (national network) above and provider CareAgents below. Patient CareAgents connect inbound via WebSocket. Third-party apps connect via REST API. Local network agents discover via mDNS.

**Key integration contracts:**
- Consumes `@careagent/axon` AxonRegistry API (registerNeuron, updateEndpoint, registerProvider, updateCredentials)
- Satisfies `NeuronClient` interface from `@careagent/provider-core` (register, heartbeat, disconnect)
- Satisfies `ProtocolServer` interface from `@careagent/provider-core` (start, stop, activeSessions)
- Implements consent token verification per Axon protocol spec (Ed25519)
- Uses AxonMessage format for protocol-level messages

**Related repos:**
- `@careagent/axon` — PRD complete, not yet built
- `@careagent/provider-core` — v1 phases 1-5 complete
- `@careagent/patient-core` — PRD complete, not yet built
- `@careagent/patient-chart` — README only, not yet built

**Authoritative source:** PRD.md in repo root (62 requirements across 13 domains, 9 phases)

## Constraints

- **Runtime:** Node.js >=22.12.0, TypeScript ~5.7.x, pnpm
- **Build:** tsdown ~0.20.x, vitest ~4.0.x (80% coverage thresholds)
- **Schema:** @sinclair/typebox ~0.34.x for all data models
- **HTTP:** Node.js built-in `http` module (no Express/Fastify)
- **Dependencies:** Minimal runtime deps acceptable (standalone server, not zero-dep plugin)
- **Data:** Synthetic data only, no PHI at any layer
- **Storage:** File-backed JSON or SQLite (v1)
- **Process:** Single-process deployment (clustering is v2)
- **License:** Apache 2.0

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone server, not plugin | Neuron owns its own process lifecycle; zero-dep constraint applies to plugins, not servers | ✓ Good |
| Scheduling/billing removed from v1 | Neuron should stay focused on routing/consent/discovery; operational data is a separate concern | ✓ Good — kept scope tight |
| Patient chart sync removed from v1 | Neuron never touches patient data; chart sync belongs in patient-core or provider-core | ✓ Good — clean separation |
| Node.js built-in http (no framework) | Consistency with ecosystem; minimal deps | ✓ Good — REST router works cleanly |
| Hash-chained JSONL audit log | Tamper-evident operational audit trail | ✓ Good — chain verification CLI works |
| ws in noServer mode for WebSocket | Shares HTTP server with REST API; one port for all traffic | ✓ Good — single port for WS + REST |
| Broker-and-step-out model (not relay bridge) | Neuron completes address exchange and closes; no persistent relay | ✓ Good — bounded memory |
| Global handshake ceiling with queuing | Connections queued, never rejected; queue timeout for graceful degradation | ✓ Good |
| mDNS/DNS-SD for local discovery (v1) | BLE/NFC deferred due to platform-specific complexity | ✓ Good — bonjour-service worked well |
| bonjour-service for mDNS | Pure JS, no native deps; RFC 6763 compliant TXT records | ✓ Good |
| Discovery stops first in shutdown | Goodbye packets sent before WebSocket close for clean LAN deregistration | ✓ Good |
| nrn_ prefixed API keys with SHA-256 hashing | Keys identifiable in logs; only hash stored for breach protection | ✓ Good |
| REST router reuses Phase 4 HTTP server | One port for WS + REST; router ignores non-/v1 paths to avoid WS conflict | ✓ Good |
| Read-only REST API in v1 | All endpoints GET; API key management via CLI only | ✓ Good — safe starting point |
| NeuronTestHarness pattern for E2E testing | Compose all subsystems in start.ts order without CLI child process | ✓ Good — reliable E2E tests |
| AI-agent optimized documentation | Consistent structure, tables, Mermaid diagrams, code examples | ✓ Good |
| IPC shutdown with setTimeout flush | Delay process.exit to flush IPC response before shutdown | ✓ Good — clean stop behavior |
| api_access audit inline in router | Not middleware; direct inline placement at audit trigger points | ✓ Good — explicit audit points |

---
*Last updated: 2026-02-22 after v1.0 milestone*
