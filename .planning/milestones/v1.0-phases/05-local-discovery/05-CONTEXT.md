# Phase 5: Local Discovery - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

CareAgents on the local network can discover the Neuron via mDNS/DNS-SD and connect with the same consent-verified flow as remote connections. The Neuron advertises itself; it does not browse for peers. A CLI scan command is included for development/debugging. BLE/NFC discovery is out of scope (deferred to future).

</domain>

<decisions>
## Implementation Decisions

### TXT record content
- Standard metadata: organization NPI + protocol version + connection endpoint
- Protocol version uses semantic format (v1.0) for client compatibility checks
- TXT record key format and endpoint shape (full URL vs host:port) are Claude's discretion, following RFC 6763 conventions

### Discovery directionality
- Neuron advertises only — does not browse for other Neurons or CareAgents on the LAN
- Include a CLI scan command (e.g., `neuron discover` or `neuron scan`) for debugging and verifying advertisement works
- Scan command mode (one-shot vs continuous watch) is Claude's discretion
- Local CareAgent connections use the same endpoint or a separate path — Claude's discretion, guided by DISC-04 (same consent flow, no security shortcuts)

### Runtime config behavior
- Hot toggle vs restart-required for `localNetwork.enabled` — Claude's discretion based on complexity tradeoff
- Behavior when `localNetwork.enabled` is false (logging level) — Claude's discretion
- Service instance naming for multi-Neuron LANs — Claude's discretion (NPI-derived or configurable)
- mDNS bind failure handling (fail startup vs warn-and-continue) — Claude's discretion based on how critical discovery is vs overall Neuron function

### Multi-interface handling
- Interface selection (all vs specific, virtual interface filtering) — Claude's discretion for least-surprise behavior
- IP change handling (auto-update vs static at startup) — Claude's discretion for v1 robustness
- Log which interfaces the Neuron is advertising on at startup (info-level, e.g., "Advertising on en0: 192.168.1.5")

### Claude's Discretion
- TXT record key naming convention (following RFC 6763)
- Connection endpoint format in TXT records (full URL vs host:port)
- Scan command mode (one-shot vs --watch continuous)
- Local vs same WebSocket path for local connections
- Hot toggle vs restart for localNetwork.enabled
- Logging level when discovery is disabled
- Service instance naming strategy
- mDNS failure handling at startup
- Interface selection and virtual interface filtering
- IP change re-advertisement behavior

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants standard mDNS/DNS-SD with semantic versioning in TXT records and an info-level log of advertised interfaces.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-local-discovery*
*Context gathered: 2026-02-22*
