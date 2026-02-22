# Neuron Architecture Guide

> **Source of truth:** `src/cli/commands/start.ts` (startup lifecycle), `src/types/config.ts` (configuration schema), individual module directories under `src/`.

## Overview

The Neuron is an organizational boundary node in the CareAgent network. It routes patient CareAgent connections to provider endpoints, verifies consent on every connection, and never holds or processes clinical data.

**Core principle:** Route connections, verify consent, never hold clinical data.

```mermaid
graph TB
    subgraph "Internet"
        Axon["Axon Network Directory"]
    end

    subgraph "Organization Boundary"
        Neuron["Neuron"]
        REST["REST API<br/>/v1/*"]
        WS["WebSocket Server<br/>/ws/handshake"]
        mDNS["mDNS Discovery<br/>_careagent-neuron._tcp"]
    end

    subgraph "External Agents"
        PA["Patient CareAgent"]
        Browser["Local Browser/App"]
        Integration["Third-Party Integration"]
    end

    PA -->|"WebSocket + Consent Token"| WS
    Browser -->|"mDNS Browse"| mDNS
    Browser -->|"WebSocket + Consent Token"| WS
    Integration -->|"X-API-Key"| REST
    Neuron -->|"Register + Heartbeat"| Axon

    Neuron --- REST
    Neuron --- WS
    Neuron --- mDNS
```

## Subsystem Architecture

### Registration (Axon Integration)

The registration subsystem manages the Neuron's identity within the Axon network directory.

**Key files:** `src/registration/service.ts`, `src/registration/axon-client.ts`, `src/registration/state.ts`, `src/registration/heartbeat.ts`

**Components:**
- `AxonRegistrationService` orchestrates `AxonClient`, `RegistrationStateStore`, and `HeartbeatManager`
- `RegistrationStateStore` persists registration state to SQLite (single-row via `CHECK(id=1)`)
- `HeartbeatManager` sends periodic endpoint updates with exponential backoff (full jitter, AWS pattern)

```mermaid
sequenceDiagram
    participant Neuron
    participant StateStore as Registration State
    participant Axon as Axon Registry

    Neuron->>Axon: POST /v1/neurons (register org)
    Axon-->>Neuron: registration_id + bearer_token
    Neuron->>StateStore: Save registration state
    Neuron->>Axon: POST /v1/neurons/:id/providers (register each provider)
    Axon-->>Neuron: provider_id

    loop Every 60 seconds
        Neuron->>Axon: PUT /v1/neurons/:id/endpoint (heartbeat)
        Axon-->>Neuron: status: reachable
    end
```

### Consent Verification

Every patient connection requires a valid Ed25519 consent token. Verification is stateless -- the Neuron re-verifies on every connection attempt (CSNT-02), never caching trust.

**Key files:** `src/relationships/handshake.ts`, `src/consent/verify.ts`, `src/relationships/store.ts`

**Token format:**
- Payload: JSON with `patient_agent_id`, `provider_npi`, `consented_actions`, `iat`, `exp`
- Signature: Ed25519 over the raw payload bytes
- Public key: base64url-encoded raw 32-byte Ed25519 public key, imported via JWK format

**Verification order:**
1. Signature verification (Ed25519, rejects invalid before parsing)
2. JSON parse of payload
3. Expiration check (`exp` field)

```mermaid
sequenceDiagram
    participant Patient as Patient CareAgent
    participant Neuron
    participant Store as Relationship Store

    Patient->>Neuron: handshake.auth (consent_token + public_key)
    Neuron->>Neuron: Verify Ed25519 signature
    Neuron->>Neuron: Parse claims, check expiration
    Neuron->>Store: Check existing active relationship

    alt New relationship
        Neuron->>Patient: handshake.challenge (nonce)
        Patient->>Neuron: handshake.challenge_response (signed_nonce)
        Neuron->>Neuron: Verify nonce signature
        Neuron->>Store: Create relationship record
        Neuron->>Patient: handshake.complete (relationship_id, provider_endpoint)
    else Existing active relationship
        Neuron->>Patient: handshake.complete (existing relationship_id, provider_endpoint)
    end

    Neuron->>Patient: Close WebSocket (code 1000)
```

### WebSocket Routing

The Neuron implements a "broker-and-step-out" model: verify consent, exchange addresses, disconnect. It does not relay messages between patient and provider.

**Key files:** `src/routing/server.ts`, `src/routing/handler.ts`, `src/routing/session.ts`, `src/routing/types.ts`

