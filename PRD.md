# @careagent/neuron — Product Requirements Document

**Version:** 1.0.0-draft
**Date:** 2026-02-21
**Status:** Draft — Pending Review

---

## Guiding Principle: The Organizational Membrane

> *The Neuron is infrastructure. Not a product. Charging for the organizational endpoint would exclude exactly the organizations that most need it — small independent practices, rural clinics, community pharmacies, safety net hospitals. The organizations serving the most vulnerable patients are the ones with the least IT budget.*

The Neuron is free of charge to any NPI-holding organization. This is non-negotiable.

Where Axon says "the channel between them belongs to everyone," the Neuron says "the organization's connection to that channel is free." Every NPI-holding entity — from a solo rural physician to a multi-department hospital — runs the same Neuron. The architecture serves all sizes equally because the infrastructure cost is zero.

---

## 1. Product Overview

### 1.1 What Neuron Is

`@careagent/neuron` is a standalone Node.js server (not a plugin) that provides nine core functionalities:

1. **National Registration** — registers the organization and its providers with the national Axon network using NPI as the universal identifier
2. **Patient CareAgent Routing** — routes incoming patient CareAgent connections to the correct provider CareAgent based on the established relationship record
3. **Local Network Discovery** — enables patient CareAgents to discover and connect over the local network when physically present at the organization
4. **Consent Verification** — verifies that a care relationship and valid consent exist before routing any connection to a provider CareAgent
5. **Relationship Registration** — records new care relationships established through the consent handshake, storing routing information only
6. **Scheduling & Billing Data Layer** — lightweight organizational data store for appointments, billing, CPT/ICD coding, and provider availability
7. **Third-Party REST API** — well-documented local API for practice management tools, billing systems, and scheduling interfaces
8. **Patient Chart Sync Endpoint** — receives Patient Chart updates from patient CareAgents for organizations granted authorized read access
9. **Relationship Termination** — manages state-protocol-compliant provider-initiated care relationship termination

The Neuron is a long-running server process deployed on-premise or in the cloud by any NPI-holding healthcare organization: medical practices, hospitals, pharmacies, imaging centers, laboratories, urgent care facilities, specialty clinics, and any other entity that participates in patient care.

### 1.2 Why Neuron Exists

The CareAgent ecosystem requires an organizational boundary layer. Provider CareAgents cannot be exposed directly to the national network — they need a membrane that manages all inbound and outbound connections on their behalf.

Without Neuron:
- Provider CareAgents are exposed directly to the national Axon network with no organizational boundary
- Patient CareAgents have no organizational endpoint to connect to
- There is no routing layer to direct patient connections to the correct provider
- There is no organizational data layer for scheduling, billing, or operational data
- Third-party applications have no integration surface (they cannot talk to Axon directly, by design)
- There is no local network discovery for physically present patients
- There is no organizational consent verification gateway
- Patient Chart sync has no receiving endpoint at the organization
- Relationship termination has no organizational coordinator

### 1.3 Where Neuron Fits

```
National Axon Registry (@careagent/axon)
        │
        │  Discovery, credential verification, Neuron endpoint directory
        │  Neuron registers organization + providers with Axon
        │
        ▼
Organization Neuron (@careagent/neuron)  ◄──── Third-Party Apps (REST API)
        │                        ▲
        │  Routes connections     │  Patient connects via:
        │  to provider agents     │    1. Axon lookup → Neuron endpoint (remote)
        │                        │    2. mDNS/DNS-SD discovery (local network)
        │                        │
        ├── Provider CareAgent A  │
        │   (@careagent/provider-core)
        │                        │
        ├── Provider CareAgent B  │
        │   (@careagent/provider-core)
        │                        │
        └── Provider CareAgent N  │
                                 │
                    Patient CareAgent
                    (@careagent/patient-core)
                         │
                         └── Patient Chart
                             (@careagent/patient-chart)
```

### 1.4 What Neuron Does Not Do

- **Neuron never holds PHI.** It holds routing information, scheduling data, and billing records — never clinical notes, diagnoses, or treatment plans. Clinical data lives with the patient in their Patient Chart.
- **Neuron does not contain an LLM.** It is infrastructure, not intelligence. The CareAgents behind it are the intelligent entities.
- **Neuron does not write to Patient Charts.** Only credentialed provider CareAgents write to Patient Charts. The Neuron receives sync data — it does not produce clinical content.
- **Neuron is not a HIPAA covered entity.** It does not store, process, or transmit protected health information.
- **Neuron does not perform clinical actions.** It routes, stores operational data, and manages relationships. Clinical decisions are made by CareAgents.
- **Neuron is not an EMR replacement.** It is the minimal operational data layer needed to run a practice — scheduling, billing, routing. Not a clinical data warehouse.
- **Neuron does not expose Axon to third parties.** Third-party applications talk to the Neuron REST API. They never communicate with Axon directly.
- **Neuron does not store patient identities.** Patients are referenced by opaque `relationship_id` and `patient_agent_id`. Patient names and identifiers live with the patient's CareAgent.

### 1.5 Relationship to Existing Repos

| Repository | Status | Relationship to Neuron |
|-----------|--------|----------------------|
| `@careagent/axon` | PRD complete, not yet built | Neuron consumes `AxonRegistry` to register organization endpoint, manage provider credentials, and maintain heartbeat. Neuron implements consent token verification per Axon protocol spec. |
| `@careagent/provider-core` | Fully built (v1 phases 1-5 complete) | Provider CareAgents register with and route through the Neuron. Provider-core defines `NeuronClient` and `ProtocolServer` interfaces that Neuron must satisfy. |
| `@careagent/patient-core` | PRD complete, not yet built | Patient CareAgents connect to the Neuron (via Axon lookup or local discovery) to reach providers. Patient-core presents consent tokens that Neuron verifies. |
| `@careagent/patient-chart` | README only, not yet built | Neuron serves as an authorized sync endpoint for Patient Chart data. Patient Charts sync incrementally to the Neuron for organizations with read access. |

---

## 2. Core Components

### 2.1 National Registration

#### 2.1.1 Purpose

Registers the organization and its providers with the national Axon network, making them discoverable to patient CareAgents. The Neuron is the only entity that communicates with Axon on behalf of the organization — individual provider CareAgents never interact with Axon directly.

#### 2.1.2 Functional Requirements

**Organization Registration**
- Registers the organization with Axon using `AxonRegistry.registerNeuron()` during `neuron init`
- Provides the organization's NPI (10-digit, Luhn-validated), name, type, and Neuron endpoint URL
- Receives a registration confirmation and bearer token for subsequent Axon API calls
- Stores registration state locally for restart resilience

**Provider Management**
- Registers individual providers with Axon using `AxonRegistry.registerProvider()` during `neuron init` or dynamically via CLI
- Each provider is identified by their individual NPI and affiliated with the organization's NPI
- Supports adding, removing, and updating providers without restarting the Neuron
- Updates provider credentials with Axon using `AxonRegistry.updateCredentials()`

**Heartbeat**
- Sends periodic heartbeat to Axon using `AxonRegistry.updateEndpoint()` to maintain `health_status: 'reachable'`
- Configurable heartbeat interval (default: 60 seconds)
- Graceful degradation: if Axon is unreachable, Neuron continues operating for established relationships and logs heartbeat failures

**Endpoint Management**
- Maintains the Neuron endpoint URL in the Axon registry
- Updates endpoint if the Neuron's public URL changes
- Endpoint record includes: URL, protocol version, health status, last heartbeat timestamp

#### 2.1.3 Data Model

```typescript
import { Type, type Static } from '@sinclair/typebox'

const NeuronRegistrationState = Type.Object({
  organization_npi: Type.String(),           // 10-digit NPI
  organization_name: Type.String(),
  organization_type: Type.Union([
    Type.Literal('practice'),
    Type.Literal('hospital'),
    Type.Literal('pharmacy'),
    Type.Literal('imaging_center'),
    Type.Literal('laboratory'),
    Type.Literal('urgent_care'),
    Type.Literal('specialty_clinic'),
    Type.Literal('other')
  ]),
  axon_registry_url: Type.String(),          // Axon registry endpoint
  neuron_endpoint_url: Type.String(),        // This Neuron's public URL
  registration_id: Type.Optional(Type.String()),
  axon_bearer_token: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal('unregistered'),
    Type.Literal('pending'),
    Type.Literal('registered'),
    Type.Literal('suspended')
  ]),
  registered_at: Type.Optional(Type.String()),    // ISO 8601
  last_heartbeat: Type.Optional(Type.String()),   // ISO 8601
  providers: Type.Array(Type.Object({
    provider_npi: Type.String(),
    agent_id: Type.String(),
    endpoint: Type.String(),                      // Local WebSocket endpoint
    registered_with_axon: Type.Boolean(),
    credential_status: Type.Union([
      Type.Literal('active'),
      Type.Literal('pending'),
      Type.Literal('expired'),
      Type.Literal('suspended'),
      Type.Literal('revoked')
    ])
  }))
})

type NeuronRegistrationState = Static<typeof NeuronRegistrationState>
```

