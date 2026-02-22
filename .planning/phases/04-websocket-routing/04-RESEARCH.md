# Phase 4: WebSocket Routing - Research

**Researched:** 2026-02-22
**Domain:** WebSocket server, consent-gated connection handshake, broker-and-step-out pattern, ProtocolServer interface
**Confidence:** HIGH

## Summary

Phase 4 implements the Neuron's WebSocket server for the consent establishment handshake. Per the user's architectural reframe (CONTEXT.md), the Neuron is a **trust broker, not a session relay**. Patient CareAgents connect via WebSocket to perform a one-time consent verification and relationship establishment. After verifying the consent token, creating the relationship record, and exchanging direct addresses (patient gets provider CareAgent address, provider CareAgent gets patient CareAgent address), the Neuron disconnects. It does not relay clinical traffic or maintain persistent sessions.

This fundamentally changes the interpretation of ROUT-03 through ROUT-05. There is no "bidirectional session bridge" in the relay sense. Instead, the "session" is the handshake connection itself: patient connects, authenticates, receives address exchange, and disconnects. Backpressure applies to the handshake queue (concurrent WebSocket connections), not to message relay. Concurrency limits are a safety ceiling on simultaneous handshake connections to the Neuron, not per-provider session caps.

**Primary recommendation:** Use the `ws` library (v8.x) in `noServer` mode, attached to a Node.js `http.createServer()` instance. This HTTP server will be reused by Phase 7 (REST API). The WebSocket path `/ws/handshake` handles consent establishment. Implement the `ProtocolServer` interface from provider-core as a thin adapter over the WebSocket server lifecycle.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- The Neuron is the organization's **trust anchor** on the CareAgent network -- not a relay or session manager
- Three responsibilities: (1) trust establishment via consent, (2) patient directory, (3) API gateway for third-party apps
- After consent verification and address exchange, the Neuron steps out completely -- all clinical communication is direct P2P between CareAgents
- No PHI ever stored on or flows through the Neuron
- The Neuron CAN store: patient CareAgent identifiers, patient demographics, consent records, relationship records
- The Neuron CANNOT store: clinical data, diagnoses, lab results, treatment notes, prescriptions
- Patient CareAgent connects to Neuron via WebSocket for the **one-time** consent establishment
- Neuron verifies consent token, creates relationship record, exchanges direct addresses (patient gets provider CareAgent address, provider CareAgent gets patient CareAgent address)
- Neuron disconnects -- no persistent session, no message forwarding
- After establishment, patient CareAgent talks directly to provider CareAgent whenever needed -- no check-in with Neuron per interaction
- Patient CareAgent presents consent token as the **first message** after WebSocket connect (not query param, not upgrade header)
- Consent token already encodes the relationship -- Neuron resolves the target provider from the token (no separate provider NPI field needed)
- On auth failure, Neuron sends a structured JSON error message with error code and reason before closing
- The Neuron does not manage active P2P sessions -- concurrency is not the Neuron's concern after handshake
- A configurable **safety ceiling** exists for simultaneous WebSocket connections to the Neuron itself (the handshake endpoint)
- Default: 10 for development (prevents runaway scripts during dev)
- This is a resource safety guardrail, not a business rule -- normal operation should never hit it
- When the ceiling is hit: queue the connection, don't reject it -- no patient CareAgent should ever be turned away
- The ceiling is adjustable for production (hundreds or thousands of simultaneous handshakes)
- The Neuron must be lightweight -- small practices need to run it
- Revocation and consent management are handled P2P between CareAgents, not by the Neuron
- Organization-side banning goes through a third-party app using the Neuron's REST API (Phase 7)

### Claude's Discretion
- Auth timeout duration for the first-message window
- Message format for the handshake exchange (opaque vs envelope) -- Axon's protocol spec (Phase 4) is still TBD, so pragmatic approach given both projects are in-flight
- Backpressure strategy if handshake queue builds up
- Whether the WebSocket server runs on the same port (path-based) or a dedicated port
- Message size limits during handshake
- Text vs binary WebSocket frame support
- Provider-unavailable behavior during handshake (provider CareAgent not reachable when patient tries to establish)

