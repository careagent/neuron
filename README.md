# neur# careagent/neuron

**The organization-level Axon node — free, open-source, for any NPI-holding organization.**

The Neuron is a lightweight application that serves as the public-facing endpoint for any organization that participates in patient care: medical practices, hospitals, pharmacies, imaging centers, laboratories, urgent care facilities, specialty clinics, and any other NPI-holding entity.

It is the organizational membrane between the national Axon network and the individual provider CareAgents operating behind it. Provider CareAgents are never exposed directly to the national network. They sit behind the Neuron, which manages all inbound and outbound connections on their behalf.

---

## The Neuron Is Free

The Neuron is free of charge to any NPI-holding organization. This is non-negotiable.

Charging for the organizational endpoint would exclude exactly the organizations that most need this infrastructure — small independent practices, rural clinics, community pharmacies, safety net hospitals. The organizations serving the most vulnerable patients are the ones with the least IT budget.

The Neuron is infrastructure. Not a product. Its economics are sustained by the ecosystem it enables, not by access fees.

---

## The Biological Metaphor

In the CareAgent ecosystem:

- **CareAgents** are the individual cellular intelligence — each provider and patient has their own sovereign brain.
- **Axon** is the open foundation network connecting nodes nationally.
- **The Neuron** is the organizational node — the boundary unit that connects the national network to the individual CareAgents behind it.

Just as a biological neuron is the organizational unit of the nervous system, the Neuron is the organizational unit of the CareAgent network. Signals arrive from the Axon network, are processed at the Neuron, and are routed to the appropriate CareAgent behind it.

---

## What the Neuron Does

### National Registration
Registers the organization and its providers with the national Axon network using the NPI as the universal identifier. Any NPI-holding provider at the organization is discoverable nationally through Axon once registered with the Neuron.

### Patient CareAgent Routing
Routes incoming patient CareAgent connections to the correct provider CareAgent based on the established relationship record. The Neuron knows which patients have relationships with which providers. It does not hold clinical data — only routing information.

### Local Network Discovery
When a patient is physically present at the organization, their CareAgent can discover and connect to the Neuron over the local network — WiFi, Bluetooth, or NFC depending on proximity. No national Axon infrastructure is involved. This is the highest trust state: physical presence plus local network plus cryptographic identity verification.

### Consent Verification
Verifies that a care relationship and valid consent exist before routing any connection to a provider CareAgent. No connection is established without a verified relationship record.

### Relationship Registration
Records new care relationships when established through the consent handshake. Stores routing information only — never clinical data.

### Scheduling and Billing Data Layer
The lightweight organizational data store for scheduling and billing information. This is the provider's minimal "EMR" — not a clinical data warehouse, but the operational data needed to run a practice:

- Appointment scheduling
- Billing and claims data
- CPT/ICD coding records
- Provider availability and coverage

Clinical data lives with the patient. The Neuron holds only what the organization needs to operate.

### Third-Party API
Exposes a well-documented local API for third-party applications to interact with the CareAgent ecosystem. Practice management tools, billing systems, scheduling interfaces, and stripped-down clinical workflow applications all connect through this API. Third-party tools never communicate directly with the national Axon network or with individual CareAgents — they communicate with the Neuron.

### Authorized Patient Chart Sync Endpoint
Receives Patient Chart updates from patient CareAgents for organizations that have been granted authorized read access by patients. Acts as a sync endpoint for live record propagation.

### Relationship Termination Handling
Manages state-protocol-compliant provider-initiated care relationship termination. When a provider terminates a care relationship following the applicable state protocol, the Neuron:

- Coordinates the termination event with the provider's CareAgent
- Stops routing that patient's CareAgent connections to the provider
- Maintains the audit record of the termination

The termination event is written to the patient's immutable Patient Chart by the provider's credentialed CareAgent. The Neuron does not write to the Patient Chart — only the provider's CareAgent does.

---

## Applicability

The Neuron architecture applies to any NPI-holding organization:

| Organization Type | Neuron Function |
|------------------|----------------|
| Medical practice | Routes patient connections to provider CareAgents; scheduling and billing |
| Hospital | Routes to department or provider CareAgents; institutional scheduling and billing |
| Pharmacy | Receives prescription communications; delivers dispensing confirmations |
| Imaging center | Delivers imaging results to patient Patient Charts |
| Laboratory | Delivers lab results to patient Patient Charts |
| Urgent care | Handles episodic relationship establishment and documentation |
| Specialty clinic | Routes to specialist CareAgents; specialty scheduling and billing |

Every organization that touches a patient's care has an NPI. Every NPI-holding organization can run a Neuron.

---

## Resilience and Local-First Operation

The Neuron operates independently of national Axon connectivity for established relationships. If the national Axon network is unreachable:

- Established relationships stored in the Neuron's routing store allow patient CareAgent connections to proceed normally
- The local network discovery mechanism continues to function for physically present patients
- All events are logged locally and sync with the national Axon layer when connectivity restores

New relationship discovery through the national registry is unavailable during outages. Established care continues without interruption.

