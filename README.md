# @careagent/neuron

> Source: [github.com/careagent/neuron](https://github.com/careagent/neuron)

The front door for any organization on the CareAgent network. Free, open-source infrastructure for any organization participating in the healthcare ecosystem — hospitals, practices, medical boards, specialty societies, federal agencies, and more.

## Why

Every organization participating in the healthcare ecosystem needs a presence on the CareAgent network. Clinical organizations need infrastructure enabling patient CareAgents to connect with provider CareAgents. Administrative organizations — state medical boards, specialty certification bodies, federal agencies — need to expose licensing, credentialing, certification, and regulatory services to the network. The Neuron provides this presence through a uniform protocol regardless of what the organization does.

For clinical organizations, the Neuron handles patient-to-provider routing — authenticating inbound connections, matching patients to available provider CareAgent copies, establishing peer-to-peer connections, and then exiting the communication path. All subsequent clinical communication flows directly between parties. The system ensures no Protected Health Information touches the Neuron itself.

For administrative organizations, the Neuron exposes organizational capabilities through its MCP surface — licensing verification, complaint filing, certification status, document repositories, and any other service the organization chooses to offer.

It's offered freely because charging for organizational infrastructure would exclude smaller practices and rural clinics most needing such tools.

## Core Functionality

- **Gateway**: Authenticates inbound CareAgent connections using Ed25519 token verification
- **Provider routing**: Maintains awareness of provider CareAgent copies and their availability, matches inbound patients to available copies
- **P2P brokering**: Establishes peer-to-peer connection between patient and provider CareAgents, then exits the communication path
- **Busy-path handling**: When no provider copy is available, supports callback or retry patterns (design TBD)
- **MCP surface**: Exposes organization-specific capabilities — clinical routing, licensing verification, document repositories, complaint filing, or any other service the organization chooses to offer
- **Axon registration**: Registers with the network directory so CareAgents can discover the organization
- **Audit logging**: Hash-chained JSONL records of operational events

## What It Excludes

The system deliberately does not: store or transmit clinical data, relay messages after P2P is established, house billing information, remain in communication paths after connection, replace EMR systems, classify or triage patient requests (future consideration only), or store PHI in any form.

## Architecture

The Neuron is the front door to an organization on the CareAgent network. Different organizations expose different capabilities behind the same protocol. A hospital's Neuron routes patient-to-provider connections and may integrate with legacy systems. A state medical board's Neuron exposes licensing records and complaint filing. A specialty society's Neuron provides certification status and MOC requirements. The protocol is uniform — what's behind the door is not.

Organizations scale provider availability by running multiple copies of a given provider's CareAgent. The Neuron's routing layer knows how many copies exist and which are available, matching inbound patient connections to free copies. When all copies are busy, the Neuron supports callback or retry patterns so it does not become a persistent connection holder.

Any organization participating in the healthcare ecosystem can operate a Neuron — practices, hospitals, pharmacies, labs, medical boards, specialty societies, and federal agencies.

## Installation & Usage

```bash
git clone https://github.com/careagent/neuron
cd neuron
pnpm install
pnpm build
```

Commands include `neuron init`, `neuron start`, provider management (`add`, `list`, `remove`), and status checking.

## Technical Stack

- **Runtime**: Node.js ≥20.19.0
- **Language**: TypeScript ~5.7.x
- **Build**: tsdown ~0.20.x
- **Testing**: vitest ~4.0.x
- **Schema**: @sinclair/typebox
- **Storage**: SQLite via better-sqlite3
- **License**: Apache 2.0

## Related Projects

- @careagent/axon: Network directory and registry
- @careagent/provider-core: Provider-side agents
- @careagent/patient-core: Patient-side agents
- @careagent/patient-chart: Patient-controlled records vault
