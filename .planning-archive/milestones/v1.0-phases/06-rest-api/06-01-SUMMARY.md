---
phase: 06-rest-api
plan: 01
started: 2026-02-22
completed: 2026-02-22
duration: 4min
---

# Plan 06-01 Summary: API key store, rate limiter, config extension, HTTP utilities

## What was built

TDD implementation of the REST API foundation layer:

- **ApiKeyStore** (`src/api/keys.ts`): SQLite-backed API key management with `nrn_` prefixed keys, SHA-256 hashed storage, timing-safe verification via `crypto.timingSafeEqual`, and CRUD operations (create, verify, revoke, list)
- **TokenBucketRateLimiter** (`src/api/rate-limiter.ts`): In-memory per-key token bucket rate limiter with configurable max tokens, refill rate, and window. Includes stale bucket cleanup.
- **HTTP utilities** (`src/api/http-utils.ts`): `sendJson` and `readBody` matching Axon's exact patterns
- **Config extension** (`src/types/config.ts`): Added `api.rateLimit` (maxRequests, windowMs) and `api.cors` (allowedOrigins) to NeuronConfigSchema
- **Migration v4** (`src/storage/migrations.ts`): Creates `api_keys` table with hash index

## Key decisions

- [06-01]: API keys use `nrn_` prefix (modeled after Stripe's `sk_`/`pk_` convention) for easy identification
- [06-01]: Raw keys shown once at creation, only SHA-256 hash stored -- prevents exposure from database breach
- [06-01]: Timing-safe comparison via `crypto.timingSafeEqual` on Buffer.from(hash, 'hex') to prevent timing attacks
- [06-01]: Token bucket refills proportionally based on elapsed time (not fixed intervals)
- [06-01]: Stale bucket cleanup threshold: 10 minutes of inactivity
- [06-01]: Updated all test config fixtures (routing, registration, CLI) to include new api section

## Test results

19 new tests, all passing. 183 total tests across 13 files.

## Self-Check: PASSED

- [x] ApiKeyStore creates, verifies, revokes, lists keys
- [x] Keys hashed with SHA-256, timing-safe verification
- [x] Rate limiter enforces per-key token bucket limits
- [x] Config includes api.rateLimit and api.cors
- [x] Migration v4 creates api_keys table
- [x] HTTP utilities match Axon pattern
- [x] All existing tests updated and passing

## Artifacts

### key-files
created:
  - src/api/keys.ts
  - src/api/rate-limiter.ts
  - src/api/http-utils.ts
  - src/api/index.ts
  - src/api/api-keys.test.ts
modified:
  - src/types/config.ts
  - src/config/defaults.ts
  - src/storage/migrations.ts
  - src/storage/sqlite.test.ts
  - src/routing/routing.test.ts
  - src/registration/registration.test.ts
  - src/cli/cli.test.ts