### Deferred Ideas (OUT OF SCOPE)
- **Service advertisement via Axon** -- when registering, Neuron advertises organization capabilities. Not Phase 4 scope.
- **Roadmap reframe: Phase 6 (Scheduling and Billing)** -- should be reframed as API/SDK gateway. Not Phase 4 scope.
- **ROUT requirements rewrite** -- ROUT-03, ROUT-04, ROUT-05 need to be reinterpreted for the broker-and-step-out model. They were written assuming the Neuron relays traffic.
- **Third-party agent types** -- documentation tools, pharmacy agents, notification systems built by third parties through the Neuron API. Future capability.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ROUT-01 | WebSocket server accepting inbound patient CareAgent connections | `ws` library in noServer mode attached to `http.createServer()`. Path `/ws/handshake`. Server lifecycle managed by start/stop. |
| ROUT-02 | Connection authentication pipeline: consent token -> relationship check -> route | Patient sends consent token as first message after connect. Neuron verifies signature, checks expiration, resolves provider from token claims, checks for existing active relationship (or creates new one via handshake). Auth timeout of 10 seconds for first message. |
| ROUT-03 | Bidirectional session bridge between patient and provider WebSocket connections with backpressure handling | **Reinterpreted for broker model:** The "session" is the handshake connection. No relay bridge. Backpressure applies to the connection queue -- when the safety ceiling is hit, connections are queued (not rejected). The `ws` `send()` callback and `bufferedAmount` property handle per-connection flow control during the handshake exchange. |
| ROUT-04 | Active session tracking with per-provider concurrency limits (configurable, default 10) | **Reinterpreted for broker model:** Track active handshake connections to the Neuron (not per-provider P2P sessions). Safety ceiling of 10 (dev default) simultaneous WebSocket connections. Queuing when ceiling is reached. Configurable via `websocket.maxConcurrentHandshakes` in config. |
| ROUT-05 | Graceful session termination from either side with cleanup | Handshake connections are short-lived. On disconnect (client or timeout), remove from active tracking, close WebSocket, clean up event listeners. On server stop, close all active connections with 1001 (going away) code. |
| ROUT-06 | Implements `ProtocolServer` interface from provider-core (start, stop, activeSessions) | The Neuron implements `ProtocolServer` with: `start(port)` creates HTTP server + WebSocket server and listens on port; `stop()` gracefully closes all connections and HTTP server; `activeSessions()` returns currently active handshake connections as `ProtocolSession[]`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | ^8.19.0 | WebSocket server for Node.js | De facto standard; 70M+ weekly downloads; passes Autobahn test suite; zero dependencies; supports noServer mode for sharing HTTP server with REST API (Phase 7) |
| `node:http` | built-in | HTTP server for WebSocket upgrade handling | Built-in Node.js module; required for `ws` noServer mode; will be reused by Phase 7 REST API |
| `node:crypto` | built-in | UUID generation for session IDs | Already used throughout codebase (randomUUID, Ed25519 verify) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/ws` | ^8.18.1 | TypeScript type definitions for ws | Dev dependency; provides types for WebSocketServer, WebSocket, etc. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ws` | `node:http` raw upgrade + manual frame parsing | Massive complexity, error-prone, no standard compliance testing. Do not hand-roll WebSocket framing. |
| `ws` | `socket.io` | Overkill: adds rooms, namespaces, auto-reconnect, fallback transport. The Neuron needs a clean WebSocket server, not a real-time framework. |
| `ws` noServer | `ws` standalone (own port) | Standalone works but wastes a port. noServer lets Phase 7 REST API share the same port via path-based routing. |

**Installation:**
```bash
pnpm add ws
pnpm add -D @types/ws
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── routing/                 # NEW - Phase 4
│   ├── server.ts            # NeuronProtocolServer implementing ProtocolServer interface
│   ├── handler.ts           # WebSocket connection handler (handshake orchestration)
│   ├── session.ts           # HandshakeSession tracking (active connections map)
│   ├── messages.ts          # Handshake message types and validation
│   ├── errors.ts            # Routing-specific error types
│   ├── index.ts             # Public API re-exports
│   └── routing.test.ts      # Tests
├── consent/                 # EXISTING - Phase 3 (consumed by handler.ts)
├── relationships/           # EXISTING - Phase 3 (consumed by handler.ts)
├── types/
│   └── config.ts            # MODIFIED - add websocket config section
├── cli/
│   └── commands/
│       └── start.ts         # MODIFIED - wire up NeuronProtocolServer
└── ...
```

