# Milestones

## v1.0 MVP (Shipped: 2026-02-22)

**Delivered:** A complete organizational endpoint for the CareAgent network — config, storage, audit logging, Axon registration, consent verification, WebSocket routing, local mDNS discovery, and authenticated REST API with full E2E test coverage and reference documentation.

**Phases completed:** 8 phases, 25 plans
**Tests:** 239 (17 test files, all passing)
**Lines of code:** 11,147 TypeScript
**Files modified:** 180
**Timeline:** 4 days (2026-02-19 → 2026-02-22)
**Commits:** 115
**Git range:** feat(01-01) → feat(08-02)

**Key accomplishments:**
1. Foundation infrastructure — TypeBox schemas, config loading with env overrides, SQLite storage, hash-chained JSONL audit logging
2. Axon network registration — organization/provider registration with heartbeat, IPC layer, and graceful degradation
3. Cryptographic consent — Ed25519 token verification, consent handshake with challenge-response, relationship lifecycle with permanent termination
4. WebSocket routing — broker-and-step-out protocol with global handshake safety ceiling (queuing, not rejection) and consent-verified sessions
5. Local discovery — mDNS/DNS-SD advertisement (`_careagent-neuron._tcp`) with same-security local connections
6. REST API — API key auth with `nrn_` prefixed keys, token bucket rate limiting, CORS, OpenAPI 3.1 spec
7. E2E integration tests (full lifecycle, mDNS discovery, REST API) and reference documentation (API, architecture, configuration)
8. Tech debt closure — IPC shutdown wiring, `api_access` audit producers, `verify-audit` CLI command

**Post-release fixes (4 commits after v1.0 tag):**
- fix: untracked source files from Phases 6-8
- fix: bonjour-service named import (mDNS runtime crash)
- fix: provider registration payload (name, types, specialty for Axon)
- docs: PRD.md added, health file gitignored

**Live deployment:**
- Neuron installed globally at `/opt/homebrew/bin/neuron`, running at `~/neuron/`
- Registered with Axon at https://axon.opencare.ai (ID: 32f0972b-d6a8-4b1f-a670-0b63d76f485d)
- Provider Dr. Jane Smith (NPI 1497758544) registered, heartbeat healthy

---

