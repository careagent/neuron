# Phase 5: Local Discovery - Research

**Researched:** 2026-02-22
**Domain:** mDNS/DNS-SD service advertisement and local network discovery
**Confidence:** HIGH

## Summary

Phase 5 adds local network discovery so CareAgents on the same LAN can find the Neuron via mDNS/DNS-SD (RFC 6762/6763) without requiring Axon registry lookups. The Neuron advertises a `_careagent-neuron._tcp` service with TXT records containing organization NPI, protocol version, and connection endpoint. Local connections use the exact same WebSocket consent handshake flow as remote connections — no security shortcuts.

The Node.js ecosystem has mature, pure-JavaScript mDNS libraries that avoid native bindings. `bonjour-service` is the recommended library: it's written in TypeScript, actively maintained (v1.3.0, Nov 2024), provides a simple publish/unpublish/find API with TXT record support, and has zero native dependencies. The existing project already uses `ws` for WebSocket routing (Phase 4) — local connections flow through the same `NeuronProtocolServer` and consent handshake handler.

**Primary recommendation:** Use `bonjour-service` for mDNS advertisement with a thin `DiscoveryService` wrapper that starts/stops with the Neuron lifecycle. Local connections connect to the same WebSocket endpoint — no separate server or path needed. Add a `neuron discover` CLI command using `bonjour-service`'s `find()` API for debugging.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Standard metadata: organization NPI + protocol version + connection endpoint
- Protocol version uses semantic format (v1.0) for client compatibility checks
- TXT record key format and endpoint shape (full URL vs host:port) are Claude's discretion, following RFC 6763 conventions
- Neuron advertises only — does not browse for other Neurons or CareAgents on the LAN
- Include a CLI scan command (e.g., `neuron discover` or `neuron scan`) for debugging and verifying advertisement works
- Local CareAgent connections use the same endpoint or a separate path — Claude's discretion, guided by DISC-04 (same consent flow, no security shortcuts)
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISC-01 | mDNS/DNS-SD advertisement with service type `_careagent-neuron._tcp` | `bonjour-service` publish API with type parameter; RFC 6763 service type naming |
| DISC-02 | TXT record with organization NPI, protocol version, and connection endpoint | `bonjour-service` txt option accepts key/value object; RFC 6763 key conventions (<=9 chars) |
| DISC-03 | Auto-start/stop with Neuron lifecycle (configurable via `localNetwork.enabled`) | `bonjour-service` publish/unpublishAll/destroy lifecycle; integrate into start.ts shutdown handler |
| DISC-04 | Same consent verification flow as remote connections (no security shortcuts for local) | Local connections use same WebSocket endpoint (`/ws/handshake`) and same `createConnectionHandler` — zero code changes to handshake flow |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bonjour-service | ^1.3.0 | mDNS/DNS-SD advertisement and browsing | TypeScript-native, pure JS (no native bindings), actively maintained, simple publish/find API with TXT records. Wraps multicast-dns. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| multicast-dns | ^7.2.5 | Low-level mDNS protocol (transitive dep) | Pulled in by bonjour-service; not used directly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bonjour-service | @homebridge/ciao | More RFC-strict (6762+6763 compliant), but heavier API surface; designed for HAP/HomeKit patterns. Better for complex multi-service scenarios. |
| bonjour-service | mdns (native) | Native bindings to system mDNS (mDNSResponder/avahi); requires compile toolchain, platform-specific build issues. Not suitable for pure-JS project. |
| bonjour-service | multicast-dns (raw) | Lower-level, more control but requires hand-rolling DNS-SD record construction (SRV, TXT, PTR records). bonjour-service already wraps this cleanly. |

**Installation:**
```bash
pnpm add bonjour-service
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── discovery/
│   ├── index.ts            # Public exports
│   ├── service.ts          # DiscoveryService class (advertise/stop lifecycle)
│   ├── types.ts            # DiscoveryConfig, TXT record types
│   └── discovery.test.ts   # Unit tests
├── cli/
│   └── commands/
│       └── discover.ts     # `neuron discover` CLI command
```