### Pattern 1: noServer Mode with Path-Based Routing
**What:** Create the WebSocket server in `noServer: true` mode and manually handle HTTP upgrade requests, routing by path.
**When to use:** When a single HTTP server must serve both WebSocket and REST endpoints (Phase 7 compatibility).
**Example:**
```typescript
// Source: ws README - https://github.com/websockets/ws#multiple-servers-sharing-a-single-https-server
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const httpServer = createServer();
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '', `http://${request.headers.host}`);

  if (pathname === '/ws/handshake') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(port);
```

### Pattern 2: First-Message Authentication
**What:** Patient CareAgent sends consent token as the first WebSocket message (not in query params or headers). Server waits with a timeout, then processes authentication.
**When to use:** Per user decision -- consent token is first message after WebSocket connect.
**Example:**
```typescript
// Handshake connection handler
wss.on('connection', (ws, request) => {
  const authTimeout = setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'AUTH_TIMEOUT',
      message: 'No consent token received within timeout',
    }));
    ws.close(4001, 'Auth timeout');
  }, AUTH_TIMEOUT_MS);

  ws.once('message', (data) => {
    clearTimeout(authTimeout);
    // Parse and verify consent token
    handleConsentMessage(ws, data);
  });

  ws.on('error', () => {
    clearTimeout(authTimeout);
  });
});
```

### Pattern 3: Connection Safety Ceiling with Queuing
**What:** Track concurrent handshake connections. When the ceiling is hit, hold the WebSocket upgrade (don't call handleUpgrade until a slot opens) rather than rejecting.
**When to use:** Per user decision -- "no patient CareAgent should ever be turned away."
**Example:**
```typescript
const activeConnections = new Set<WebSocket>();
const pendingUpgrades: Array<{ request, socket, head, resolve }> = [];

function tryProcessUpgrade() {
  while (pendingUpgrades.length > 0 && activeConnections.size < maxConcurrent) {
    const pending = pendingUpgrades.shift()!;
    wss.handleUpgrade(pending.request, pending.socket, pending.head, (ws) => {
      activeConnections.add(ws);
      wss.emit('connection', ws, pending.request);
    });
  }
}

httpServer.on('upgrade', (request, socket, head) => {
  if (activeConnections.size < maxConcurrent) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      activeConnections.add(ws);
      wss.emit('connection', ws, request);
    });
  } else {
    // Queue -- do not reject
    pendingUpgrades.push({ request, socket, head });
    // Set a queue timeout so connections don't hang forever
    setTimeout(() => {
      const idx = pendingUpgrades.findIndex(p => p.socket === socket);
      if (idx !== -1) {
        pendingUpgrades.splice(idx, 1);
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
      }
    }, QUEUE_TIMEOUT_MS);
  }
}
```

### Pattern 4: ProtocolServer Adapter
**What:** Implement the `ProtocolServer` interface from provider-core as a wrapper around the WebSocket server lifecycle.
**When to use:** ROUT-06 compliance.
**Example:**
```typescript
// Source: provider-core/src/protocol/types.ts
import type { ProtocolServer, ProtocolSession } from './types.js';

export class NeuronProtocolServer implements ProtocolServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, HandshakeSession> = new Map();

  async start(port: number): Promise<void> {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    // Wire upgrade handler, connection handler
    // Return promise that resolves when server is listening
  }

  async stop(): Promise<void> {
    // Close all active WebSocket connections with 1001 (going away)
    // Close WebSocketServer
    // Close HTTP server
  }

  activeSessions(): ProtocolSession[] {
    // Map active handshake sessions to ProtocolSession format
    return Array.from(this.sessions.values()).map(s => ({
      sessionId: s.id,
      patientAgentId: s.patientAgentId,
      providerAgentId: '', // Not yet assigned during handshake
      startedAt: s.startedAt,
      status: s.status,
    }));
  }
}
```

### Pattern 5: Handshake Message Protocol
**What:** Structured JSON messages for the handshake exchange. Each message has a `type` field for dispatch.
**When to use:** All handshake communication over the WebSocket.
**Example:**
```typescript
// Patient -> Neuron: Consent token submission
interface HandshakeAuthMessage {
  type: 'handshake.auth';
  consent_token_payload: string;  // base64url
  consent_token_signature: string; // base64url
  patient_agent_id: string;
  patient_endpoint: string;  // Where the patient CareAgent can be reached
}

