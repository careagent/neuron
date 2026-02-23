# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Every NPI-holding organization can connect to the CareAgent network through a free, secure organizational boundary that routes patient connections, verifies consent, and never holds clinical data.
**Current focus:** v1.0 shipped and live-tested — planning next milestone

## Current Position

Phase: v1.0 complete (8 phases, 25 plans) + post-release fixes
Plan: N/A
Status: Milestone v1.0 shipped, installed globally, registered with live Axon
Last activity: 2026-02-22 — live deployment and post-release fixes

Progress: [██████████████████████████] 25/25 plans (100%)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (18 decisions, all marked ✓ Good after v1.0).

### Post-v1.0 Fixes (4 commits after tag)

1. **fix: add untracked source files from Phases 6-8** — Source files built but never committed
2. **fix: use named import for bonjour-service Bonjour constructor** — tsdown bundles default import as module object; changed to `{ Bonjour }` named import in service.ts and discover.ts
3. **fix: send provider name, types, and specialty to Axon on registration** — Axon expects `{ provider_npi, provider_name, provider_types[] }` but Neuron only sent `{ provider_npi }`. Added `--name`, `--type`, `--specialty` CLI options, migration v5 for new columns, threaded fields through IPC → service → axon-client → state store
4. **docs: add PRD and gitignore health file**

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

## Session Continuity

Last session: 2026-02-22
Stopped at: Live deployment verified, post-release fixes committed and pushed
Resume file: N/A