---

## The Neuron API and SDK

The Neuron is the integration surface for the entire third-party developer ecosystem. Third-party applications never communicate directly with Axon or with individual CareAgents — they communicate with the Neuron. This is by design. Axon is a closed protocol layer. The Neuron is the intentional, hardened boundary between the CareAgent network and everything outside it.

The Neuron exposes two integration surfaces:

**The Neuron API** — a REST API for local application integration. Practice management tools, billing systems, scheduling interfaces, and specialty workflow applications query this API to interact with the CareAgent ecosystem. Clinical data is not held by these tools — they query it through the API when needed and write back through the credentialed access the Neuron manages.

**The Neuron SDK** — a TypeScript client library for building applications on top of the Neuron API. The SDK is the primary resource for third-party developers building on the CareAgent ecosystem. It abstracts the Neuron API surface, handles authentication, and provides typed interfaces for all Neuron operations.

```bash
pnpm add @careagent/neuron-sdk
```

The barrier to entry for building clinical tools drops from tens of millions of dollars to the cost of understanding the Neuron SDK and building a clean interface.

See `docs/api.md` for the full API reference and `docs/sdk.md` for the SDK documentation.

---

## Installation

### Requirements

- A valid NPI for the organization or individual provider
- A server or local machine to host the Neuron (on-premise or cloud)
- Network accessibility for patient CareAgent connections (internet) and local network discovery (LAN)

### Install

This project uses [pnpm](https://pnpm.io) as its package manager.

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Clone and install dependencies
git clone https://github.com/careagent/neuron
cd neuron
pnpm install

# Build
pnpm build
```

### Initialize

```bash
neuron init
```

The initialization process registers the organization with the national Axon network, configures provider CareAgent routing, sets up the local network discovery endpoint, and initializes the scheduling and billing data layer.

### Start

```bash
neuron start
```

### Status

```bash
neuron status
```

---

## Configuration

The Neuron is configured through `neuron.config.json`:

```json
{
  "organization": {
    "name": "Example Medical Practice",
    "npi": "1234567890",
    "type": "practice"
  },
  "axon": {
    "registry": "https://registry.axon.careagent.org",
    "endpoint": "https://neuron.example.com"
  },
  "localNetwork": {
    "enabled": true,
    "discovery": ["wifi", "bluetooth"]
  },
  "providers": [
    {
      "agentId": "dr-smith",
      "npi": "0987654321",
      "endpoint": "ws://localhost:4000/agents/dr-smith"
    }
  ],
  "api": {
    "port": 3000,
    "allowedOrigins": ["http://localhost:8080"]
  }
}
```

---

## Local Development

```bash
# Run in development mode
pnpm dev

# Run tests
pnpm test

# Run with mock patient connections
pnpm dev:mock
```

> **Dev platform note:** All development uses synthetic data and mock patient CareAgent connections. No real patient data or PHI is used at this stage.

---

## Repository Structure

```
careagent/neuron/
├── src/
│   ├── index.ts              # Neuron entry point
│   ├── registration/         # National Axon registration and credential management
│   ├── routing/              # Patient CareAgent routing to provider CareAgents
│   ├── discovery/            # Local network discovery endpoint
│   ├── consent/              # Consent verification before routing
│   ├── relationships/        # Relationship registration and routing store
│   ├── scheduling/           # Scheduling and billing data layer
│   ├── api/                  # Third-party local API
│   ├── sync/                 # Authorized Patient Chart sync endpoint
│   └── termination/          # State-protocol-compliant relationship termination
├── test/                     # Test suites
├── docs/
│   ├── api.md                # Full third-party API reference
│   ├── architecture.md       # Neuron architecture guide
│   └── configuration.md      # Full configuration reference
├── neuron.config.json        # Default configuration template
└── package.json              # pnpm package
```

---

## Contributing

CareAgent is released under Apache 2.0. Contributions are welcome from clinicians, developers, health IT professionals, and anyone committed to building trustworthy clinical AI infrastructure.

Before contributing, read the architecture guide in `docs/architecture.md` and the contribution guidelines in `CONTRIBUTING.md`.

---

## Related Repositories

| Repository | Purpose |
|-----------|---------|
| [careagent/provider-core](https://github.com/careagent/provider-core) | Provider-side CareAgent plugin — registers with and routes through the Neuron |
| [careagent/patient-core](https://github.com/careagent/patient-core) | Patient-side CareAgent plugin — connects to the Neuron to reach providers |
| [careagent/patient-chart](https://github.com/careagent/patient-chart) | Patient Chart vault — the Neuron may serve as an authorized sync endpoint |
| [careagent/axon](https://github.com/careagent/axon) | Open foundation network layer — the Neuron registers with and is discoverable through Axon |
| [careagent/provider-skills](https://github.com/careagent/provider-skills) | Provider clinical skills registry |

---

## License

Apache 2.0. See [LICENSE](LICENSE).

The Neuron is free infrastructure. Every line of code in this repository is open, auditable, and improvable by the community it serves.on