### Pattern 1: DiscoveryService Wrapper
**What:** Thin wrapper around bonjour-service that manages the mDNS advertisement lifecycle
**When to use:** Always — encapsulates bonjour-service behind project interface for testability and clean shutdown

```typescript
import Bonjour, { type Service } from 'bonjour-service'

interface DiscoveryConfig {
  enabled: boolean
  organizationNpi: string
  protocolVersion: string
  endpointUrl: string
  serverPort: number
}

class DiscoveryService {
  private bonjour: Bonjour | null = null
  private service: Service | null = null

  constructor(private readonly config: DiscoveryConfig) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return

    this.bonjour = new Bonjour()
    this.service = this.bonjour.publish({
      name: `neuron-${this.config.organizationNpi}`,
      type: 'careagent-neuron',  // becomes _careagent-neuron._tcp
      port: this.config.serverPort,
      txt: {
        npi: this.config.organizationNpi,
        ver: this.config.protocolVersion,
        ep: this.config.endpointUrl,
      },
    })
  }

  async stop(): Promise<void> {
    if (this.bonjour) {
      this.bonjour.unpublishAll(() => {
        this.bonjour?.destroy()
        this.bonjour = null
        this.service = null
      })
    }
  }
}
```

### Pattern 2: Same WebSocket Endpoint for Local Connections
**What:** Local CareAgents connect to the same `/ws/handshake` path as remote ones
**When to use:** Always — DISC-04 requires identical consent flow

The TXT record advertises the full endpoint URL (e.g., `ws://192.168.1.5:3000/ws/handshake`). A local CareAgent reads the TXT record and connects to that URL. The connection hits `NeuronProtocolServer` and goes through `createConnectionHandler` — the exact same consent verification, challenge-response, and relationship creation flow. Zero code changes needed in routing/handler.ts.

### Pattern 3: CLI Scan Command
**What:** `neuron discover` command browses the local network for Neuron advertisements
**When to use:** Development, debugging, and verifying that advertisement is working

```typescript
import Bonjour from 'bonjour-service'

// One-shot mode: scan for 3 seconds, print results, exit
const bonjour = new Bonjour()
const browser = bonjour.find({ type: 'careagent-neuron' })

browser.on('up', (service) => {
  console.log(`Found: ${service.name}`)
  console.log(`  NPI: ${service.txt?.npi}`)
  console.log(`  Endpoint: ${service.txt?.ep}`)
  console.log(`  Version: ${service.txt?.ver}`)
})

setTimeout(() => {
  browser.stop()
  bonjour.destroy()
}, 3000)
```

### Anti-Patterns to Avoid
- **Separate WebSocket server for local connections:** Creates code duplication and risk of divergent security behavior. Use the same server.
- **Skipping consent for "trusted" local connections:** Violates DISC-04. Local != trusted.
- **Caching mDNS discovery results:** mDNS is inherently transient. Don't persist discovered services.
- **Using native mdns bindings:** Adds compile-time dependencies and platform fragility to a pure-JS project.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| mDNS packet construction | Custom UDP multicast with DNS record encoding | bonjour-service | mDNS has complex record types (PTR, SRV, TXT, A/AAAA), timing rules, conflict resolution, and goodbye packets |
| DNS-SD service registration | Manual PTR + SRV + TXT record management | bonjour-service publish() | RFC 6763 has specific record naming, browsing domain, and TXT encoding rules |
| TXT record encoding | Manual key=value binary encoding | bonjour-service txt option | TXT records have specific byte-length encoding per RFC 6763 Section 6 |
| Network interface enumeration | Manual os.networkInterfaces() parsing | bonjour-service (handles internally) | Virtual interfaces, link-local addresses, and IPv6 scope IDs are tricky edge cases |

**Key insight:** mDNS/DNS-SD is a deceptively complex protocol family. The packet format looks simple but correct behavior requires multicast group management, record TTLs, goodbye packets on shutdown, conflict detection, and probe/announce timing. Libraries handle all of this.

## Common Pitfalls

