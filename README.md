# @careagent/neuron

The organization-level trust anchor for the CareAgent network. Free, open-source infrastructure for any NPI-holding healthcare organization.

## Why

Every healthcare organization needs a way for patient CareAgents to establish consent and connect with provider CareAgents. The Neuron handles the one-time consent handshake — verifying the patient's consent token, creating the relationship record, exchanging direct addresses between patient and provider CareAgents — then steps out. All clinical communication flows peer-to-peer after the handshake. No PHI ever touches the Neuron.

The Neuron is free. Charging for organizational infrastructure would exclude the small practices and rural clinics that need it most.

## What It Does

- **Trust brokering** — Accepts inbound WebSocket connections from patient CareAgents, verifies Ed25519 consent tokens, creates relationship records, exchanges direct P2P addresses between patient and provider CareAgents, then disconnects
- **Patient directory** — Stores patient CareAgent identifiers, demographics, and consent records for consented relationships (never PHI)
- **Axon registration** — Registers the organization and its providers with the national Axon network using NPI as the universal identifier
- **API gateway** — Exposes a REST API for third-party applications (scheduling tools, billing systems, documentation tools, pharmacy agents) to reach consented patient CareAgents directly
- **Local discovery** — mDNS/DNS-SD advertisement for patient CareAgents on the local network
- **Audit trail** — Hash-chained JSONL log for every operational event (consent, registration, termination)

## What It Does Not Do

- Store or transit clinical data (diagnoses, lab results, prescriptions, treatment notes)
- Relay messages between CareAgents after the handshake
- House scheduling or billing data (third-party apps handle this through the API)
- Stay in the communication path after consent establishment
- Replace an EMR

## Architecture

```
                    Axon Network
                         |
                      Neuron          <-- trust broker, steps out after handshake
                    /    |    \
          Third-party  Patient    Provider
             Apps     CareAgent   CareAgent
                         \         /
                      Direct P2P after consent
```

The Neuron is the organization's membrane to the Axon network. Patient CareAgents connect once to establish consent. After the handshake, everyone knows how to reach everyone else — patient CareAgent talks directly to provider CareAgent, third-party apps reach patient CareAgents directly — until the patient revokes consent or the organization bans the patient.

Any NPI-holding organization can run a Neuron: medical practices, hospitals, pharmacies, imaging centers, laboratories, urgent care facilities, specialty clinics.

## Install

```bash
git clone https://github.com/careagent/neuron
cd neuron
pnpm install
pnpm build
```

## Usage

```bash
# Initialize and register with Axon
neuron init

# Start the Neuron
neuron start

# Manage providers
neuron provider add <npi>
neuron provider list
neuron provider remove <npi>

# Check status
neuron status
```

## Development

```bash
pnpm dev          # Run in development mode
pnpm test         # Run tests
pnpm test:watch   # Watch mode
pnpm test:coverage # Coverage report
pnpm lint         # Type check
```

All development uses synthetic data. No real patient data or PHI at any stage.

## Project Structure

```
src/
├── index.ts            # Package entry point
├── audit/              # Hash-chained JSONL audit logging
├── cli/                # CLI commands (init, start, stop, status, provider)
├── config/             # TypeBox config schema, loader, env overrides
├── consent/            # Ed25519 token verification, challenge-response
├── ipc/                # Unix domain socket IPC (CLI ↔ server)
├── registration/       # Axon registration, heartbeat, state persistence
├── relationships/      # Relationship store, handshake handler, termination
├── storage/            # SQLite engine with migrations
├── types/              # TypeBox schemas for all data models
└── validators/         # NPI Luhn validation
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js >=20.19.0 |
| Language | TypeScript ~5.7.x |
| Build | tsdown ~0.20.x |
| Test | vitest ~4.0.x (80% coverage) |
| Schema | @sinclair/typebox ~0.34.x |
| HTTP | Node.js built-in `http` module |
| Storage | SQLite via better-sqlite3 |
| CLI | Commander |
| License | Apache 2.0 |

## Roadmap

- [x] Phase 1: Foundation (config, audit, storage, types, CLI, NPI validation)
- [ ] Phase 2: Axon Registration (organization/provider registration, heartbeat)
- [x] Phase 3: Consent and Relationships (Ed25519 verification, relationship store, termination)
- [ ] Phase 4: WebSocket Routing (consent handshake, address exchange, broker-and-step-out)
- [ ] Phase 5: Local Discovery (mDNS/DNS-SD)
- [ ] Phase 6: Scheduling and Billing (API gateway for third-party apps)
- [ ] Phase 7: REST API (third-party HTTP API with auth and OpenAPI spec)
- [ ] Phase 8: Patient Chart Sync (incremental sync with revocation)
- [ ] Phase 9: Integration and Documentation (E2E tests, reference docs)

## Related Repositories

| Repository | Purpose |
|-----------|---------|
| [@careagent/axon](https://github.com/careagent/axon) | Open foundation network — discovery, handshake protocol, registry |
| [@careagent/provider-core](https://github.com/careagent/provider-core) | Provider-side CareAgent — registers with and communicates through the Neuron |
| [@careagent/patient-core](https://github.com/careagent/patient-core) | Patient-side CareAgent — connects to the Neuron to establish consent |
| [@careagent/patient-chart](https://github.com/careagent/patient-chart) | Patient Chart vault — immutable clinical record owned by the patient |

## License

Apache 2.0. See [LICENSE](LICENSE).
