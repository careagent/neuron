# Phase 4: WebSocket Routing - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

The Neuron accepts inbound WebSocket connections from patient CareAgents for one-time consent verification and relationship establishment. After verifying consent and creating the relationship record, the Neuron exchanges direct addresses between patient and provider CareAgents, then disconnects. The Neuron does not relay clinical traffic, manage active sessions, or stay in the communication path after the handshake. It implements the `ProtocolServer` interface from provider-core.

**Critical reframe from original ROUT requirements:** The Neuron is a trust broker, not a session relay. ROUT-03 (bidirectional session bridge), ROUT-04 (per-provider concurrency limits as session caps), and ROUT-05 (graceful session termination) as originally written assumed the Neuron stays in the path. They need to be reinterpreted for the broker-and-step-out model.

</domain>

<decisions>
## Implementation Decisions

### Neuron architectural role
- The Neuron is the organization's **trust anchor** on the CareAgent network — not a relay or session manager
- Three responsibilities: (1) trust establishment via consent, (2) patient directory, (3) API gateway for third-party apps
- After consent verification and address exchange, the Neuron steps out completely — all clinical communication is direct P2P between CareAgents
- No PHI ever stored on or flows through the Neuron
- The Neuron CAN store: patient CareAgent identifiers, patient demographics, consent records, relationship records
- The Neuron CANNOT store: clinical data, diagnoses, lab results, treatment notes, prescriptions

### Connection model (broker, not relay)
- Patient CareAgent connects to Neuron via WebSocket for the **one-time** consent establishment
- Neuron verifies consent token, creates relationship record, exchanges direct addresses (patient gets provider CareAgent address, provider CareAgent gets patient CareAgent address)
- Neuron disconnects — no persistent session, no message forwarding
- After establishment, patient CareAgent talks directly to provider CareAgent whenever needed — no check-in with Neuron per interaction
- Each CareAgent logs its own interactions in its own audit trail
- Revocation and consent management are handled P2P between CareAgents, not by the Neuron
- Organization-side banning goes through a third-party app using the Neuron's REST API (Phase 7)

### Authentication flow
- Patient CareAgent presents consent token as the **first message** after WebSocket connect (not query param, not upgrade header)
- Consent token already encodes the relationship — Neuron resolves the target provider from the token (no separate provider NPI field needed)
- On auth failure, Neuron sends a structured JSON error message with error code and reason before closing
- Auth timeout: Claude's discretion (programmatic agent-to-agent, not human-facing)

### Concurrency model
- The Neuron does not manage active P2P sessions — concurrency is not the Neuron's concern after handshake
- A configurable **safety ceiling** exists for simultaneous WebSocket connections to the Neuron itself (the handshake endpoint)
- Default: 10 for development (prevents runaway scripts during dev)
- This is a resource safety guardrail, not a business rule — normal operation should never hit it
- When the ceiling is hit: queue the connection, don't reject it — no patient CareAgent should ever be turned away
- The ceiling is adjustable for production (hundreds or thousands of simultaneous handshakes)

### Multi-organization ecosystem
- Any healthcare organization with an NPI can run a Neuron (practices, labs, pharmacies, imaging centers, etc.)
- Patient CareAgents build a network of consented relationships across multiple Neurons
- The consent flow is identical regardless of organization type — patient consents with the org's Neuron, gets addresses, communicates directly
- When a Neuron registers with Axon, it will eventually advertise what services the organization offers (like an MCP server advertising tools) — not designed yet, but the direction

### Scheduling and billing
- The Neuron is a **gateway** to scheduling and billing, not the system of record
- Scheduling and billing systems are third-party applications that connect through the Neuron's API/SDK
- The Neuron does not house scheduling or billing data itself

### Third-party extensibility
- The Neuron's API/SDK is an extension point for third-party developers
- Third-party apps can build new agent types and communication patterns (documentation tools, pharmacy agents, notification systems) that connect through the Neuron to reach consented patient CareAgents
- The patient directory and consent records stored on the Neuron enable this extensibility

### Resource constraints
- The Neuron must be lightweight — small practices (solo practitioners, 2-person groups) need to run it
- The broker-and-step-out model keeps the Neuron's resource footprint minimal
- Heavy lifting (clinical logic, scheduling systems, documentation tools) lives in CareAgents and third-party apps, not the Neuron

### Claude's Discretion
- Auth timeout duration for the first-message window
- Message format for the handshake exchange (opaque vs envelope) — Axon's protocol spec (Phase 4) is still TBD, so pragmatic approach given both projects are in-flight
- Backpressure strategy if handshake queue builds up
- Whether the WebSocket server runs on the same port (path-based) or a dedicated port
- Message size limits during handshake
- Text vs binary WebSocket frame support
- Provider-unavailable behavior during handshake (provider CareAgent not reachable when patient tries to establish)

</decisions>

<specifics>
## Specific Ideas

- "The Neuron is like a front desk" — knows patients, demographics, consent, but never touches clinical content
- "Like an MCP server" — the Neuron advertises organization capabilities to Axon (future, not Phase 4)
- Patient CareAgent should never be rejected — queue if needed, don't turn away
- The relationship is established once (like signing paperwork at a doctor's office), not per-session
- Axon Phase 4 (Protocol + Broker) is being built in parallel — consent token wire format and handshake protocol are not yet finalized. Neuron should be designed to adapt when Axon's spec lands.

</specifics>

<deferred>
## Deferred Ideas

- **Service advertisement via Axon** — when registering, Neuron advertises organization capabilities (lab services, pharmacy, etc.). MCP-server-like model. Not Phase 4 scope.
- **Roadmap reframe: Phase 6 (Scheduling and Billing)** — currently written as CRUD storage on the Neuron. Should be reframed as API/SDK gateway for third-party scheduling/billing apps. The Neuron doesn't house this data.
- **ROUT requirements rewrite** — ROUT-03, ROUT-04, ROUT-05 need to be reinterpreted for the broker-and-step-out model. They were written assuming the Neuron relays traffic.
- **Third-party agent types** — documentation tools, pharmacy agents, notification systems built by third parties through the Neuron API. Future capability enabled by the extensible API surface.

</deferred>

---

*Phase: 04-websocket-routing*
*Context gathered: 2026-02-22*