// Neuron -> Patient: Challenge (identity verification)
interface HandshakeChallengeMessage {
  type: 'handshake.challenge';
  nonce: string;
  provider_npi: string;
  organization_npi: string;
}

// Patient -> Neuron: Challenge response
interface HandshakeChallengeResponseMessage {
  type: 'handshake.challenge_response';
  signed_nonce: string;  // base64url
}

// Neuron -> Patient: Success with address exchange
interface HandshakeCompleteMessage {
  type: 'handshake.complete';
  relationship_id: string;
  provider_endpoint: string;  // Direct address for the provider CareAgent
}

// Neuron -> Patient: Error
interface HandshakeErrorMessage {
  type: 'handshake.error';
  code: string;
  message: string;
}
```

### Anti-Patterns to Avoid
- **Consent token in URL query params:** Tokens in URLs get logged in access logs, browser history, proxy logs. User decision explicitly requires first-message pattern.
- **Keeping the connection open after address exchange:** The Neuron is a broker, not a relay. Close the connection after the handshake completes.
- **Rejecting connections when ceiling is hit:** User explicitly stated "no patient CareAgent should ever be turned away." Queue instead.
- **Storing session state in SQLite:** Handshake sessions are ephemeral (seconds). Use an in-memory Map, not database storage.
- **Inspecting or logging consent token contents:** Consent scope is opaque to the Neuron per CSNT-04. Do not log consented_actions or clinical details.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket protocol framing | Manual TCP frame parsing | `ws` library | WebSocket protocol has masking, fragmentation, close frames, ping/pong, extension negotiation. The RFC is 90+ pages. |
| WebSocket upgrade negotiation | Manual HTTP upgrade headers | `ws` handleUpgrade | Sec-WebSocket-Key/Accept hash, protocol negotiation, extension negotiation are error-prone to implement manually |
| Backpressure detection | Custom buffer tracking | `ws.bufferedAmount` + `send()` callback | `ws` already tracks outgoing buffer size and provides callback on send completion |

**Key insight:** The `ws` library handles all the WebSocket protocol complexity (frame masking, fragmentation, close handshake, ping/pong keepalive). The Neuron code should focus exclusively on the consent handshake business logic, not transport-layer concerns.

## Common Pitfalls

### Pitfall 1: Leaked Event Listeners on WebSocket Close
**What goes wrong:** WebSocket connections that close abnormally (network drop, client crash) leave `message`, `error`, and `close` event listeners attached, causing memory leaks over time.
**Why it happens:** Developers attach listeners in the `connection` event but don't clean them up in all close paths.
**How to avoid:** Use `ws.once('message', ...)` for the auth message. Attach a single `close` handler that cleans up the auth timeout and removes the session from tracking. Always clear `setTimeout` references.
**Warning signs:** Growing event listener count, Node.js "MaxListenersExceededWarning".

### Pitfall 2: No Auth Timeout on First Message
**What goes wrong:** A patient CareAgent connects but never sends the consent token. The connection sits open indefinitely, consuming a slot in the concurrency ceiling.
**Why it happens:** The WebSocket `connection` event fires on upgrade, but there is no guarantee the client will send a message.
**How to avoid:** Set a `setTimeout` immediately on connection. If no message arrives within the timeout, close with a structured error. 10 seconds is generous for programmatic agent-to-agent communication (not human-facing).
**Warning signs:** Growing `activeConnections.size` without corresponding handshake completions.

### Pitfall 3: HTTP Server Not Reusable for Phase 7
**What goes wrong:** Phase 4 creates the HTTP server internally in the protocol server. Phase 7 needs the same server for REST API routes but can't access it.
**Why it happens:** The HTTP server is created as a private implementation detail.
**How to avoid:** Accept an optional `http.Server` in the constructor. If not provided, create one internally. Phase 7 can then provide the shared server. Alternatively, expose the HTTP server via a getter.
**Warning signs:** Phase 7 needing to create a second HTTP server on a different port.

### Pitfall 4: Queued Connections Hanging Forever
**What goes wrong:** When the safety ceiling is hit and connections are queued, a queue entry may never be processed if the server is at capacity for a long time.
**Why it happens:** No timeout on the pending upgrade queue.
**How to avoid:** Set a queue timeout (e.g., 30 seconds). If a queued connection isn't promoted to active within the timeout, send a 503 and destroy the raw socket. This is the only case where a connection is "rejected" -- and it's after a generous wait, not an immediate refusal.
**Warning signs:** Growing `pendingUpgrades` array size.

### Pitfall 5: Not Handling the `wsClientError` Event
**What goes wrong:** Invalid WebSocket upgrade requests (malformed headers, wrong protocol) cause errors that crash the server if unhandled.
**Why it happens:** The `ws` library emits `wsClientError` for errors that occur before the WebSocket connection is established. Without a listener, the raw socket leaks.
**How to avoid:** Always attach a `wsClientError` handler on the WebSocketServer instance. The handler should destroy the socket.
**Warning signs:** Server crashes on malformed upgrade requests.

### Pitfall 6: Testing Port Conflicts
**What goes wrong:** Tests that start an HTTP server on a fixed port fail intermittently in CI due to port conflicts.
**Why it happens:** Multiple test files running in parallel, or previous test didn't clean up the server.
**How to avoid:** Use port 0 (OS-assigned ephemeral port) in tests. Read the assigned port from `server.address().port` after listening. Always close the server in `afterEach`.
**Warning signs:** `EADDRINUSE` errors in CI, flaky test runs.

### Pitfall 7: Provider Endpoint Not Available During Handshake
**What goes wrong:** The consent token is valid and the relationship would be established, but the target provider CareAgent's endpoint is unknown or unreachable.
**Why it happens:** The provider is registered with Axon but their CareAgent isn't running, or the Neuron doesn't have the provider's direct endpoint yet.
**How to avoid:** The handshake establishes a relationship record and returns the provider endpoint from the registration state. If the provider's endpoint is not available, the handshake can still succeed (relationship is created), but the response should indicate the provider is not currently reachable. The patient CareAgent can retry the direct connection later.
**Warning signs:** Handshakes succeeding but patients unable to reach providers.

## Code Examples

Verified patterns from official sources:

### WebSocket Server Setup (noServer mode)
```typescript
// Source: https://github.com/websockets/ws#multiple-servers-sharing-a-single-https-server
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export function createHandshakeServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024, // 64 KB max message size for handshake
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);

    if (url.pathname === '/ws/handshake') {
      socket.on('error', (err) => {
        // Error before upgrade completes -- destroy socket
      });
      wss.handleUpgrade(request, socket, head, (ws) => {
        socket.removeAllListeners('error');
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}
```

### Graceful Server Shutdown
```typescript
// Source: https://github.com/websockets/ws/blob/master/doc/ws.md (close method)
async function shutdownServer(
  wss: WebSocketServer,
  httpServer: HttpServer,
  sessions: Map<string, HandshakeSession>,
): Promise<void> {
  // 1. Stop accepting new connections
  // 2. Close all active WebSocket connections
  for (const [id, session] of sessions) {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.close(1001, 'Server shutting down');
    }
    sessions.delete(id);
  }

  // 3. Close WebSocket server
  await new Promise<void>((resolve) => wss.close(() => resolve()));

  // 4. Close HTTP server
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
}
```

### Testing WebSocket Server with Vitest
```typescript
// Source: community pattern verified across multiple sources
// https://github.com/ITenthusiasm/testing-websockets
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocket } from 'ws';

