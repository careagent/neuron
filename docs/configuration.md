# Neuron Configuration Reference

> **Source of truth:** `src/types/config.ts` (NeuronConfigSchema), `src/config/defaults.ts` (DEFAULT_CONFIG), `src/config/loader.ts` (loading pipeline).

## Overview

The Neuron is configured via a JSON file and optional environment variable overrides.

- **Config file:** `neuron.config.json` (default path, overridable with `--config`)
- **Generated via:** `neuron init`
- **Environment overrides:** `NEURON_` prefix with `__` for nesting
- **Validation:** TypeBox schema validation + NPI Luhn check
- **Immutability:** Config is deep-frozen after loading

### Loading Pipeline

1. Read file from disk
2. Parse JSON
3. Deep merge with defaults (user values override defaults)
4. Apply `NEURON_*` environment variable overrides
5. Validate against TypeBox schema
6. Validate NPI with Luhn check
7. Deep freeze and return

## Configuration Categories

### organization (required)

Organization identity for Axon registration and mDNS advertisement.

| Key | Type | Default | Required | Description | Env Var |
|-----|------|---------|----------|-------------|---------|
| `npi` | string | — | Yes | Organization NPI (10 digits, Luhn-valid) | `NEURON_ORGANIZATION__NPI` |
| `name` | string | — | Yes | Organization display name | `NEURON_ORGANIZATION__NAME` |
| `type` | string | — | Yes | Organization type: `practice`, `hospital`, `clinic`, `pharmacy`, `lab`, `imaging`, `other` | `NEURON_ORGANIZATION__TYPE` |

### server

HTTP and WebSocket server configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `port` | number | `3000` | Server listen port (1-65535) | `NEURON_SERVER__PORT` |
| `host` | string | `0.0.0.0` | Server bind address | `NEURON_SERVER__HOST` |

### websocket

WebSocket handshake protocol configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `path` | string | `/ws/handshake` | WebSocket endpoint path | `NEURON_WEBSOCKET__PATH` |
| `maxConcurrentHandshakes` | number | `10` | Safety ceiling for concurrent handshakes (queues beyond) | `NEURON_WEBSOCKET__MAXCONCURRENTHANDSHAKES` |
| `authTimeoutMs` | number | `10000` | Timeout for initial auth message (ms, min 1000) | `NEURON_WEBSOCKET__AUTHTIMEOUTMS` |
| `queueTimeoutMs` | number | `30000` | Timeout for queued connections (ms, min 1000) | `NEURON_WEBSOCKET__QUEUETIMEOUTMS` |
| `maxPayloadBytes` | number | `65536` | Maximum WebSocket frame payload (bytes, min 1024) | `NEURON_WEBSOCKET__MAXPAYLOADBYTES` |

### storage

SQLite database configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `path` | string | `./data/neuron.db` | Path to SQLite database file | `NEURON_STORAGE__PATH` |

### audit

Hash-chained audit log configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `path` | string | `./data/audit.jsonl` | Path to JSONL audit log file | `NEURON_AUDIT__PATH` |
| `enabled` | boolean | `true` | Enable/disable audit logging | `NEURON_AUDIT__ENABLED` |

### localNetwork

mDNS/DNS-SD local network discovery configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `enabled` | boolean | `false` | Enable mDNS service advertisement | `NEURON_LOCALNETWORK__ENABLED` |
| `serviceType` | string | `careagent-neuron` | mDNS service type (without `_` prefix and `._tcp` suffix) | `NEURON_LOCALNETWORK__SERVICETYPE` |
| `protocolVersion` | string | `v1.0` | Protocol version in TXT record | `NEURON_LOCALNETWORK__PROTOCOLVERSION` |

### heartbeat

Axon heartbeat interval configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `intervalMs` | number | `60000` | Heartbeat interval in milliseconds (min 1000) | `NEURON_HEARTBEAT__INTERVALMS` |

### axon

Axon network directory connection configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `registryUrl` | string | `http://localhost:9999` | Axon registry API base URL | `NEURON_AXON__REGISTRYURL` |
| `endpointUrl` | string | `http://localhost:3000` | Public endpoint URL for Axon registration | `NEURON_AXON__ENDPOINTURL` |
| `backoffCeilingMs` | number | `300000` | Maximum backoff time for retry (ms, min 1000) | `NEURON_AXON__BACKOFFCEILINGMS` |

### api

REST API rate limiting and CORS configuration.

| Key | Type | Default | Description | Env Var |
|-----|------|---------|-------------|---------|
| `rateLimit.maxRequests` | number | `100` | Maximum requests per key per window (min 1) | `NEURON_API__RATELIMIT__MAXREQUESTS` |
| `rateLimit.windowMs` | number | `60000` | Rate limit window in milliseconds (min 1000) | `NEURON_API__RATELIMIT__WINDOWMS` |
| `cors.allowedOrigins` | string[] | `[]` | Allowed CORS origins (use `["*"]` for all) | — |

## Example Configurations

### Minimal Configuration

Only required fields. All other values use defaults.