### Pitfall 1: Forgetting Goodbye Packets on Shutdown
**What goes wrong:** Neuron shuts down but other mDNS browsers still show it as available for the TTL duration (typically 75 minutes)
**Why it happens:** Process killed without graceful shutdown; bonjour-service.destroy() not called
**How to avoid:** Always call `unpublishAll()` then `destroy()` in the shutdown handler. Hook SIGINT/SIGTERM (already done in start.ts pattern).
**Warning signs:** After stopping the Neuron, `neuron discover` or `dns-sd -B` still shows the service

### Pitfall 2: TXT Record Key Length Exceeding 9 Characters
**What goes wrong:** Oversized mDNS packets, potential fragmentation on 802.11 networks
**Why it happens:** RFC 6763 Section 6.4 recommends keys be no more than 9 characters
**How to avoid:** Use short keys: `npi`, `ver`, `ep` (not `organization_npi`, `protocol_version`, `endpoint_url`)
**Warning signs:** TXT record exceeds 256 bytes total

### Pitfall 3: Port 5353 Already in Use
**What goes wrong:** mDNS library fails to bind because system mDNS responder (mDNSResponder on macOS, avahi on Linux) already holds port 5353
**Why it happens:** Default mDNS port is 5353; system daemons bind it exclusively
**How to avoid:** bonjour-service uses `reuseAddr: true` by default on the multicast socket, which allows coexistence with system mDNS responders. Test on macOS (mDNSResponder) and Linux (avahi-daemon) to verify.
**Warning signs:** EADDRINUSE errors on startup

### Pitfall 4: IPv6 Link-Local Complexity
**What goes wrong:** mDNS advertises IPv6 link-local addresses that remote clients can't resolve without zone IDs
**Why it happens:** Link-local IPv6 (fe80::) addresses require a zone ID (e.g., %en0) that's interface-specific
**How to avoid:** For v1, consider `disableIPv6: true` on bonjour-service unless IPv6 is specifically needed. The endpoint URL in TXT records should use IPv4. Can add IPv6 in a future phase.
**Warning signs:** Clients get AAAA records but can't connect

### Pitfall 5: Service Name Collisions on Multi-Neuron LANs
**What goes wrong:** Two Neurons with the same service name cause mDNS conflict resolution, one gets renamed
**Why it happens:** Default service names collide when multiple Neurons run on the same network
**How to avoid:** Use NPI in the service instance name: `neuron-{NPI}`. NPIs are globally unique.
**Warning signs:** Service name gets unexpected suffix (e.g., "neuron-1234567890 (2)")

## Code Examples

### Publishing a Service with TXT Records
```typescript
// Source: bonjour-service npm README + RFC 6763 conventions
import Bonjour from 'bonjour-service'

const bonjour = new Bonjour()

const service = bonjour.publish({
  name: 'neuron-1234567890',           // Instance name (NPI-based for uniqueness)
  type: 'careagent-neuron',             // Service type (becomes _careagent-neuron._tcp)
  port: 3000,                           // WebSocket server port
  txt: {
    npi: '1234567890',                  // Organization NPI (10 digits)
    ver: 'v1.0',                        // Protocol version (semantic)
    ep: 'ws://192.168.1.5:3000/ws/handshake',  // Full connection endpoint
  },
})

// service is now being advertised via mDNS
```

### Graceful Shutdown
```typescript
// Source: bonjour-service npm README
async function stopDiscovery(bonjour: Bonjour): Promise<void> {
  return new Promise<void>((resolve) => {
    bonjour.unpublishAll(() => {
      bonjour.destroy()
      resolve()
    })
  })
}
```

### Browsing for Services (CLI discover command)
```typescript
// Source: bonjour-service npm README
import Bonjour from 'bonjour-service'

const bonjour = new Bonjour()
const browser = bonjour.find({ type: 'careagent-neuron' })

browser.on('up', (service) => {
  const txt = service.txt as Record<string, string> | undefined
  console.log(`  ${service.name}`)
  console.log(`    NPI:      ${txt?.npi ?? 'unknown'}`)
  console.log(`    Version:  ${txt?.ver ?? 'unknown'}`)
  console.log(`    Endpoint: ${txt?.ep ?? 'unknown'}`)
  console.log(`    Host:     ${service.host}:${service.port}`)
})

browser.on('down', (service) => {
  console.log(`  Lost: ${service.name}`)
})
```

