# @careagent/neuron

## What This Is

A standalone Node.js server that serves as the organization-level endpoint for NPI-holding healthcare organizations in the CareAgent ecosystem. The Neuron is the "organizational membrane" between the national Axon network and individual provider CareAgents — it routes patient connections, verifies consent, manages scheduling/billing data, and exposes a REST API for third-party integrations. Free, open-source infrastructure (Apache 2.0) for any organization that participates in patient care.

## Core Value

Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections to the correct provider, verifies consent before any communication, and never holds clinical data.

## Requirements

### Validated

- ✓ WebSocket server for inbound patient CareAgent connections — Phase 4
- ✓ Connection authentication: consent → relationship check → route — Phase 4
- ✓ Active session tracking with per-provider concurrency limits — Phase 4 (global handshake ceiling with queuing)
- ✓ Implements ProtocolServer interface from provider-core — Phase 4
- ✓ mDNS/DNS-SD local network discovery (_careagent-neuron._tcp) — Phase 5
- ✓ Same consent verification for local and remote connections — Phase 5 (DISC-04 by design)

### Active

- [ ] Organization and provider registration with Axon network using NPI
- [ ] Periodic heartbeat to maintain reachable status in Axon endpoint directory
- [ ] Dynamic provider management (add/remove/update without restart)
- [ ] Registration state persistence across restarts
- [ ] Graceful degradation when Axon is unreachable
- [ ] TypeBox configuration schema with validation at startup
- [ ] Environment variable overrides with NEURON_ prefix
- [ ] NPI validation (10-digit format, Luhn check)
- [ ] Ed25519 consent token verification (stateless, every connection)
- [ ] Consent scope passed to provider CareAgent
- [ ] RelationshipRecord store with persistence
- [ ] Consent handshake handler (Neuron side of Axon protocol)
- [ ] Relationship queries by patient, provider, relationship ID
- [ ] Provider-initiated termination with state protocol compliance
- [ ] Terminated relationships permanently stop routing
- [ ] Bidirectional session bridge between patient and provider
- [ ] Appointment CRUD with full status lifecycle
- [ ] Provider availability management (recurring, one-time, blocks)
- [ ] Billing record CRUD with CPT/ICD codes
- [ ] All scheduling/billing records reference relationship_id only (no patient identity)
- [ ] HTTP REST API on Node.js built-in http module
- [ ] API key authentication with rate limiting
- [ ] Organization, scheduling, billing, relationship, status routes
- [ ] OpenAPI 3.1 specification
- [ ] Patient Chart sync receiver with authorization check
- [ ] Incremental sync with last-sync-timestamp tracking
- [ ] Access revocation: purge cached entries
- [ ] Hash-chained JSONL audit log with SHA-256 tamper-evident chain
- [ ] E2E integration tests covering all 9 core functionalities
- [ ] REST API documentation, architecture guide, configuration reference

### Out of Scope

- Clinical data storage — Neuron is operational infrastructure, not a clinical system
- LLM or AI reasoning — intelligence lives in CareAgents, not infrastructure
- Writing to Patient Charts — only credentialed provider CareAgents write
- EMR replacement — minimal operational data layer only
- Direct Axon exposure for third parties — closed protocol layer
- Patient identity storage — opaque relationship_id only
- BLE/NFC discovery (v1) — platform-specific native modules
- Multi-site clustering (v1) — distributed systems complexity
- Production database (v1) — file-backed JSON or SQLite sufficient
- Data encryption at rest (v1) — filesystem-level encryption recommended
- Mutual TLS (v1) — bearer tokens sufficient for demo
- OAuth 2.0 for API auth (v1) — API keys sufficient
- Claims submission to payers — requires external integration
- External calendar integration — requires OAuth flows
- Full Neuron SDK package — built after API stabilizes

## Context

**Ecosystem position:** Neuron sits between Axon (national network) above and provider CareAgents below. Patient CareAgents connect inbound. Third-party apps connect via REST API.

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
| Standalone server, not plugin | Neuron owns its own process lifecycle; zero-dep constraint applies to plugins, not servers | — Pending |
| relationship_id only for scheduling/billing | Keeps Neuron outside HIPAA covered entity classification | — Pending |
| Node.js built-in http (no framework) | Consistency with ecosystem; minimal deps | — Pending |
| Hash-chained JSONL audit log | Tamper-evident operational audit trail | — Pending |
| ws in noServer mode for WebSocket | Shares HTTP server with Phase 7 REST API; one port for all traffic | Phase 4 |
| Broker-and-step-out model (not relay bridge) | Neuron completes address exchange and closes; no persistent relay | Phase 4 |
| Global handshake ceiling with queuing | Connections queued, never rejected; queue timeout for graceful degradation | Phase 4 |
| mDNS/DNS-SD for local discovery (v1) | BLE/NFC deferred due to platform-specific complexity | Phase 5 |
| bonjour-service for mDNS | Pure JS, no native deps; RFC 6763 compliant TXT records | Phase 5 |
| Discovery stops first in shutdown | Goodbye packets sent before WebSocket close for clean LAN deregistration | Phase 5 |

---
*Last updated: 2026-02-22 after Phase 5*