#### 2.1.4 Integration Points

- **Axon:** `AxonRegistry.registerNeuron()`, `AxonRegistry.updateEndpoint()`, `AxonRegistry.registerProvider()`, `AxonRegistry.updateCredentials()`, `AxonRegistry.getCredentialStatus()`
- **Provider-core:** Satisfies the `NeuronClient.register()` interface — provider-core calls `register(config: NeuronRegistration)` and expects `{ registrationId, status }`
- **Provider-core:** Satisfies the `NeuronClient.heartbeat()` interface — provider-core calls `heartbeat()` and expects `{ connected, lastSeen? }`

---

### 2.2 Patient CareAgent Routing

#### 2.2.1 Purpose

Routes incoming patient CareAgent connections to the correct provider CareAgent. The Neuron is the organizational router — it knows which patients have relationships with which providers and directs connections accordingly. It does not hold clinical data, only routing information.

#### 2.2.2 Functional Requirements

**WebSocket Server**
- Accepts inbound WebSocket connections from patient CareAgents
- Each connection is authenticated via consent token verification before routing
- Supports concurrent connections from multiple patients to multiple providers
- Session lifecycle: connect → authenticate → verify relationship → route → active session → disconnect

**Routing Algorithm**
1. Patient CareAgent connects to Neuron WebSocket endpoint
2. Neuron receives connection request with patient identity and target provider NPI
3. Neuron verifies consent token (section 2.4)
4. Neuron looks up the relationship record (section 2.5) to confirm an active relationship exists
5. Neuron identifies the target provider CareAgent's local endpoint from the provider registry
6. Neuron establishes a bridged session between patient and provider CareAgents
7. Protocol-level messages flow through the Neuron; Neuron does not inspect clinical content

**Session Management**
- Tracks active sessions with session ID, patient agent ID, provider agent ID, start time, and status
- Supports graceful session termination from either side
- Handles provider CareAgent unavailability (provider offline, endpoint unreachable) with appropriate error responses
- Configurable maximum concurrent sessions per provider (default: 10)

#### 2.2.3 Data Model

```typescript
const RoutingSession = Type.Object({
  session_id: Type.String(),                 // UUID v4
  patient_agent_id: Type.String(),
  provider_agent_id: Type.String(),
  provider_npi: Type.String(),
  relationship_id: Type.String(),            // Reference to RelationshipRecord
  started_at: Type.String(),                 // ISO 8601
  ended_at: Type.Optional(Type.String()),    // ISO 8601
  status: Type.Union([
    Type.Literal('authenticating'),
    Type.Literal('routing'),
    Type.Literal('active'),
    Type.Literal('completed'),
    Type.Literal('terminated'),
    Type.Literal('error')
  ]),
  termination_reason: Type.Optional(Type.String())
})

type RoutingSession = Static<typeof RoutingSession>
```

#### 2.2.4 Integration Points

- **Patient-core:** Patient CareAgent connects via WebSocket to Neuron endpoint (discovered via Axon or local network)
- **Provider-core:** Satisfies `ProtocolServer` interface — `start(port)`, `stop()`, `activeSessions()` matching the `ProtocolSession` model (sessionId, patientAgentId, providerAgentId, status)
- **Axon:** Uses `AxonMessage` format for protocol-level messages between CareAgents

---

### 2.3 Local Network Discovery

#### 2.3.1 Purpose

When a patient is physically present at the organization, their CareAgent can discover and connect to the Neuron over the local network without any national Axon infrastructure involvement. This is the highest trust state: physical presence plus local network plus cryptographic identity verification.

#### 2.3.2 Functional Requirements

**mDNS/DNS-SD Advertisement (v1)**
- Advertises the Neuron on the local network using mDNS/DNS-SD (Bonjour-compatible)
- Service type: `_careagent-neuron._tcp`
- TXT record includes organization NPI, Neuron protocol version, and connection endpoint
- Advertisement starts automatically when the Neuron starts (configurable: `localNetwork.enabled`)
- Advertisement stops gracefully on Neuron shutdown

**Discovery Flow**
1. Patient CareAgent scans for `_careagent-neuron._tcp` services on the local network
2. Neuron responds with its discovery payload
3. Patient CareAgent connects to the local WebSocket endpoint
4. Same consent verification and relationship check as remote connections — no shortcuts
5. Session established over the local network

**BLE/NFC (v2 — Deferred)**
- Bluetooth Low Energy and NFC discovery for proximity-based connections
- Deferred to v2 due to platform-specific implementation complexity

#### 2.3.3 Data Model

```typescript
const DiscoveryPayload = Type.Object({
  organization_npi: Type.String(),
  organization_name: Type.String(),
  neuron_endpoint: Type.String(),            // Local network endpoint (e.g., ws://192.168.1.100:3001)
  protocol_version: Type.String(),
  discovery_method: Type.Union([
    Type.Literal('mdns'),
    Type.Literal('ble'),                     // v2
    Type.Literal('nfc')                      // v2
  ])
})

type DiscoveryPayload = Static<typeof DiscoveryPayload>
```

#### 2.3.4 Integration Points

- **Patient-core:** Patient CareAgent discovers Neuron via mDNS scan and connects locally
- **Same consent flow as remote:** Local discovery does not bypass consent verification — physical presence is additional trust, not a replacement for cryptographic verification

---

### 2.4 Consent Verification

#### 2.4.1 Purpose

Verifies that a care relationship and valid consent exist before routing any connection to a provider CareAgent. No connection is established without a verified consent token.

#### 2.4.2 Functional Requirements

**Ed25519 Token Verification**
- Patient CareAgent presents a consent token signed with the patient's Ed25519 private key
- Neuron verifies the signature using the patient's public key (received during the initial handshake or stored from previous relationship establishment)
- Consent token includes: patient identifier (opaque to Axon), provider NPI, consented actions, expiration timestamp, patient's public key
- Verification is stateless — Neuron re-verifies on every connection, does not cache trust

**Consent Scope**
- Consent tokens specify which actions are consented to (mapped to clinical action taxonomy)
- Neuron does not interpret the scope — it verifies the token is valid and the relationship exists, then passes the scope to the provider CareAgent
- Expired consent tokens are rejected; the patient CareAgent must re-consent

**Verification Flow**
1. Patient CareAgent presents consent token in the connection handshake
2. Neuron extracts the patient's public key and verifies the Ed25519 signature
3. Neuron confirms the consent token is not expired
4. Neuron confirms an active relationship record exists for this patient-provider pair
5. If all checks pass, routing proceeds; otherwise, the connection is denied with a specific error code

#### 2.4.3 Integration Points

- **Patient-core:** Patient-core's consent engine generates the signed consent tokens that Neuron verifies
- **Axon Protocol:** Implements consent verification per Axon protocol specification (section 2.3.5 of Axon PRD)
- **Provider-core:** Passes verified consent scope to the provider CareAgent for session-level enforcement

---

### 2.5 Relationship Registration

#### 2.5.1 Purpose

Records new care relationships when established through the consent handshake. The Neuron stores routing information only — the relationship record maps a patient agent to a provider agent with the consent scope and status. The Neuron never stores clinical data.

#### 2.5.2 Functional Requirements