**Components:**
- `NeuronProtocolServer`: HTTP server + WebSocket server in `noServer` mode (ws library)
- `createConnectionHandler`: factory producing per-connection handler with handshake state machine
- `HandshakeSessionManager`: tracks active handshake sessions with configurable ceiling

**Safety ceiling:** When `maxConcurrentHandshakes` is reached, new connections are queued (never rejected). Queued connections are promoted when slots open or destroyed after `queueTimeoutMs`.

```mermaid
sequenceDiagram
    participant Patient as Patient CareAgent
    participant HTTP as HTTP Server
    participant WSS as WebSocket Server
    participant Handler as Connection Handler
    participant Session as Session Manager

    Patient->>HTTP: HTTP Upgrade (/ws/handshake)

    alt Under ceiling
        HTTP->>WSS: handleUpgrade
        WSS->>Handler: connection event
        Handler->>Session: Create session
        Handler->>Patient: Handshake flow...
        Handler->>Session: Remove session
        Handler->>Patient: Close (1000)
    else At ceiling
        HTTP->>HTTP: Queue connection
        Note over HTTP: Wait for slot or timeout
    end
```

### Local Discovery

mDNS/DNS-SD advertisement enables local network CareAgent discovery without Axon. Uses `bonjour-service` to advertise a `_careagent-neuron._tcp` service.

**Key files:** `src/discovery/service.ts`, `src/discovery/types.ts`

**TXT records (RFC 6763 Section 6.4, keys <=9 chars):**

| Key | Value | Description |
|-----|-------|-------------|
| `npi` | `1234567893` | Organization NPI |
| `ver` | `v1.0` | Protocol version |
| `ep` | `ws://192.168.1.100:3000/ws/handshake` | WebSocket endpoint URL |

**Service instance name:** `neuron-{NPI}` (unique per organization on LAN)

Local connections use the same WebSocket endpoint and consent verification flow as remote connections (DISC-04).

### REST API

HTTP request handling shares the same `node:http` server as WebSocket. The HTTP server dispatches `request` events to the API router and `upgrade` events to the WebSocket server.

**Key files:** `src/api/router.ts`, `src/api/keys.ts`, `src/api/rate-limiter.ts`, `src/api/openapi-spec.ts`

**Request pipeline:**
1. Parse URL
2. Ignore non-API paths (WebSocket and other handlers pass through)
3. CORS headers (before auth, so preflight always works)
4. Public endpoint check (`/openapi.json` -- no auth)
5. API key authentication (`X-API-Key` header, SHA-256 hash, timing-safe comparison)
6. Rate limiting (per-key token bucket)
7. Route dispatch (regex matching, no framework)

## Startup Lifecycle

Initialization follows a strict dependency order matching `src/cli/commands/start.ts`:

```mermaid
sequenceDiagram
    participant CLI as neuron start
    participant Config
    participant Storage as SQLite Storage
    participant Audit as Audit Logger
    participant IPC as IPC Server
    participant Reg as Registration Service
    participant Rel as Relationship Store
    participant WS as WebSocket Server
    participant API as REST API
    participant Disc as Discovery Service
    participant Axon as Axon Registry

    CLI->>Config: loadConfig()
    CLI->>Storage: new SqliteStorage() + initialize()
    CLI->>Audit: new AuditLogger()
    CLI->>IPC: startIpcServer()
    CLI->>Reg: new AxonRegistrationService()
    CLI->>Rel: new RelationshipStore() + ConsentHandshakeHandler
    CLI->>WS: new NeuronProtocolServer() + start()
    CLI->>API: ApiKeyStore + RateLimiter + createApiRouter()
    Note over API: Attach to HTTP server via 'request' event
    CLI->>Disc: new DiscoveryService() + start()
    Note over Disc: Only if localNetwork.enabled
    CLI->>Axon: registrationService.start()
    Note over Axon: Register org + providers + start heartbeat
```

**Shutdown order (reverse):**
1. Stop Discovery (goodbye packets)
2. Stop WebSocket server (close all connections with code 1001)
3. Stop Registration service (stop heartbeat)
4. Close IPC server + remove socket file
5. Close Storage

## Data Flow

### Patient Connection Flow