let httpServer: HttpServer;
let port: number;

beforeEach(async () => {
  httpServer = createServer();
  // Start NeuronProtocolServer with the http server
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
});

it('should accept WebSocket connection on /ws/handshake', async () => {
  const ws = new WebSocket(`ws://localhost:${port}/ws/handshake`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.close();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Node.js had no built-in WebSocket | Node.js 22.4 has stable WebSocket client (via Undici) | Node.js v22.4.0 (2024) | Tests can use built-in `WebSocket` class as client; server still requires `ws` |
| `ws` v7 separate import paths | `ws` v8 unified ESM/CJS exports | ws v8.0.0 (2021) | Use `import { WebSocketServer } from 'ws'` directly |
| `socket.io` for everything | `ws` for server, built-in for client | 2023-2024 ecosystem shift | Lightweight servers prefer `ws`; `socket.io` is for apps needing rooms, reconnection, fallbacks |

**Deprecated/outdated:**
- `ws` `new WebSocket.Server()` constructor -- use `new WebSocketServer()` named export instead
- `socket.io` v2 long-polling fallback -- modern browsers all support WebSocket natively

## Discretion Recommendations

Based on research, here are recommendations for areas marked as Claude's Discretion:

### Auth Timeout: 10 seconds
**Rationale:** This is agent-to-agent communication, not human-facing. A CareAgent programmatically connects and immediately sends the consent token. 10 seconds is generous for programmatic use while preventing stale connections from consuming ceiling slots.

### Message Format: Typed JSON envelopes
**Rationale:** Each message has a `type` field for dispatch (`handshake.auth`, `handshake.challenge`, `handshake.challenge_response`, `handshake.complete`, `handshake.error`). This is pragmatic and forward-compatible -- when Axon's protocol spec lands, the message types can be updated without changing the transport layer. JSON text frames (not binary) for simplicity and debuggability.

### Backpressure Strategy: Queue with timeout
**Rationale:** When the safety ceiling is reached, hold the TCP upgrade in a pending queue. Process queued connections as slots open. If a connection stays queued beyond 30 seconds, send 503 and destroy. This honors the "never turn away a patient CareAgent" principle while preventing unbounded resource consumption.

### Port: Same port, path-based routing
**Rationale:** Use `noServer` mode with path `/ws/handshake`. The HTTP server on the configured `server.port` handles both WebSocket upgrades and (later) REST API requests. One port is simpler for firewall configuration and deployment.

### Message Size Limit: 64 KB
**Rationale:** Handshake messages are small JSON payloads (consent tokens, nonces, addresses). 64 KB is generous. The `ws` `maxPayload` option enforces this automatically and disconnects clients that exceed it.

### Frame Type: Text only
**Rationale:** All handshake messages are JSON. Binary frames add no value and complicate debugging. Reject binary frames with an error.

### Provider Unavailable: Succeed handshake, flag provider status
**Rationale:** The relationship establishment (consent verification + record creation) does not require the provider CareAgent to be online. The handshake succeeds, the relationship is recorded, and the response includes the provider's last-known endpoint. If the provider is offline, the patient's CareAgent can retry direct connection later. Separating "consent is valid" from "provider is reachable" is cleaner.

## Config Schema Extension

The `NeuronConfig` type needs a `websocket` section:

```typescript
// Addition to src/types/config.ts
websocket: Type.Object({
  path: Type.String({ default: '/ws/handshake' }),
  maxConcurrentHandshakes: Type.Number({ minimum: 1, default: 10 }),
  authTimeoutMs: Type.Number({ minimum: 1000, default: 10000 }),
  queueTimeoutMs: Type.Number({ minimum: 1000, default: 30000 }),
  maxPayloadBytes: Type.Number({ minimum: 1024, default: 65536 }),
}),
```

## Integration Points

### Existing Code to Consume (Phase 3)
- `ConsentHandshakeHandler` (`src/relationships/handshake.ts`) -- drives the challenge-response flow
- `verifyConsentToken` (`src/consent/verifier.ts`) -- validates Ed25519 signatures on consent tokens
- `RelationshipStore` (`src/relationships/store.ts`) -- persists new relationship records
- `AuditLogger` (`src/audit/logger.ts`) -- logs `connection` category audit events

### Existing Code to Modify
- `src/types/config.ts` -- add `websocket` section to `NeuronConfigSchema`
- `src/config/defaults.ts` -- add default values for websocket config
- `src/cli/commands/start.ts` -- wire `NeuronProtocolServer` into the startup/shutdown lifecycle

### Interface to Satisfy (provider-core)
```typescript
// From provider-core/src/protocol/types.ts
interface ProtocolSession {
  sessionId: string;
  patientAgentId: string;
  providerAgentId: string;
  startedAt: string;
  status: 'active' | 'completed' | 'terminated';
}

interface ProtocolServer {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  activeSessions(): ProtocolSession[];
}
```

### Audit Events
The `connection` audit category already exists in `src/types/audit.ts`. Phase 4 should emit:
- `connection.handshake_started` -- when a patient CareAgent connects and sends auth
- `connection.handshake_completed` -- when handshake succeeds (includes relationship_id)
- `connection.handshake_failed` -- when handshake fails (includes error code)
- `connection.timeout` -- when auth timeout fires

## Handshake Flow (Complete Sequence)

```
Patient CareAgent                    Neuron
      |                                |
      |--- WebSocket CONNECT --------->|  (1) TCP upgrade to /ws/handshake
      |                                |  (2) Neuron starts auth timeout (10s)
      |                                |
      |--- handshake.auth ------------>|  (3) Consent token + patient_agent_id + patient_endpoint
      |                                |  (4) Verify consent token signature (Ed25519)
      |                                |  (5) Check token not expired
      |                                |  (6) Resolve provider NPI from token claims
      |                                |  (7) Check provider is registered with this Neuron
      |                                |
      |<-- handshake.challenge --------|  (8) Send challenge nonce for identity verification
      |                                |
      |--- handshake.challenge_response|  (9) Patient signs nonce with private key
      |                                |  (10) Verify challenge-response signature
      |                                |  (11) Create/confirm relationship record
      |                                |  (12) Log audit event
      |                                |
      |<-- handshake.complete ---------|  (13) Return relationship_id + provider_endpoint
      |                                |  (14) Close WebSocket (1000 normal closure)
      |                                |
```

## Open Questions

1. **Provider endpoint format**
   - What we know: The provider CareAgent has an endpoint registered with the Neuron (from `provider_registrations` table via Axon registration).
   - What's unclear: The exact format of the provider endpoint URL (is it a WebSocket URL? HTTP? Is it the Neuron endpoint URL with a provider path?). This depends on how provider-core's Phase 5 implements the NeuronClient.
   - Recommendation: Return the `neuron_endpoint_url` from config combined with provider NPI as a path segment, e.g., `ws://neuron-host:3000/ws/provider/{npi}`. This can be revised when Axon's protocol spec is finalized. The important thing is to return *something* that enables direct P2P communication.

2. **Existing relationship re-establishment**
   - What we know: The handshake creates a new relationship. But what if a patient connects with a consent token for a provider they already have an active relationship with?
   - What's unclear: Should the Neuron re-issue the address exchange without creating a duplicate relationship? Or should it reject with "relationship already exists"?
   - Recommendation: If an active relationship already exists between this patient_agent_id and provider_npi, skip relationship creation and return the existing relationship_id with the provider endpoint. This supports the "reconnect" scenario where a patient CareAgent lost the provider's address.

3. **Axon protocol spec dependency**
   - What we know: Axon's Phase 4 (Protocol + Broker) is being built in parallel. The consent token wire format and handshake protocol are not yet finalized.
   - What's unclear: Whether the handshake message format will need to change significantly when Axon's spec lands.
   - Recommendation: Keep the message format as simple typed JSON envelopes. The `type` field makes it easy to add new message types. Design for replaceability, not permanence. Use TypeBox schemas for message validation so changes are caught at compile time.

## Sources

### Primary (HIGH confidence)
- `provider-core/src/protocol/types.ts` -- ProtocolServer and ProtocolSession interface definitions (read directly from codebase)
- `provider-core/src/neuron/types.ts` -- NeuronClient interface (read directly from codebase)
- [ws GitHub repository](https://github.com/websockets/ws) -- noServer mode, handleUpgrade, connection event, close patterns
- [ws API documentation](https://github.com/websockets/ws/blob/master/doc/ws.md) -- WebSocketServer options, WebSocket events, bufferedAmount, send callback

### Secondary (MEDIUM confidence)
- [Node.js WebSocket documentation](https://nodejs.org/en/learn/getting-started/websocket) -- confirms Node.js 22 has stable WebSocket client but no built-in server
- [Testing WebSockets with Vitest](https://github.com/ITenthusiasm/testing-websockets) -- community testing patterns for ws + vitest
- [ws npm package](https://www.npmjs.com/package/ws) -- version 8.19.0, 70M+ weekly downloads

### Tertiary (LOW confidence)
- [WebSocket backpressure patterns](https://medium.com/@hadiyolworld007/node-js-websockets-backpressure-flow-control-patterns-for-stable-real-time-apps-27ab522a9e69) -- general backpressure strategies (not specific to handshake-only pattern)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `ws` is the undisputed standard for Node.js WebSocket servers; verified via npm stats and official docs
- Architecture: HIGH -- noServer pattern is well-documented in ws README; ProtocolServer interface read directly from provider-core source
- Pitfalls: HIGH -- derived from codebase analysis (existing patterns for cleanup, timeouts, testing) and ws documentation
- Handshake protocol: MEDIUM -- message format is Claude's discretion; designed for forward-compatibility with Axon spec that doesn't exist yet
- Provider endpoint format: LOW -- depends on provider-core Phase 5 and Axon Phase 4, neither of which are implemented yet

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days -- stable domain, `ws` library mature)
