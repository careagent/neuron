# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** Post-v1.0 enhancements shipped; planning next milestone

## Current Position

Phase: v1.0 complete (8 phases, 25 plans) + post-v1.0 enhancements
Plan: N/A
Status: Post-v1.0 enhancements shipped (consent broker, pure mDNS, InjectaVox, REST expansion)
Last activity: 2026-03-01 — post-v1.0 enhancement sessions

Progress: [██████████████████████████] 25/25 plans (100%)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (21 decisions, all marked ✓ Good).

### Post-v1.0 Fixes (4 commits after tag)

1. **fix: add untracked source files from Phases 6-8** — Source files built but never committed
2. **fix: use named import for bonjour-service Bonjour constructor** — tsdown bundles default import as module object; changed to `{ Bonjour }` named import in service.ts and discover.ts
3. **fix: send provider name, types, and specialty to Axon on registration** — Axon expects `{ provider_npi, provider_name, provider_types[] }` but Neuron only sent `{ provider_npi }`. Added `--name`, `--type`, `--specialty` CLI options, migration v5 for new columns, threaded fields through IPC → service → axon-client → state store
4. **docs: add PRD and gitignore health file**

### Post-v1.0 Work (10 commits, 5 sessions, 2026-02-22 to 2026-03-01)

1. **Consent Broker system** — broker.ts, audit-log.ts (hash-chained Ed25519-signed audit), relationship-store.ts, challenge.ts, verifier.ts, errors.ts + TypeBox schemas. Migrations v6 (consent_relationships) and v7 (audit_log).
2. **Pure Node.js mDNS/DNS-SD** — dns-packet.ts (RFC 1035 codec), mdns.ts (UDP multicast), dns-sd.ts (service advertisement), cache.ts (TTL caching). Replaces bonjour-service dependency entirely.
3. **InjectaVox clinical data ingestion API** — POST /v1/injectavox/ingest, GET /v1/injectavox/visits/:npi, store with migration v8, event emitter for notifications.
4. **REST API expansion** — GET /health, GET/POST /v1/registrations, GET /v1/consent/status/:id.
5. **Deploy script fixes** — protocol detection, native addon rebuild, firewall automation.

### Live Deployment

- Neuron installed globally via `npm link` at `/opt/homebrew/bin/neuron`
- Running at `~/neuron/` with config pointing to live Axon
- Registered with Axon at https://axon.opencare.ai (ID: 32f0972b-d6a8-4b1f-a670-0b63d76f485d)
- Provider Dr. Jane Smith (NPI 1497758544) registered as physician, specialty Internal Medicine
- Axon deployed at https://axon.opencare.ai (IP: 46.202.178.111) via Docker + Caddy reverse proxy
- All endpoints verified: /v1/status, /v1/organization, /v1/relationships, /openapi.json

### Pending Todos

None.

### Blockers/Concerns

None. Axon is live and Neuron successfully communicates with it.

### Metrics

- ~48K LOC TypeScript
- 300+ tests across 23+ test files
- 129 commits
- 8 database migrations (v1-v8)

## Session Continuity

Last session: 2026-03-01
Stopped at: Post-v1.0 enhancements shipped (consent broker, pure mDNS, InjectaVox, REST expansion, deploy fixes)
Resume file: N/A
