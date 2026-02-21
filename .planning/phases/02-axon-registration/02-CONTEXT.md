# Phase 2: Axon Registration - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The Neuron registers its organization NPI and its providers with the Axon network directory, maintains reachable status through periodic heartbeats, and persists registration state across restarts. Dynamic provider management (add/remove/list) is available via CLI without restarting the server. Graceful degradation when Axon is unreachable keeps established relationships operational. A mock Axon registry supports isolated testing.

</domain>

<decisions>
## Implementation Decisions

### Mock Axon behavior
- Separate test process, not embedded in the Neuron process
- Happy path only — no failure mode simulation (failure handling tested against real Axon later)
- Axon is actively being built in parallel; the mock defines what Neuron expects, interface may evolve
- Claude's discretion on whether mock persists state or starts fresh (optimize for test reliability)

### Provider CLI experience
- `neuron provider add` requires NPI only — minimal input
- `neuron provider list` shows a simple table: NPI, registration status, last heartbeat time
- `neuron provider remove` always confirms interactively before unregistering from Axon
- Provider add/remove takes effect immediately (hot) — CLI contacts running Neuron, which registers/unregisters with Axon right away

### Heartbeat & resilience
- 60-second heartbeat interval (fixed, not configurable)
- Exponential backoff when Axon is unreachable, ceiling is configurable (default 5 minutes) in neuron.config.json
- Degraded state surfaced through: log warnings, `neuron status` command, and an exposed health metric for monitoring systems
- Auto re-register when Axon comes back after outage — self-healing, no operator intervention needed

### Registration data model
- Store both Axon-assigned registration ID and organization NPI (NPI for lookups, Axon ID for API calls)
- Each provider tracks independent registration status (registered/pending/failed) — one failing doesn't block others
- Full timestamps stored: first_registered_at, last_heartbeat_at, last_axon_response_at — useful for debugging and status display

### Claude's Discretion
- Mock Axon state persistence strategy (fresh vs persistent — optimize for test reliability)
- Endpoint information registered with Axon (WebSocket URL, metadata, capabilities)
- Exact backoff algorithm (exponential base, jitter)
- Health metric format and exposure method

</decisions>

<specifics>
## Specific Ideas

- Axon is being actively built in parallel — mock interface should be treated as a moving target
- Provider CLI should be straightforward: NPI-in, immediate registration, simple table output
- Self-healing is important — operator shouldn't need to babysit the Neuron when Axon has a blip

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-axon-registration*
*Context gathered: 2026-02-21*