**Consent Handshake (Neuron's Perspective)**
Mirrors the Axon handshake sequence (Axon PRD section 2.3.2) from the Neuron's side:
1. Patient CareAgent connects to Neuron (via Axon lookup or local discovery)
2. Neuron presents provider credentials and relationship terms
3. Patient consents through their CareAgent (consent token signed and returned)
4. Neuron verifies the consent token
5. Neuron creates a `RelationshipRecord` in the routing store
6. Relationship record is written to the patient's Patient Chart by the patient's CareAgent (not the Neuron)
7. Direct peer-to-peer clinical session established through the Neuron

**Routing Store Persistence**
- Relationship records are persisted to disk (file-backed JSON in v1, or SQLite)
- Store survives Neuron restarts — established relationships are available immediately on restart
- Supports querying by patient agent ID, provider NPI, or relationship ID

#### 2.5.3 Data Model

```typescript
const RelationshipRecord = Type.Object({
  relationship_id: Type.String(),            // UUID v4
  patient_agent_id: Type.String(),           // Opaque identifier from patient CareAgent
  patient_public_key: Type.String(),         // Ed25519 public key (hex or base64)
  provider_npi: Type.String(),
  provider_agent_id: Type.String(),
  consented_actions: Type.Array(Type.String()), // Taxonomy action IDs
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('suspended'),
    Type.Literal('terminated')
  ]),
  established_at: Type.String(),             // ISO 8601
  last_connection: Type.Optional(Type.String()), // ISO 8601
  terminated_at: Type.Optional(Type.String()),   // ISO 8601
  termination_reason: Type.Optional(Type.String())
})

type RelationshipRecord = Static<typeof RelationshipRecord>
```

#### 2.5.4 Integration Points

- **Axon Protocol:** Follows the handshake sequence defined in Axon protocol specification
- **Patient-core:** Receives consent tokens from patient CareAgent; patient-core writes the relationship to the Patient Chart
- **Patient-chart:** The relationship exists in both the Neuron's routing store (for routing) and the patient's Patient Chart (for the patient's record)

---

### 2.6 Scheduling & Billing Data Layer

#### 2.6.1 Purpose

The lightweight organizational data store for scheduling and billing. This is the minimal "EMR" data layer — not a clinical data warehouse, but the operational data an organization needs to run a practice. Clinical data lives with the patient. The Neuron holds only what the organization needs to operate.

#### 2.6.2 Functional Requirements

**Appointment Scheduling**
- Create, read, update, and cancel appointments
- Appointments reference a relationship ID (not patient name or identity) and a provider NPI
- Supports appointment types: in-person, telehealth, follow-up, procedure
- Time-based queries: appointments by date range, by provider, by status

**Provider Availability**
- Define provider availability windows (recurring and one-time)
- Query available slots by provider and date range
- Block time for administrative, personal, or procedure scheduling

**Billing Records**
- Create billing records associated with appointments
- CPT code entry with modifiers
- ICD-10 diagnostic codes for billing justification (operational billing data, not clinical diagnosis)
- Billing status tracking: draft, submitted, accepted, denied, appealed
- Billing records reference relationship_id only — never patient names in v1

**Key Design Constraint: No Patient Identity**
- All scheduling and billing records reference `relationship_id` — the opaque identifier linking a patient-provider pair
- Patient names, dates of birth, and other identifying information are never stored in the Neuron's scheduling or billing layer in v1
- This is a deliberate architectural choice: the Neuron holds operational data, not identity data

#### 2.6.3 Data Model

```typescript
const Appointment = Type.Object({
  appointment_id: Type.String(),             // UUID v4
  relationship_id: Type.String(),            // Reference to RelationshipRecord
  provider_npi: Type.String(),
  appointment_type: Type.Union([
    Type.Literal('in_person'),
    Type.Literal('telehealth'),
    Type.Literal('follow_up'),
    Type.Literal('procedure')
  ]),
  scheduled_start: Type.String(),            // ISO 8601
  scheduled_end: Type.String(),              // ISO 8601
  status: Type.Union([
    Type.Literal('scheduled'),
    Type.Literal('confirmed'),
    Type.Literal('checked_in'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
    Type.Literal('no_show')
  ]),
  notes: Type.Optional(Type.String()),       // Operational notes only, never clinical
  created_at: Type.String(),                 // ISO 8601
  updated_at: Type.String()                  // ISO 8601
})

type Appointment = Static<typeof Appointment>

const ProviderAvailability = Type.Object({
  availability_id: Type.String(),            // UUID v4
  provider_npi: Type.String(),
  day_of_week: Type.Optional(Type.Union([
    Type.Literal('monday'),
    Type.Literal('tuesday'),
    Type.Literal('wednesday'),
    Type.Literal('thursday'),
    Type.Literal('friday'),
    Type.Literal('saturday'),
    Type.Literal('sunday')
  ])),
  specific_date: Type.Optional(Type.String()), // ISO 8601 date for one-time overrides
  start_time: Type.String(),                 // HH:mm (24-hour)
  end_time: Type.String(),                   // HH:mm (24-hour)
  slot_duration_minutes: Type.Number(),      // Default: 30
  availability_type: Type.Union([
    Type.Literal('recurring'),
    Type.Literal('one_time'),
    Type.Literal('block')                    // Blocked time (unavailable)
  ])
})

type ProviderAvailability = Static<typeof ProviderAvailability>

const CPTEntry = Type.Object({
  cpt_code: Type.String(),
  description: Type.String(),
  modifiers: Type.Optional(Type.Array(Type.String())),
  units: Type.Optional(Type.Number())
})

type CPTEntry = Static<typeof CPTEntry>

const BillingRecord = Type.Object({
  billing_id: Type.String(),                 // UUID v4
  appointment_id: Type.String(),             // Reference to Appointment
  relationship_id: Type.String(),            // Reference to RelationshipRecord
  provider_npi: Type.String(),
  cpt_entries: Type.Array(CPTEntry),
  icd_codes: Type.Array(Type.String()),      // ICD-10 codes for billing justification
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('submitted'),
    Type.Literal('accepted'),
    Type.Literal('denied'),
    Type.Literal('appealed')
  ]),
  total_charge: Type.Optional(Type.Number()), // In cents
  created_at: Type.String(),                 // ISO 8601
  updated_at: Type.String()                  // ISO 8601
})

type BillingRecord = Static<typeof BillingRecord>
```

#### 2.6.4 Integration Points

- **Third-Party REST API (section 2.7):** Scheduling and billing data is the primary integration surface for practice management tools
- **Provider-core:** Provider CareAgents may trigger appointment status updates (e.g., check-in, completion) through the Neuron

---

### 2.7 Third-Party REST API

#### 2.7.1 Purpose

The Neuron is the integration surface for the entire third-party developer ecosystem. Third-party applications never communicate directly with Axon or with individual CareAgents — they communicate with the Neuron. This is by design. Axon is a closed protocol layer. The Neuron is the intentional, hardened boundary between the CareAgent network and everything outside it.

#### 2.7.2 Functional Requirements

**HTTP Server**
- Built on Node.js built-in `http` module (no Express, no Fastify)
- JSON request/response format
- Configurable port (default: 3000)
- Configurable allowed CORS origins

**Authentication**
- API key authentication for all endpoints
- API keys are generated and managed via CLI (`neuron api-key create`, `neuron api-key revoke`, `neuron api-key list`)
- Keys are stored locally in the Neuron's configuration directory
- Each key has a label, creation timestamp, and optional expiration

**Rate Limiting**
- Configurable rate limits per API key (default: 100 requests/minute)
- Returns `429 Too Many Requests` with `Retry-After` header when exceeded

**OpenAPI Specification**
- Full OpenAPI 3.1 spec generated from route definitions
- Served at `GET /openapi.json`

#### 2.7.3 Route Specification

**Organization**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/organization` | Get organization details (name, NPI, type, registration status) |
| `GET` | `/api/v1/organization/providers` | List all registered providers |
| `GET` | `/api/v1/organization/providers/:npi` | Get provider details by NPI |

**Scheduling**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/appointments` | List appointments (query by date range, provider, status) |
| `POST` | `/api/v1/appointments` | Create a new appointment |
| `GET` | `/api/v1/appointments/:id` | Get appointment by ID |
| `PATCH` | `/api/v1/appointments/:id` | Update appointment (status, time, notes) |
| `DELETE` | `/api/v1/appointments/:id` | Cancel appointment |
| `GET` | `/api/v1/availability/:npi` | Get provider availability (query by date range) |
| `POST` | `/api/v1/availability/:npi` | Set provider availability window |
| `DELETE` | `/api/v1/availability/:id` | Remove availability window |

**Billing**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/billing` | List billing records (query by date range, provider, status) |
| `POST` | `/api/v1/billing` | Create a billing record |
| `GET` | `/api/v1/billing/:id` | Get billing record by ID |
| `PATCH` | `/api/v1/billing/:id` | Update billing record (status, codes) |

**Relationships (Read-Only)**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/relationships` | List active relationships (query by provider) |
| `GET` | `/api/v1/relationships/:id` | Get relationship details (routing info only, no clinical data) |

**Status**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/status` | Neuron health status (Axon connectivity, active sessions, uptime) |
| `GET` | `/openapi.json` | OpenAPI 3.1 specification |

#### 2.7.4 Integration Points

- **Third-party applications:** Practice management tools, billing systems, scheduling interfaces connect through this API
- **Neuron SDK (`@careagent/neuron-sdk`):** TypeScript client library wrapping this API (separate package, mentioned for completeness — SDK packaging is an open question)

---

### 2.8 Patient Chart Sync Endpoint

#### 2.8.1 Purpose

Receives Patient Chart updates from patient CareAgents for organizations that have been granted authorized read access by patients. The Neuron acts as a sync endpoint — it receives and caches chart data, it does not produce or modify it.

#### 2.8.2 Functional Requirements

**Sync Receiver**
- Accepts incremental Patient Chart updates from patient CareAgents over the established WebSocket session
- Each update is a delta (new entries since last sync), not a full chart dump
- Updates are stored as cached chart entries in the Neuron's local store

**Authorization Check**
- Before accepting chart data, verifies that the active relationship grants chart read access
- Read access is part of the consented actions in the `RelationshipRecord`
- If consent is revoked, cached chart data for that relationship is purged

**Incremental Sync**
- Tracks last sync timestamp per relationship
- Patient CareAgent sends only entries newer than the last sync point
- Supports full re-sync if the Neuron's cache is invalidated (e.g., after data loss)

**Access Revocation**
- When a patient revokes chart read access, the Neuron:
  1. Purges all cached chart entries for that relationship
  2. Stops accepting new sync data for that relationship
  3. Logs the revocation event to the audit log

#### 2.8.3 Data Model

```typescript
const CachedChartEntry = Type.Object({
  entry_id: Type.String(),                   // UUID v4 from patient-chart
  relationship_id: Type.String(),            // Reference to RelationshipRecord
  entry_type: Type.String(),                 // Chart entry type (e.g., "progress_note", "lab_result")
  synced_at: Type.String(),                  // ISO 8601 — when Neuron received this entry
  original_timestamp: Type.String(),         // ISO 8601 — when the entry was created in the Patient Chart
  content_hash: Type.String(),               // SHA-256 hash for integrity verification
  content: Type.Unknown()                    // The chart entry content (opaque to Neuron — stored, not interpreted)
})

type CachedChartEntry = Static<typeof CachedChartEntry>

const SyncState = Type.Object({
  relationship_id: Type.String(),
  last_sync_timestamp: Type.String(),        // ISO 8601
  entry_count: Type.Number(),
  sync_status: Type.Union([
    Type.Literal('active'),
    Type.Literal('paused'),
    Type.Literal('revoked')
  ])
})

type SyncState = Static<typeof SyncState>
```

#### 2.8.4 Integration Points

- **Patient-core / Patient-chart:** Patient CareAgent pushes chart updates to the Neuron sync endpoint
- **Provider-core:** Provider CareAgents can read cached chart data through the Neuron during active sessions
- **Third-Party REST API:** Cached chart data is NOT exposed through the REST API — only CareAgents with verified relationships can access it

---

### 2.9 Relationship Termination

#### 2.9.1 Purpose

Manages state-protocol-compliant provider-initiated care relationship termination. When a provider terminates a care relationship following the applicable state protocol, the Neuron coordinates the process, stops routing, and maintains the audit record.

#### 2.9.2 Functional Requirements

**Termination Flow**
1. Provider CareAgent initiates termination through the Neuron
2. Neuron validates that the termination follows state protocol requirements (notification period, referral obligation)
3. Neuron updates the `RelationshipRecord` status to `terminated`
4. Neuron stops routing that patient's CareAgent connections to the provider
5. Neuron logs the termination event to the audit log
6. The termination event is written to the patient's Patient Chart by the provider's credentialed CareAgent — the Neuron does not write to the Patient Chart

**Termination is Permanent**
- Once a relationship is terminated, it cannot be reactivated
- A new relationship requires a full consent handshake from scratch
- The terminated relationship record is retained for audit purposes

**State Protocol Compliance**
- Termination records include references to applicable state protocol requirements
- v1: state protocol data is provider-attested; external validation is v2

#### 2.9.3 Data Model

```typescript
const TerminationRecord = Type.Object({
  termination_id: Type.String(),             // UUID v4
  relationship_id: Type.String(),            // Reference to RelationshipRecord
  initiated_by: Type.Union([
    Type.Literal('provider'),
    Type.Literal('patient'),
    Type.Literal('system')                   // e.g., consent expiration
  ]),
  reason: Type.String(),
  state_protocol_reference: Type.Optional(Type.String()), // Applicable state regulation
  notification_date: Type.Optional(Type.String()),        // ISO 8601 — when patient was notified
  effective_date: Type.String(),             // ISO 8601 — when termination takes effect
  created_at: Type.String(),                 // ISO 8601
  audit_hash: Type.String()                  // Hash linking to audit log entry
})

type TerminationRecord = Static<typeof TerminationRecord>
```

#### 2.9.4 Integration Points

- **Provider-core:** Provider CareAgent initiates termination; writes the termination event to the Patient Chart
- **Patient-core:** Patient CareAgent is notified of the termination; the patient's CareAgent records it in the Patient Chart
- **Audit log:** Termination events are logged with full audit trail

---

## 3. Repository Structure

```
careagent/neuron/
├── src/
│   ├── index.ts                    # Neuron server entry point
│   ├── server.ts                   # HTTP + WebSocket server lifecycle
│   ├── config/
│   │   ├── index.ts                # Configuration loader and validator
│   │   ├── schema.ts               # TypeBox schema for neuron.config.json
│   │   └── env.ts                  # Environment variable overrides (NEURON_ prefix)
│   ├── registration/
│   │   ├── index.ts                # Registration module entry point
│   │   ├── axon-client.ts          # AxonRegistry client wrapper
│   │   ├── heartbeat.ts            # Periodic heartbeat to Axon
│   │   ├── provider-manager.ts     # Provider add/remove/update operations
│   │   └── state.ts                # NeuronRegistrationState persistence
│   ├── routing/
│   │   ├── index.ts                # Routing module entry point
│   │   ├── websocket.ts            # WebSocket server for patient connections
│   │   ├── session-manager.ts      # Active session tracking and lifecycle
│   │   └── bridge.ts               # Patient-to-provider session bridge
│   ├── discovery/
│   │   ├── index.ts                # Discovery module entry point
│   │   └── mdns.ts                 # mDNS/DNS-SD advertisement and response
│   ├── consent/
│   │   ├── index.ts                # Consent module entry point
│   │   ├── token-verifier.ts       # Ed25519 consent token verification
│   │   └── challenge.ts            # Challenge-response generation
│   ├── relationships/
│   │   ├── index.ts                # Relationships module entry point
│   │   ├── store.ts                # RelationshipRecord persistence (file-backed or SQLite)
│   │   ├── handshake.ts            # Consent handshake handler (Neuron side)
│   │   └── query.ts                # Relationship queries (by patient, provider, ID)
│   ├── scheduling/
│   │   ├── index.ts                # Scheduling module entry point
│   │   ├── appointments.ts         # Appointment CRUD operations
│   │   ├── availability.ts         # Provider availability management
│   │   └── store.ts                # Scheduling data persistence
│   ├── billing/
│   │   ├── index.ts                # Billing module entry point
│   │   ├── records.ts              # BillingRecord CRUD operations
│   │   └── store.ts                # Billing data persistence
│   ├── api/
│   │   ├── index.ts                # REST API entry point
│   │   ├── router.ts               # Route dispatcher
│   │   ├── middleware/
│   │   │   ├── auth.ts             # API key authentication
│   │   │   ├── rate-limit.ts       # Rate limiting
│   │   │   ├── cors.ts             # CORS handling
│   │   │   └── error-handler.ts    # Error response formatting
│   │   ├── routes/
│   │   │   ├── organization.ts     # /api/v1/organization routes
│   │   │   ├── appointments.ts     # /api/v1/appointments routes
│   │   │   ├── availability.ts     # /api/v1/availability routes
│   │   │   ├── billing.ts          # /api/v1/billing routes
│   │   │   ├── relationships.ts    # /api/v1/relationships routes (read-only)
│   │   │   └── status.ts           # /api/v1/status route
│   │   ├── openapi.ts              # OpenAPI 3.1 spec generator
│   │   └── api-keys.ts             # API key generation and management
│   ├── sync/
│   │   ├── index.ts                # Sync module entry point
│   │   ├── receiver.ts             # Incoming chart sync handler
│   │   ├── store.ts                # CachedChartEntry persistence
│   │   └── revocation.ts           # Access revocation and cache purge
│   ├── termination/
│   │   ├── index.ts                # Termination module entry point
│   │   ├── handler.ts              # Termination flow coordinator
│   │   └── store.ts                # TerminationRecord persistence
│   ├── audit/
│   │   ├── index.ts                # Audit logger entry point
│   │   └── logger.ts               # Hash-chained JSONL audit log
│   ├── cli/
│   │   ├── index.ts                # CLI entry point
│   │   ├── init.ts                 # neuron init command
│   │   ├── start.ts                # neuron start command
│   │   ├── stop.ts                 # neuron stop command
│   │   ├── status.ts               # neuron status command
│   │   ├── provider.ts             # neuron provider add/remove/list commands
│   │   └── api-key.ts              # neuron api-key create/revoke/list commands
│   └── types/
│       ├── index.ts                # Public type exports
│       ├── registration.ts         # Registration types
│       ├── routing.ts              # Routing and session types
│       ├── relationships.ts        # Relationship types
│       ├── scheduling.ts           # Scheduling types
│       ├── billing.ts              # Billing types
│       ├── sync.ts                 # Chart sync types
│       ├── termination.ts          # Termination types
│       ├── api.ts                  # REST API types
│       ├── discovery.ts            # Discovery types
│       └── audit.ts                # Audit log types
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── api.md                      # Full third-party REST API reference
│   ├── architecture.md             # Neuron architecture guide
│   └── configuration.md            # Full configuration reference
├── neuron.config.json              # Default configuration template
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

---

## 4. Configuration

### 4.1 Configuration Schema

The Neuron is configured through `neuron.config.json` in the project root. Configuration is validated at startup using TypeBox schemas. Invalid configuration prevents the Neuron from starting.

```typescript
const NeuronConfig = Type.Object({
  organization: Type.Object({
    name: Type.String(),
    npi: Type.String(),                      // 10-digit NPI, Luhn-validated
    type: Type.Union([
      Type.Literal('practice'),
      Type.Literal('hospital'),
      Type.Literal('pharmacy'),
      Type.Literal('imaging_center'),
      Type.Literal('laboratory'),
      Type.Literal('urgent_care'),
      Type.Literal('specialty_clinic'),
      Type.Literal('other')
    ])
  }),
  axon: Type.Object({
    registry: Type.String(),                 // Axon registry URL
    endpoint: Type.String(),                 // This Neuron's public URL
    heartbeat_interval_ms: Type.Optional(Type.Number({ default: 60000 })),
    bearer_token: Type.Optional(Type.String()) // Set during registration
  }),
  localNetwork: Type.Object({
    enabled: Type.Boolean({ default: true }),
    discovery: Type.Array(Type.Union([
      Type.Literal('mdns')                   // v1: mdns only
    ]), { default: ['mdns'] }),
    port: Type.Optional(Type.Number({ default: 3001 }))
  }),
  providers: Type.Array(Type.Object({
    agentId: Type.String(),
    npi: Type.String(),
    endpoint: Type.String()                  // Local WebSocket endpoint for provider CareAgent
  })),
  api: Type.Object({
    port: Type.Optional(Type.Number({ default: 3000 })),
    allowedOrigins: Type.Optional(Type.Array(Type.String(), { default: [] })),
    rateLimitPerMinute: Type.Optional(Type.Number({ default: 100 }))
  }),
  websocket: Type.Object({
    port: Type.Optional(Type.Number({ default: 3002 })),
    maxConcurrentSessionsPerProvider: Type.Optional(Type.Number({ default: 10 }))
  }),
  storage: Type.Object({
    type: Type.Optional(Type.Union([
      Type.Literal('json'),
      Type.Literal('sqlite')
    ], { default: 'json' })),
    path: Type.Optional(Type.String({ default: './data' }))
  }),
  audit: Type.Object({
    enabled: Type.Optional(Type.Boolean({ default: true })),
    path: Type.Optional(Type.String({ default: './data/audit.jsonl' }))
  })
})

type NeuronConfig = Static<typeof NeuronConfig>
```

### 4.2 Environment Variable Overrides

All configuration values can be overridden via environment variables with the `NEURON_` prefix using double-underscore path separators:

| Environment Variable | Config Path | Example |
|---------------------|-------------|---------|
| `NEURON_ORGANIZATION__NPI` | `organization.npi` | `1234567890` |
| `NEURON_ORGANIZATION__NAME` | `organization.name` | `Example Medical Practice` |
| `NEURON_AXON__REGISTRY` | `axon.registry` | `https://registry.axon.careagent.org` |
| `NEURON_AXON__ENDPOINT` | `axon.endpoint` | `https://neuron.example.com` |
| `NEURON_API__PORT` | `api.port` | `3000` |
| `NEURON_WEBSOCKET__PORT` | `websocket.port` | `3002` |
| `NEURON_STORAGE__TYPE` | `storage.type` | `json` or `sqlite` |
| `NEURON_AUDIT__ENABLED` | `audit.enabled` | `true` |

### 4.3 Validation at Startup

1. Load `neuron.config.json` from the project root (or path specified by `NEURON_CONFIG_PATH`)
2. Apply environment variable overrides
3. Validate the merged configuration against the `NeuronConfig` TypeBox schema
4. Validate organization NPI (10-digit format, Luhn check)
5. Validate all provider NPIs
6. If validation fails, log the specific errors and exit with non-zero status

---

## 5. Security and Privacy

### 5.1 No PHI

The Neuron does not store, process, or transmit protected health information.

**What the Neuron holds:**
- Organization registration data (NPI, name, type, endpoint — all public directory information)
- Provider registration data (NPI, specialty, credential status — public professional information)
- Relationship records (opaque patient agent ID, provider NPI, consented actions, status — routing data)
- Scheduling data (appointment times, types, status — operational data, referenced by relationship_id)
- Billing data (CPT codes, ICD-10 codes, charges — operational billing data, referenced by relationship_id)
- Cached chart entries (synced from patient CareAgents — stored but not interpreted by Neuron)
- Audit logs (events, timestamps, hashes — operational logs)

**What the Neuron does NOT hold:**
- Patient names, dates of birth, addresses, or any demographic information
- Clinical notes, diagnoses, treatment plans, or medical records
- Patient identifiers beyond the opaque `patient_agent_id`
- Social Security numbers, insurance member IDs, or financial account information

**Scheduling and billing ICD/CPT codes:** These codes are operational billing data. In v1, all scheduling and billing records reference `relationship_id` only — never patient names or demographic data. This means a billing record with ICD-10 codes cannot be linked to a patient identity from the Neuron's data alone.

### 5.2 Transport Security

- **Inbound connections (patient CareAgents):** TLS-encrypted WebSocket (WSS) for remote connections. Local network connections use unencrypted WS over the trusted local network boundary.
- **Outbound connections (to Axon):** HTTPS to the Axon registry for all API calls
- **Local provider connections:** WebSocket over localhost — the trust boundary is the machine itself
- **REST API:** HTTPS recommended for production; HTTP acceptable for local development

### 5.3 Authentication Model

| Connection Type | Authentication Method | Version |
|----------------|----------------------|---------|
| Neuron → Axon | Bearer token (received during registration) | v1 |
| Patient CareAgent → Neuron | Ed25519 challenge-response (consent token) | v1 |
| Provider CareAgent → Neuron | Shared secret (configured in `neuron.config.json`) | v1 |
| Third-party app → Neuron REST API | API key (generated via CLI) | v1 |
| Neuron → Axon | Mutual TLS | v2 |
| Third-party app → Neuron REST API | OAuth 2.0 | v2 |

### 5.4 Audit Logging

The Neuron maintains a hash-chained JSONL operational audit log. Each entry is appended to the log file with a SHA-256 hash of the previous entry, creating a tamper-evident chain.

**Audited Events:**
- Registration events (organization registered, provider added/removed, credential updated)
- Connection events (patient connected, session established, session terminated)
- Consent events (consent verified, consent expired, consent revoked)
- API access events (API key created, API key revoked, API request — method, path, key label)
- Sync events (chart sync received, sync state updated, access revoked, cache purged)
- Admin events (Neuron started, Neuron stopped, configuration changed, provider added/removed)
- Termination events (relationship terminated, notification sent, effective date reached)

**Audit Entry Format:**

```typescript
const AuditEntry = Type.Object({
  entry_id: Type.String(),                   // UUID v4
  timestamp: Type.String(),                  // ISO 8601
  event_type: Type.String(),                 // e.g., "registration.provider_added"
  actor: Type.String(),                      // Who triggered the event (agent ID, API key label, "system")
  details: Type.Record(Type.String(), Type.Unknown()), // Event-specific details
  previous_hash: Type.String(),              // SHA-256 hash of previous entry (empty string for first entry)
  entry_hash: Type.String()                  // SHA-256 hash of this entry (computed over all fields except entry_hash)
})

type AuditEntry = Static<typeof AuditEntry>
```

### 5.5 Data Encryption at Rest

Deferred to v2. In v1, data is stored in plaintext on the local filesystem. The Neuron is expected to run on infrastructure controlled by the organization. Filesystem-level encryption (e.g., LUKS, FileVault, BitLocker) is recommended but not enforced by the Neuron.

---

## 6. Technical Stack and Constraints

### 6.1 Stack

- **Runtime:** Node.js >=22.12.0
- **Language:** TypeScript ~5.7.x
- **Package manager:** pnpm
- **Build:** tsdown ~0.20.x
- **Test:** vitest ~4.0.x (80% coverage thresholds)
- **Schema validation:** @sinclair/typebox ~0.34.x
- **HTTP server:** Node.js built-in `http` module (no Express, no Fastify)
- **WebSocket:** `ws` package or Node.js built-in `WebSocket` (see Open Questions)
- **Crypto:** Node.js built-in `crypto` module (Ed25519 for signatures, SHA-256 for hashes)
- **Storage:** File-backed JSON (v1) or SQLite (see Open Questions)
- **License:** Apache 2.0

### 6.2 Key Distinction from Provider-Core and Patient-Core

**Neuron is a standalone server, not a plugin.** Provider-core and patient-core are zero-runtime-dependency packages designed to be embedded in host applications. The Neuron is a standalone process that organizations run independently. This means:

- **Minimal runtime dependencies are acceptable** (not zero-dep). The `ws` package, an mDNS library, or SQLite binding are reasonable for a standalone server.
- **The Neuron owns its own process lifecycle** — it is not embedded in another application
- **The Neuron can use Node.js server APIs** that would be inappropriate for an embeddable plugin

### 6.3 Constraints

- **Synthetic data only** — no real patient data or PHI is used in development or testing
- **No PHI** — never, by design, at any layer
- **Single-process deployment (v1)** — clustering and multi-process scaling are v2 concerns
- **v1 is a functional demo** — production hardening (HA, backups, monitoring) is v2

---

## 7. Phased Milestones

### Phase 1: Project Foundation & Configuration

**Goal:** A buildable, testable TypeScript project scaffold with configuration management, CLI stubs, and the audit logging foundation.

**Depends on:** Nothing (foundation phase)

**Deliverables:**
1. pnpm TypeScript project scaffold (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`)
2. TypeBox schema for `NeuronConfig` with full validation
3. Configuration loader: read `neuron.config.json`, apply `NEURON_` environment variable overrides, validate against schema
4. NPI validation utility (10-digit format, Luhn check)
5. CLI entry point with stub commands: `neuron init`, `neuron start`, `neuron stop`, `neuron status`
6. Hash-chained JSONL audit logger with tamper-evident chain
7. Storage abstraction interface (file-backed JSON implementation)
8. All TypeBox schemas for core data models exported from `src/types/`

**Success Criteria:**
- `pnpm build` produces working artifacts
- `neuron --help` lists available commands
- Configuration is validated at startup; invalid config prevents startup with clear error messages
- NPI validation correctly accepts valid NPIs and rejects invalid ones (format + Luhn)
- Audit logger writes hash-chained JSONL entries; chain integrity is verifiable
- All tests pass at 80%+ coverage

**Requirements:** NREG-01, CONF-01 through CONF-04, AUDT-01 through AUDT-03

---

### Phase 2: National Registration & Axon Integration

**Goal:** The Neuron can register with the Axon network, maintain a heartbeat, and manage providers dynamically.

**Depends on:** Phase 1

**Deliverables:**
1. `AxonRegistry` client wrapper for Neuron-specific operations (`registerNeuron`, `updateEndpoint`, `registerProvider`, `updateCredentials`)
2. `neuron init` implementation: interactive registration flow, stores `NeuronRegistrationState`
3. Heartbeat module: periodic `updateEndpoint` calls to maintain `health_status: 'reachable'`
4. Provider management: `neuron provider add`, `neuron provider remove`, `neuron provider list`
5. Registration state persistence: survives Neuron restart
6. Graceful degradation: Neuron continues operating if Axon is unreachable (for established relationships)
7. Mock Axon registry for development and testing

**Success Criteria:**
- `neuron init` completes registration with a (mock) Axon registry and persists state
- Heartbeat maintains `reachable` status; missed heartbeats are logged
- Providers can be added and removed dynamically without restarting the Neuron
- Registration state survives Neuron restart
- Neuron starts and operates with established relationships even when Axon is unreachable

**Requirements:** NREG-01 through NREG-06

---

### Phase 3: Relationship Store & Consent Verification

**Goal:** The Neuron can store relationship records, verify consent tokens, handle the consent handshake, and process relationship terminations.

**Depends on:** Phase 2

**Deliverables:**
1. `RelationshipRecord` store with file-backed persistence
2. Relationship queries: by patient agent ID, provider NPI, relationship ID, status
3. Ed25519 consent token verifier using Node.js built-in `crypto`
4. Challenge-response generation for identity verification
5. Consent handshake handler (Neuron side of the Axon protocol handshake)
6. Relationship termination handler with `TerminationRecord` persistence
7. Terminated relationships are permanent — no reactivation
8. All relationship and termination events logged to audit trail

**Success Criteria:**
- A relationship can be established through the consent handshake flow
- Consent tokens with valid Ed25519 signatures are accepted; invalid/expired tokens are rejected
- Relationship records persist across Neuron restarts
- Queries by patient, provider, and relationship ID return correct results
- Terminated relationships block further routing; termination is irreversible
- All events appear in the audit log

**Requirements:** CSNT-01 through CSNT-04, RELN-01 through RELN-04, TERM-01 through TERM-04

---

### Phase 4: Connection Routing & WebSocket Server

**Goal:** The Neuron accepts inbound patient CareAgent connections, verifies consent, routes to the correct provider CareAgent, and manages active sessions.

**Depends on:** Phase 3

**Deliverables:**
1. WebSocket server accepting inbound patient CareAgent connections
2. Connection authentication flow: receive connection → verify consent token → check relationship → route
3. Session bridge: bidirectional message forwarding between patient and provider WebSocket connections
4. Session manager: tracking active sessions, enforcing per-provider concurrency limits
5. Graceful session termination from either side
6. Provider unavailability handling (offline provider → error response to patient)
7. Implements `ProtocolServer` interface from provider-core (`start(port)`, `stop()`, `activeSessions()`)
8. Uses `AxonMessage` format for protocol-level messages

**Success Criteria:**
- A patient CareAgent can connect to the Neuron WebSocket endpoint and establish a session with a provider CareAgent
- Connections without valid consent tokens are rejected
- Connections to providers without an active relationship are rejected
- Multiple concurrent sessions are supported (different patients to different providers)
- Per-provider session limits are enforced
- Sessions are tracked and queryable via `activeSessions()`
- Protocol-level messages flow correctly between patient and provider

**Requirements:** ROUT-01 through ROUT-06

---

### Phase 5: Local Network Discovery

**Goal:** Patient CareAgents can discover the Neuron on the local network via mDNS/DNS-SD when physically present at the organization.

**Depends on:** Phase 4

**Deliverables:**
1. mDNS/DNS-SD advertisement: service type `_careagent-neuron._tcp` with TXT record (organization NPI, protocol version, endpoint)
2. Discovery auto-start on Neuron startup (if `localNetwork.enabled`)
3. Discovery auto-stop on Neuron shutdown
4. Local WebSocket endpoint for discovered connections
5. Same consent verification flow as remote connections — no security shortcuts for local
6. Configuration: `localNetwork.enabled`, `localNetwork.port`

**Success Criteria:**
- A patient CareAgent on the same local network can discover the Neuron via mDNS
- Discovery payload contains correct organization NPI, endpoint, and protocol version
- Local connections go through the same consent verification as remote connections
- Discovery starts and stops cleanly with the Neuron lifecycle
- Disabling `localNetwork.enabled` prevents advertisement

**Requirements:** DISC-01 through DISC-04

---

### Phase 6: Scheduling & Billing Data Layer

**Goal:** The Neuron provides appointment scheduling, provider availability management, and billing record operations as a lightweight organizational data store.

**Depends on:** Phase 3 (references relationship_id from RelationshipRecord)

**Deliverables:**
1. Appointment CRUD: create, read, update status, cancel, query by date/provider/status
2. Provider availability: define recurring and one-time windows, query available slots, block time
3. Billing records: create, read, update status/codes, query by date/provider/status
4. CPT code entry with modifiers and units
5. ICD-10 code entry for billing justification
6. All records reference `relationship_id` only — no patient identity data
7. Persistent storage (file-backed JSON or SQLite)
8. Query engine for time-based and status-based filtering

**Success Criteria:**
- Appointments can be created, queried by date range and provider, and status-updated through the full lifecycle
- Provider availability can be defined and queried for open slots
- Billing records with CPT/ICD codes can be created and tracked through submission status
- All records use `relationship_id` — no patient names or identity data exist in the store
- Data persists across Neuron restarts

**Requirements:** SCHED-01 through SCHED-04, BILL-01 through BILL-04

---

### Phase 7: Third-Party REST API

**Goal:** A fully functional REST API with authentication, rate limiting, CORS, and all routes serving organization, scheduling, billing, relationship, and status data.

**Depends on:** Phase 6

**Deliverables:**
1. HTTP server on Node.js built-in `http` module
2. Route dispatcher mapping method + path to handlers
3. Middleware pipeline: CORS → authentication → rate limiting → handler → error formatting
4. API key management: `neuron api-key create`, `neuron api-key revoke`, `neuron api-key list`
5. All routes from section 2.7.3 implemented (organization, scheduling, billing, relationships, status)
6. Rate limiting per API key with configurable limits and `429` responses
7. OpenAPI 3.1 specification generated from route definitions, served at `GET /openapi.json`
8. Request/response validation against TypeBox schemas

**Success Criteria:**
- All routes return correct data for valid requests with valid API keys
- Requests without API keys receive `401 Unauthorized`
- Requests exceeding rate limits receive `429 Too Many Requests` with `Retry-After`
- CORS headers are correctly set for configured origins
- `GET /openapi.json` returns a valid OpenAPI 3.1 specification
- Invalid request bodies receive `400 Bad Request` with validation error details

**Requirements:** TAPI-01 through TAPI-07

---

### Phase 8: Patient Chart Sync Endpoint

**Goal:** The Neuron can receive Patient Chart updates from patient CareAgents, store them incrementally, verify authorization, and handle access revocation.

**Depends on:** Phase 4 (uses WebSocket sessions), Phase 3 (checks relationship consent scope)

**Deliverables:**
1. Sync receiver: accepts incremental chart updates over established WebSocket sessions
2. Authorization check: verifies relationship grants chart read access before accepting data
3. `CachedChartEntry` store with persistence
4. `SyncState` tracking: last sync timestamp per relationship, entry counts
5. Incremental sync: only new entries since last sync point
6. Full re-sync support for cache invalidation scenarios
7. Access revocation: purge cached entries, stop accepting sync data, log to audit trail
8. Content integrity: SHA-256 hash verification on received entries

**Success Criteria:**
- Chart updates from authorized patient CareAgents are received and stored
- Unauthorized sync attempts (no chart read access in consent) are rejected
- Incremental sync correctly delivers only new entries
- Revoking access purges all cached entries for that relationship
- Content hashes are verified on receipt
- Sync events appear in the audit log

**Requirements:** SYNC-01 through SYNC-05

---

### Phase 9: Integration Testing & Documentation

**Goal:** End-to-end integration tests covering all core flows, comprehensive API documentation, and operational guides.

**Depends on:** All previous phases

**Deliverables:**
1. E2E integration tests:
   - Full lifecycle: init → register → add provider → patient connects → consent handshake → session established → session terminated
   - Local discovery flow: mDNS advertisement → patient discovers → local connection → same consent flow
   - Scheduling flow: create appointment → update status → complete → create billing record
   - API flow: create API key → authenticate → query scheduling/billing → rate limiting
   - Sync flow: establish relationship with chart access → sync chart data → revoke access → cache purged
   - Termination flow: terminate relationship → routing stops → audit logged
2. REST API documentation (`docs/api.md`) — complete endpoint reference with request/response examples
3. Architecture guide (`docs/architecture.md`) — system overview, data flow diagrams, component interactions
4. Configuration reference (`docs/configuration.md`) — all config options, environment variables, validation rules
5. README.md updated with accurate installation, configuration, and usage instructions

**Success Criteria:**
- All E2E integration tests pass
- A developer can install, configure, and run the Neuron by following the README alone
- A third-party developer can integrate with the REST API by following the API documentation alone
- All 9 core functionalities are covered by integration tests
- Test coverage meets 80% threshold across all modules

**Requirements:** INTG-01 through INTG-04, DOCS-01 through DOCS-03

---

## 8. Requirements Traceability

### v1 Requirements

**National Registration (NREG)**

| ID | Requirement | Phase |
|----|-------------|-------|
| NREG-01 | Organization registration with Axon using NPI as universal identifier | 2 |
| NREG-02 | Provider registration with Axon through the Neuron (providers never contact Axon directly) | 2 |
| NREG-03 | Periodic heartbeat to maintain `reachable` status in Axon endpoint directory | 2 |
| NREG-04 | Dynamic provider management (add/remove/update without restart) | 2 |
| NREG-05 | Registration state persistence across Neuron restarts | 2 |
| NREG-06 | Graceful degradation when Axon is unreachable (established relationships continue) | 2 |

**Configuration (CONF)**

| ID | Requirement | Phase |
|----|-------------|-------|
| CONF-01 | TypeBox schema for `neuron.config.json` with full validation at startup | 1 |
| CONF-02 | Environment variable overrides with `NEURON_` prefix | 1 |
| CONF-03 | NPI validation (10-digit format, Luhn check) for organization and all providers | 1 |
| CONF-04 | Invalid configuration prevents startup with clear error messages | 1 |

**Consent Verification (CSNT)**

| ID | Requirement | Phase |
|----|-------------|-------|
| CSNT-01 | Ed25519 consent token verification using Node.js built-in crypto | 3 |
| CSNT-02 | Stateless re-verification on every connection (no cached trust) | 3 |
| CSNT-03 | Expired consent tokens rejected with specific error code | 3 |
| CSNT-04 | Consent scope passed to provider CareAgent (Neuron does not interpret scope) | 3 |

**Relationship Registration (RELN)**

| ID | Requirement | Phase |
|----|-------------|-------|
| RELN-01 | RelationshipRecord store with file-backed persistence | 3 |
| RELN-02 | Consent handshake handler (Neuron side of Axon protocol handshake) | 3 |
| RELN-03 | Relationship queries by patient agent ID, provider NPI, relationship ID | 3 |
| RELN-04 | Relationship records persist across Neuron restarts | 3 |

**Relationship Termination (TERM)**

| ID | Requirement | Phase |
|----|-------------|-------|
| TERM-01 | Provider-initiated termination following state protocol requirements | 3 |
| TERM-02 | Terminated relationships stop routing permanently | 3 |
| TERM-03 | TerminationRecord persistence with audit trail linkage | 3 |
| TERM-04 | Terminated relationships cannot be reactivated (new relationship requires fresh handshake) | 3 |

**Connection Routing (ROUT)**

| ID | Requirement | Phase |
|----|-------------|-------|
| ROUT-01 | WebSocket server accepting inbound patient CareAgent connections | 4 |
| ROUT-02 | Connection authentication: consent token verification → relationship check → route | 4 |
| ROUT-03 | Bidirectional session bridge between patient and provider WebSocket connections | 4 |
| ROUT-04 | Active session tracking with per-provider concurrency limits | 4 |
| ROUT-05 | Graceful session termination from either side | 4 |
| ROUT-06 | Implements `ProtocolServer` interface from provider-core | 4 |

**Local Network Discovery (DISC)**

| ID | Requirement | Phase |
|----|-------------|-------|
| DISC-01 | mDNS/DNS-SD advertisement with service type `_careagent-neuron._tcp` | 5 |
| DISC-02 | TXT record with organization NPI, protocol version, and endpoint | 5 |
| DISC-03 | Auto-start/stop with Neuron lifecycle | 5 |
| DISC-04 | Same consent verification flow as remote connections (no security shortcuts) | 5 |

**Scheduling (SCHED)**

| ID | Requirement | Phase |
|----|-------------|-------|
| SCHED-01 | Appointment CRUD with full status lifecycle | 6 |
| SCHED-02 | Provider availability management (recurring, one-time, blocks) | 6 |
| SCHED-03 | Time-based and status-based query engine | 6 |
| SCHED-04 | All records reference `relationship_id` only (no patient identity) | 6 |

**Billing (BILL)**

| ID | Requirement | Phase |
|----|-------------|-------|
| BILL-01 | Billing record CRUD with CPT code entry and modifiers | 6 |
| BILL-02 | ICD-10 code entry for billing justification | 6 |
| BILL-03 | Billing status tracking (draft → submitted → accepted/denied/appealed) | 6 |
| BILL-04 | All records reference `relationship_id` only (no patient identity) | 6 |

**Third-Party REST API (TAPI)**

| ID | Requirement | Phase |
|----|-------------|-------|
| TAPI-01 | HTTP server on Node.js built-in `http` module | 7 |
| TAPI-02 | API key authentication for all endpoints | 7 |
| TAPI-03 | Rate limiting per API key with configurable limits | 7 |
| TAPI-04 | CORS handling with configurable allowed origins | 7 |
| TAPI-05 | All routes from section 2.7.3 implemented | 7 |
| TAPI-06 | OpenAPI 3.1 specification served at `GET /openapi.json` | 7 |
| TAPI-07 | API key management via CLI (`neuron api-key create/revoke/list`) | 7 |

**Patient Chart Sync (SYNC)**

| ID | Requirement | Phase |
|----|-------------|-------|
| SYNC-01 | Sync receiver accepting incremental chart updates over WebSocket | 8 |
| SYNC-02 | Authorization check (relationship must grant chart read access) | 8 |
| SYNC-03 | CachedChartEntry store with persistence and integrity verification | 8 |
| SYNC-04 | Incremental sync with last-sync-timestamp tracking per relationship | 8 |
| SYNC-05 | Access revocation: purge cached entries and stop accepting sync data | 8 |

**Audit Logging (AUDT)**

| ID | Requirement | Phase |
|----|-------------|-------|
| AUDT-01 | Hash-chained JSONL audit log with SHA-256 tamper-evident chain | 1 |
| AUDT-02 | Audited events: registration, connection, consent, API access, sync, admin, termination | 1 |
| AUDT-03 | Audit chain integrity verification utility | 1 |

**Integration & Documentation (INTG/DOCS)**

| ID | Requirement | Phase |
|----|-------------|-------|
| INTG-01 | E2E integration test: full lifecycle (init → register → connect → session → terminate) | 9 |
| INTG-02 | E2E integration test: local discovery flow | 9 |
| INTG-03 | E2E integration test: scheduling/billing through REST API | 9 |
| INTG-04 | E2E integration test: chart sync and revocation | 9 |
| DOCS-01 | REST API documentation with endpoint reference and examples | 9 |
| DOCS-02 | Architecture guide with data flow diagrams | 9 |
| DOCS-03 | Configuration reference with all options and environment variables | 9 |

**Coverage:** 62 v1 requirements across 13 domains. All mapped to phases. Zero unmapped.

---

## 9. Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|-------------|-----------|-------------------|
| **Clinical data storage** | Neuron is operational infrastructure. Storing clinical data makes it a clinical system requiring HIPAA compliance. | Clinical data lives in Patient Charts. Neuron caches synced chart data but does not produce or modify it. |
| **LLM or AI reasoning** | Neuron is a membrane, not a brain. Intelligence lives in the CareAgents behind it. | CareAgents perform reasoning. Neuron routes, stores operational data, and manages relationships. |
| **Writing to Patient Charts** | Only credentialed provider CareAgents write to Patient Charts. The Neuron has no clinical credentials. | Provider CareAgents write; Neuron receives sync data (read-only cache). |
| **EMR replacement** | Full EMR functionality requires clinical data, clinical workflows, and clinical decision support. | Neuron provides minimal operational data (scheduling, billing, routing). Clinical workflows are CareAgent-driven. |
| **Direct Axon exposure for third parties** | Axon is a closed protocol layer for authorized ecosystem participants only. | Third-party applications integrate through the Neuron REST API. |
| **Patient identity storage** | Storing patient identity creates a central target. | All references use opaque `relationship_id` and `patient_agent_id`. Patient identity lives with the patient. |
| **Multi-site clustering (v1)** | Distributed systems add complexity that blocks the demo. | v1 is single-process. Clustering is v2. |
| **Production database (v1)** | Database infrastructure adds operational burden for the demo phase. | v1 uses file-backed JSON or SQLite. Production DB is v2. |
| **BLE/NFC discovery (v1)** | Platform-specific BLE/NFC implementations require native modules and device-specific testing. | v1 uses mDNS/DNS-SD. BLE/NFC is v2. |

---

## 10. Open Questions

1. **Zero-dep constraint.** Provider-core and patient-core are zero-runtime-dependency embeddable plugins. Neuron is a standalone server. Should Neuron maintain the zero-dep constraint or relax it for server-specific needs (`ws`, mDNS library, SQLite binding)? **Recommendation:** Relax for standalone server. Minimal deps are acceptable — the zero-dep philosophy applies to embeddable plugins, not standalone infrastructure.

2. **Patient identity in scheduling/billing.** Should scheduling and billing records reference patient names for operational readability, or only `relationship_id`? **Recommendation:** `relationship_id` only in v1. Patient identity can be resolved through the CareAgent connection when needed. This keeps the Neuron's data store free of PII.

3. **Storage engine.** File-backed JSON is simplest but has limitations (no concurrent writes, no indexing, large file sizes). SQLite provides ACID transactions and indexing without a separate server process. **Options:** (a) File-backed JSON for simplicity (b) SQLite for robustness (c) Start with JSON, migrate to SQLite if needed.

4. **WebSocket implementation.** Node.js 22+ includes experimental `WebSocket` support, but the `ws` package is the established standard. **Options:** (a) `ws` package (proven, full-featured, minor dependency) (b) Node.js built-in (experimental, may have limitations).

5. **Cross-repo dependency management.** Neuron consumes `@careagent/axon` (for registry client) and is consumed by provider-core and patient-core (as the routing target). How do version bumps propagate? pnpm workspace? npm link for development? Independent releases?

6. **SDK packaging.** The README mentions `@careagent/neuron-sdk` as a separate package. Should the SDK be: (a) A separate repo (`careagent/neuron-sdk`) (b) A sub-package in the Neuron monorepo (c) Generated from the OpenAPI spec?

7. **State termination protocol data source.** Neuron validates termination against state protocol requirements. Where does the state protocol data come from in v1? Provider-attested? A static data file? An external source?

8. **Resilience/restart model.** The README describes local-first operation and resilience. What happens to in-flight sessions during a Neuron restart? Are they dropped (clients reconnect) or persisted (sessions resume)?

---

## 11. v2 Deferred Requirements

| ID | Requirement | Rationale for Deferral |
|----|-------------|----------------------|
| DISC-05 | BLE discovery for proximity-based connections | Platform-specific native modules and device testing |
| DISC-06 | NFC discovery for tap-to-connect | Platform-specific native modules and device testing |
| STOR-01 | Production database backend (PostgreSQL/MySQL) | Operational complexity that blocks the demo |
| SEC-01 | Data encryption at rest | Filesystem-level encryption is sufficient for v1 |
| SEC-02 | Mutual TLS for Axon communication | Bearer tokens sufficient for demo |
| SEC-03 | OAuth 2.0 for third-party API authentication | API keys sufficient for demo |
| SCALE-01 | Multi-site clustering | Distributed systems complexity blocks the demo |
| SCALE-02 | Load balancing and horizontal scaling | Single-process sufficient for demo |
| BILL-05 | Claims submission to payers | Requires payer integration and clearinghouse connectivity |
| SCHED-05 | External calendar integration (Google Calendar, Outlook) | Requires OAuth flows and external API integration |
| SDK-01 | Full `@careagent/neuron-sdk` TypeScript client package | Can be built incrementally after API stabilizes |

---

## 12. Success Criteria

### What "Done" Looks Like for v1

1. **Registration works end-to-end.** A Neuron can register an organization and its providers with a (mock) Axon registry, maintain a heartbeat, and manage providers dynamically. Registration state survives restarts.

2. **Patient routing works.** A patient CareAgent can connect to the Neuron (via Axon lookup or local mDNS discovery), present a valid consent token, and be routed to the correct provider CareAgent for an active session.

3. **Consent is enforced.** No connection is established without a verified Ed25519 consent token and an active relationship record. Expired tokens, missing relationships, and terminated relationships all block routing.

4. **Operational data layer functions.** Appointments can be scheduled, provider availability can be managed, and billing records with CPT/ICD codes can be created and tracked — all referenced by `relationship_id`, never patient identity.

5. **Third-party integration works.** A third-party application can authenticate with an API key, query scheduling and billing data, and read relationship status through the REST API. The OpenAPI spec documents the full API surface.

6. **Audit trail is tamper-evident.** Every significant event (registration, connection, consent, API access, sync, termination) is logged in a hash-chained JSONL audit log that can be verified for integrity.

7. **Tests pass.** All unit and integration tests pass at 80%+ coverage. E2E tests cover the full lifecycle from registration through patient connection, scheduling, and termination.
