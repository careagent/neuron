# Neuron REST API Reference

> **Source of truth:** The programmatic OpenAPI 3.1 specification is available at `GET /openapi.json` (no authentication required). This document provides human-readable reference with examples.

## Base URL

```
http://{host}:{port}/v1
```

Default: `http://localhost:3000/v1`

## Authentication

All `/v1/*` endpoints require an API key passed in the `X-API-Key` header.

### Creating API Keys

```bash
neuron api-key create --name "my-integration"
```

The raw key (prefixed `nrn_`) is shown **once** at creation. Only the SHA-256 hash is stored.

### Using API Keys

```bash
curl -H 'X-API-Key: nrn_...' http://localhost:3000/v1/status
```

### Authentication Errors

| Status | Condition | Response |
|--------|-----------|----------|
| `401` | Missing `X-API-Key` header | `{ "error": "Missing API key" }` |
| `401` | Invalid or revoked key | `{ "error": "Invalid API key" }` |
| `429` | Rate limit exceeded | `{ "error": "Rate limit exceeded" }` |

## Error Format

All error responses use a consistent JSON shape:

```json
{
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No content (CORS preflight) |
| `400` | Bad request |
| `401` | Unauthorized (missing or invalid API key) |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

## Endpoints

### GET /v1/organization

Returns organization information including NPI, name, type, Axon registration status, and provider count.

**Authentication:** Required

**Response (200):**

```json
{
  "npi": "1234567893",
  "name": "Springfield Medical Group",
  "type": "practice",
  "axon_status": "reachable",
  "providers": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `npi` | string | Organization NPI (10 digits) |
| `name` | string | Organization name |
| `type` | string | Organization type (practice, hospital, etc.) |
| `axon_status` | string | Axon registration status: `reachable`, `unreachable`, `unregistered` |
| `providers` | integer | Number of registered providers |

**Error Responses:** `401`, `429`

**Example:**

```bash
curl -s -H 'X-API-Key: nrn_abc123...' http://localhost:3000/v1/organization | jq
```

---

### GET /v1/relationships

Returns a paginated list of care relationships with optional filtering.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | — | Filter by status: `pending`, `active`, `suspended`, `terminated` |
| `provider_npi` | string | — | Filter by provider NPI |
| `offset` | integer | `0` | Pagination offset |
| `limit` | integer | `50` | Pagination limit (max 100) |

**Response (200):**

```json
{
  "data": [
    {
      "relationship_id": "550e8400-e29b-41d4-a716-446655440000",
      "patient_agent_id": "patient-agent-001",
      "provider_npi": "1234567893",
      "status": "active",
      "consented_actions": ["office_visit", "lab_results"],
      "created_at": "2026-02-22T10:00:00.000Z",
      "updated_at": "2026-02-22T10:00:00.000Z"
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 50
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data` | array | Array of relationship objects |
| `total` | integer | Total matching relationships |
| `offset` | integer | Current pagination offset |
| `limit` | integer | Current pagination limit |

**Error Responses:** `401`, `429`

**Examples:**

```bash
# List all relationships
curl -s -H 'X-API-Key: nrn_abc123...' http://localhost:3000/v1/relationships | jq

# Filter by status
curl -s -H 'X-API-Key: nrn_abc123...' 'http://localhost:3000/v1/relationships?status=active' | jq

# Filter by provider
curl -s -H 'X-API-Key: nrn_abc123...' 'http://localhost:3000/v1/relationships?provider_npi=1234567893' | jq

# Paginate
curl -s -H 'X-API-Key: nrn_abc123...' 'http://localhost:3000/v1/relationships?offset=10&limit=20' | jq
```

---

### GET /v1/relationships/:id

Returns a single relationship by its UUID.

**Authentication:** Required

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string (UUID) | Relationship ID |

**Response (200):**

```json
{
  "relationship_id": "550e8400-e29b-41d4-a716-446655440000",
  "patient_agent_id": "patient-agent-001",
  "provider_npi": "1234567893",
  "status": "active",
  "consented_actions": ["office_visit", "lab_results"],
  "created_at": "2026-02-22T10:00:00.000Z",
  "updated_at": "2026-02-22T10:00:00.000Z"
}
```

**Error Responses:** `401`, `404`, `429`

**Example:**

```bash
curl -s -H 'X-API-Key: nrn_abc123...' \
  http://localhost:3000/v1/relationships/550e8400-e29b-41d4-a716-446655440000 | jq
```

---

### GET /v1/status

Returns Neuron operational status including uptime, Axon registration, active sessions, and provider count.

**Authentication:** Required

**Response (200):**

```json
{
  "status": "running",
  "uptime_seconds": 3600,
  "organization": {
    "npi": "1234567893",
    "name": "Springfield Medical Group"
  },
  "axon": {
    "status": "reachable"
  },
  "active_sessions": 2,
  "providers": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"running"` |
| `uptime_seconds` | integer | Server uptime in seconds |
| `organization.npi` | string | Organization NPI |
| `organization.name` | string | Organization name |
| `axon.status` | string | Axon status: `reachable`, `unreachable`, `unregistered` |
| `active_sessions` | integer | Currently active WebSocket handshake sessions |
| `providers` | integer | Number of registered providers |

**Error Responses:** `401`, `429`

**Example:**

```bash
curl -s -H 'X-API-Key: nrn_abc123...' http://localhost:3000/v1/status | jq
```

---

### GET /openapi.json

Returns the OpenAPI 3.1 specification for the Neuron REST API.

**Authentication:** Not required (public endpoint)

**Response (200):**

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Neuron REST API",
    "version": "1.0.0",
    "description": "Third-party access to Neuron operational data"
  },
  "paths": { ... },
  "components": { ... }
}
```

**Example:**

```bash
curl -s http://localhost:3000/openapi.json | jq
```

## Rate Limiting

The Neuron uses a per-key token bucket algorithm for rate limiting.

### How It Works

- Each API key starts with `maxRequests` tokens
- Each request consumes one token
- Tokens refill proportionally based on elapsed time (not fixed intervals)
- When tokens are exhausted, requests receive `429 Too Many Requests`

### Configuration

| Config Key | Default | Description |
|------------|---------|-------------|
| `api.rateLimit.maxRequests` | `100` | Maximum tokens per key |
| `api.rateLimit.windowMs` | `60000` | Refill window in milliseconds |

### 429 Response

```json
{
  "error": "Rate limit exceeded"
}
```

The response includes a `Retry-After` header indicating seconds until tokens are available.

## CORS

Cross-Origin Resource Sharing is configurable via `api.cors.allowedOrigins`.

### Configuration

```json
{
  "api": {
    "cors": {
      "allowedOrigins": ["http://localhost:3000", "https://dashboard.example.com"]
    }
  }
}
```

Use `["*"]` to allow all origins.

### Preflight Handling

CORS preflight `OPTIONS` requests are handled before authentication, so they always succeed for allowed origins without requiring an API key.

### Response Headers

| Header | Value |
|--------|-------|
| `Access-Control-Allow-Origin` | Matching origin or `*` |
| `Access-Control-Allow-Methods` | `GET, OPTIONS` |
| `Access-Control-Allow-Headers` | `X-API-Key, Content-Type` |
| `Access-Control-Max-Age` | `86400` (24 hours) |