```mermaid
sequenceDiagram
    participant Patient as Patient CareAgent
    participant WS as WebSocket Server
    participant Consent as Consent Verifier
    participant Challenge as Challenge Handler
    participant Store as Relationship Store
    participant Audit as Audit Logger

    Patient->>WS: WebSocket connect (/ws/handshake)
    WS->>WS: Auth timeout timer starts
    Patient->>WS: handshake.auth message
    WS->>Audit: connection.handshake_started
    WS->>Consent: Verify consent token signature + expiration
    WS->>Store: Check for existing active relationship

    alt New relationship
        WS->>Patient: handshake.challenge (random nonce)
        Patient->>WS: handshake.challenge_response (signed nonce)
        WS->>Consent: Verify nonce signature
        WS->>Store: Create relationship record
        WS->>Audit: consent.relationship_established
    end

    WS->>Audit: connection.handshake_completed
    WS->>Patient: handshake.complete (relationship_id, provider_endpoint)
    WS->>Patient: Close (1000, broker-and-step-out)
```

### REST API Request Flow

```mermaid
sequenceDiagram
    participant Client as API Client
    participant Router as API Router
    participant Auth as API Key Auth
    participant RL as Rate Limiter
    participant Handler as Route Handler
    participant Store as Data Store

    Client->>Router: GET /v1/status (X-API-Key: nrn_...)
    Router->>Router: Set CORS headers
    Router->>Auth: Verify API key (SHA-256 hash + timing-safe)
    Auth-->>Router: Key record (or 401)
    Router->>RL: Consume token for key
    RL-->>Router: Allowed (or 429)
    Router->>Handler: Dispatch to route handler
    Handler->>Store: Query data
    Store-->>Handler: Results
    Handler-->>Client: 200 JSON response
```

## Security

### Trust Model

The Neuron trusts consent tokens signed by patient CareAgents. Trust is verified cryptographically on every connection attempt -- never cached or assumed from prior interactions.

- **No cached trust:** Each connection requires a fresh, valid consent token (stateless re-verification per CSNT-02)
- **Consent scope:** Tokens specify `consented_actions` that limit what the relationship covers
- **Expiration:** Tokens have `iat` (issued at) and `exp` (expiration) claims, enforced on verification

### Consent Verification

- **Algorithm:** Ed25519 (deterministic, no nonce reuse risk)
- **Key format:** Raw 32-byte public keys encoded as base64url, imported via JWK format (`kty: OKP`, `crv: Ed25519`)
- **Verification order:** Signature first (rejects invalid before parsing), then JSON parse, then expiration check
- **Challenge-response:** After consent verification, a random nonce prevents replay attacks. Patient must sign the nonce with the same private key that signed the consent token.

### API Key Authentication

- **Key format:** `nrn_` prefix + 32 random bytes base64url-encoded
- **Storage:** Only SHA-256 hash stored in SQLite -- raw key shown once at creation
- **Comparison:** `crypto.timingSafeEqual` on `Buffer.from(hash, 'hex')` prevents timing attacks
- **Revocation:** Setting `revoked_at` timestamp immediately invalidates the key

### Audit Chain Integrity

- **Format:** Append-only JSONL file with hash-chained entries
- **Hash algorithm:** SHA-256 over canonical JSON representation (deterministic serialization)
- **Chain structure:** Each entry includes `prev_hash` linking to the previous entry
- **Genesis entry:** First entry uses `prev_hash` of 64 zeros (`0000...0000`)
- **Verification:** `verifyAuditChain()` validates the entire chain, detecting tampering or truncation

### Network Security

- **WebSocket protocol:** Text-only JSON envelopes (binary frames rejected)
- **Challenge-response nonces:** 32 random bytes (hex-encoded), 30-second TTL, hard cap of 1000 pending challenges
- **No data relay:** The Neuron exchanges addresses and disconnects. Clinical data flows directly between patient and provider CareAgents.

## IPC Protocol

The Neuron exposes a Unix domain socket for local CLI commands.

**Socket path:** Co-located with database file via `getSocketPath(storagePath)` (e.g., `./data/neuron.sock`)

**Protocol:** NDJSON (one JSON object per newline)

### Command Types

| Command | Fields | Description |
|---------|--------|-------------|
| `provider.add` | `npi` | Register a provider with Axon |
| `provider.remove` | `npi` | Remove a provider from Axon |
| `provider.list` | — | List all registered providers |
| `status` | — | Get neuron registration and heartbeat status |
| `relationship.terminate` | `relationship_id`, `provider_npi`, `reason` | Terminate a care relationship |

### Response Format

```json
{
  "ok": true,
  "data": { ... }
}
```

```json
{
  "ok": false,
  "error": "Error message"
}
```

**Client timeout:** 5 seconds with descriptive error messages. Stale socket cleanup via `unlinkSync` before `server.listen`.