### Integration Point in start.ts
```typescript
// After WebSocket server starts, before Axon registration:
if (config.localNetwork.enabled) {
  const discoveryService = new DiscoveryService({
    enabled: true,
    organizationNpi: config.organization.npi,
    protocolVersion: 'v1.0',
    endpointUrl: `ws://${config.server.host}:${config.server.port}${config.websocket.path}`,
    serverPort: config.server.port,
  })
  await discoveryService.start()
  output.info('Local network discovery active')
  // Add to shutdown handler
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| mdns (native C bindings) | bonjour-service (pure JS/TS) | ~2022 | No compile toolchain needed; cross-platform without platform-specific build scripts |
| bonjour (watson/bonjour) | bonjour-service (onlxltd fork) | 2022 | TypeScript rewrite, active maintenance, bug fixes |
| Manual multicast-dns record handling | bonjour-service high-level API | ongoing | Abstracts away PTR/SRV/TXT record construction |

**Deprecated/outdated:**
- `mdns` npm package: Native bindings, requires mDNSResponder SDK on macOS and avahi-compat-libdns_sd on Linux. Last meaningful update years ago.
- `bonjour` (original): Unmaintained; `bonjour-service` is the active TypeScript fork.
- `mdns-js`: Slow development, may conflict with system mDNS daemons.
- `dnssd`: Last published 2018, effectively abandoned.

## Open Questions

1. **Endpoint URL format in TXT records**
   - What we know: RFC 6763 allows arbitrary key/value strings in TXT records. The endpoint needs to contain enough info for a CareAgent to connect.
   - What's unclear: Whether to use full WebSocket URL (`ws://host:port/path`) or just `host:port` with the path implied by protocol version.
   - Recommendation: Use full URL (`ws://192.168.1.5:3000/ws/handshake`). More explicit, self-contained, and future-proof if paths change. Fits within TXT record limits.

2. **Hot toggle vs restart for `localNetwork.enabled`**
   - What we know: bonjour-service can be started/stopped at any time. The Neuron config is loaded once at startup.
   - What's unclear: Whether runtime config changes should trigger discovery start/stop without a full Neuron restart.
   - Recommendation: Require restart for v1 (simplest). Config is already load-once. Hot toggle adds complexity (config watching, partial lifecycle management) with minimal user benefit.

3. **Interface-specific advertisement logging**
   - What we know: User wants info-level logs showing which interfaces are advertising. bonjour-service binds to all interfaces by default.
   - What's unclear: bonjour-service doesn't expose a per-interface callback. May need to use `os.networkInterfaces()` to enumerate and log.
   - Recommendation: After `publish()`, enumerate `os.networkInterfaces()` and log non-internal IPv4 addresses. This is informational only — bonjour-service handles the actual binding.

## Sources

### Primary (HIGH confidence)
- bonjour-service npm registry — version 1.3.0, TypeScript, published Nov 2024, depends on multicast-dns ^7.2.5
- multicast-dns npm registry — version 7.2.5, 14M+ weekly downloads
- @homebridge/ciao npm registry — version 1.3.5, RFC 6762/6763 compliant alternative
- RFC 6763 (DNS-Based Service Discovery) — TXT record key conventions, service type naming

### Secondary (MEDIUM confidence)
- bonjour-service GitHub README (onlxltd/bonjour-service) — API examples, publish/find patterns
- homebridge/ciao GitHub README — API comparison, shutdown pattern with goodbye packets

### Tertiary (LOW confidence)
- None — all findings verified against npm registry and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — bonjour-service is well-established, TypeScript-native, actively maintained, verified via npm registry
- Architecture: HIGH — pattern follows existing project conventions (src/module/ structure, wrapper service class, CLI command pattern)
- Pitfalls: HIGH — common mDNS issues are well-documented in RFCs and library documentation

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (30 days — stable domain, mature libraries)