```json
{
  "organization": {
    "npi": "1234567893",
    "name": "Springfield Medical Group",
    "type": "practice"
  }
}
```

### Full Configuration

All options with their default values shown explicitly.

```json
{
  "organization": {
    "npi": "1234567893",
    "name": "Springfield Medical Group",
    "type": "practice"
  },
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "websocket": {
    "path": "/ws/handshake",
    "maxConcurrentHandshakes": 10,
    "authTimeoutMs": 10000,
    "queueTimeoutMs": 30000,
    "maxPayloadBytes": 65536
  },
  "storage": {
    "path": "./data/neuron.db"
  },
  "audit": {
    "path": "./data/audit.jsonl",
    "enabled": true
  },
  "localNetwork": {
    "enabled": false,
    "serviceType": "careagent-neuron",
    "protocolVersion": "v1.0"
  },
  "heartbeat": {
    "intervalMs": 60000
  },
  "axon": {
    "registryUrl": "http://localhost:9999",
    "endpointUrl": "http://localhost:3000",
    "backoffCeilingMs": 300000
  },
  "api": {
    "rateLimit": {
      "maxRequests": 100,
      "windowMs": 60000
    },
    "cors": {
      "allowedOrigins": []
    }
  }
}
```

### Production Configuration

Typical production settings with local discovery enabled and CORS configured.

```json
{
  "organization": {
    "npi": "1234567893",
    "name": "Springfield Medical Group",
    "type": "practice"
  },
  "server": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "storage": {
    "path": "/var/lib/neuron/neuron.db"
  },
  "audit": {
    "path": "/var/log/neuron/audit.jsonl"
  },
  "localNetwork": {
    "enabled": true
  },
  "axon": {
    "registryUrl": "https://axon.careagent.network",
    "endpointUrl": "https://neuron.springfield-medical.com"
  },
  "api": {
    "rateLimit": {
      "maxRequests": 1000,
      "windowMs": 60000
    },
    "cors": {
      "allowedOrigins": ["https://dashboard.springfield-medical.com"]
    }
  }
}
```

## Environment Variable Overrides

Environment variables with the `NEURON_` prefix override config file values. Double underscores (`__`) indicate nesting.

### Pattern

```
NEURON_{SECTION}__{KEY}={value}
```

### Examples

| Environment Variable | Config Path | Effect |
|---------------------|-------------|--------|
| `NEURON_SERVER__PORT=8080` | `server.port` | Listen on port 8080 |
| `NEURON_ORGANIZATION__NPI=1234567893` | `organization.npi` | Set organization NPI |
| `NEURON_AUDIT__ENABLED=false` | `audit.enabled` | Disable audit logging |
| `NEURON_LOCALNETWORK__ENABLED=true` | `localNetwork.enabled` | Enable mDNS discovery |
| `NEURON_AXON__REGISTRYURL=https://axon.example.com` | `axon.registryUrl` | Set Axon registry URL |
| `NEURON_API__RATELIMIT__MAXREQUESTS=1000` | `api.rateLimit.maxRequests` | Increase rate limit |
| `NEURON_HEARTBEAT__INTERVALMS=30000` | `heartbeat.intervalMs` | 30-second heartbeat |

### Type Coercion

Environment variables are strings. The loader automatically coerces:

| Input | Coerced Type | Example |
|-------|-------------|---------|
| `"true"` / `"false"` | boolean | `NEURON_AUDIT__ENABLED=false` -> `false` |
| Integer string | number | `NEURON_SERVER__PORT=8080` -> `8080` |
| Float string | number | — |
| Other | string | `NEURON_AXON__REGISTRYURL=https://...` -> `"https://..."` |

### Case Sensitivity

Key resolution is **case-insensitive**. The loader finds the matching key in the existing config object regardless of case.

## Validation Rules

### NPI Validation

The `organization.npi` field must be a valid 10-digit NPI number passing the Luhn check digit algorithm.

- Must be exactly 10 digits
- Must pass Luhn mod-10 check digit validation
- Invalid NPI results in a `ConfigError` with field path `/organization/npi`

### Schema Validation

TypeBox validates all fields against the `NeuronConfigSchema`:

| Rule | Fields |
|------|--------|
| Minimum string length 1 | `organization.name` |
| Port range 1-65535 | `server.port` |
| Minimum 1000ms | `websocket.authTimeoutMs`, `websocket.queueTimeoutMs`, `heartbeat.intervalMs`, `axon.backoffCeilingMs`, `api.rateLimit.windowMs` |
| Minimum 1024 bytes | `websocket.maxPayloadBytes` |
| Minimum 1 | `websocket.maxConcurrentHandshakes`, `api.rateLimit.maxRequests` |
| Valid org type | `organization.type` must be one of: `practice`, `hospital`, `clinic`, `pharmacy`, `lab`, `imaging`, `other` |

### Error Reporting

Validation errors include field-level details:

```
Configuration invalid:
  - /organization/npi: fails Luhn check digit validation
  - /server/port: Expected number to be greater or equal to 1
```
