# Feature Research

**Domain:** Healthcare organizational endpoint/routing server (CareAgent Neuron)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (System Is Non-Functional Without These)

Features that any healthcare organizational endpoint/gateway server must have to be considered operational. Missing any of these means the system cannot fulfill its role as the organizational membrane between a national network and provider agents.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Organization Registration with NPI** | NPI is the universal identifier for healthcare entities in the US. Without registration, the organization does not exist on the network. NPPES NPI Registry is the CMS standard. | MEDIUM | Requires NPI validation (10-digit + Luhn check), Axon registry client, and persistent registration state. Phase 2. [NREG-01 through NREG-06] |
| **Provider Credential Management** | Organizations have multiple providers. Each must be registered, credentialed, and manageable without downtime. Standard in every credentialing platform (Medallion, CureMD, etc.). | MEDIUM | Dynamic add/remove/update without restart. Credential status lifecycle (active/pending/expired/suspended/revoked). Phase 2. [NREG-02, NREG-04] |
| **Consent Verification (Ed25519 Token)** | No healthcare data exchange happens without verified patient consent. Cryptographic consent verification is the foundation of trust. Aligns with decentralized identity / verifiable credential patterns gaining traction across healthcare. | HIGH | Stateless Ed25519 signature verification on every connection. No cached trust. Expired tokens rejected. Consent scope passed through without interpretation. Phase 3. [CSNT-01 through CSNT-04] |
| **Relationship Registration and Store** | Care relationships are the routing primitive. Without a relationship record, the system cannot route any connection. Every healthcare system tracks patient-provider relationships. | MEDIUM | File-backed persistence, consent handshake handler, queries by patient/provider/relationship ID. Phase 3. [RELN-01 through RELN-04] |
| **Patient-to-Provider Connection Routing** | The core function of the Neuron. Without routing, there is no organizational endpoint. This is the WebSocket server accepting patient CareAgent connections and bridging them to providers. | HIGH | WebSocket server, connection auth flow (consent -> relationship check -> route), bidirectional session bridge, session tracking, per-provider concurrency limits. Phase 4. [ROUT-01 through ROUT-06] |
| **Session Management** | Active session tracking is required for concurrency control, graceful termination, and system observability. Standard in any routing/gateway system. | MEDIUM | Track session lifecycle (authenticating -> routing -> active -> completed/terminated/error), enforce per-provider limits, graceful teardown from either side. Phase 4. [ROUT-04, ROUT-05] |
| **Configuration with Validation** | A misconfigured healthcare server is a liability. Schema-validated configuration with clear error messages is expected of any production-grade server. | LOW | TypeBox schema, env var overrides (NEURON_ prefix), NPI validation at startup, fail-fast on invalid config. Phase 1. [CONF-01 through CONF-04] |
| **Audit Logging (Tamper-Evident)** | HIPAA Security Rule (45 CFR 164.312) requires audit controls. Hash-chained logging with SHA-256 is a recognized pattern for tamper-evident audit trails. Even though Neuron is designed to avoid HIPAA classification, healthcare organizations expect audit infrastructure. | MEDIUM | Hash-chained JSONL with SHA-256. Covers registration, connection, consent, API access, sync, admin, and termination events. Chain integrity verification utility. Phase 1. [AUDT-01 through AUDT-03] |
| **Heartbeat / Health Monitoring** | Any server that registers with a directory must maintain reachable status. Standard pattern in service discovery (health checks, keepalives). | LOW | Periodic heartbeat to Axon, configurable interval (default 60s), graceful degradation when Axon unreachable. Phase 2. [NREG-03, NREG-06] |
| **Relationship Termination** | State-protocol-compliant termination is a legal requirement in healthcare. Providers must follow 30-day notice periods, referral obligations, and documentation requirements that vary by state. A system that cannot terminate relationships is legally incomplete. | MEDIUM | Permanent termination (no reactivation), state protocol reference tracking, termination records with audit trail linkage. Phase 3. [TERM-01 through TERM-04] |
| **REST API with Authentication** | Third-party integration is the primary way external tools (practice management, billing systems) interact with the organization. API key auth with rate limiting is the minimum viable security model. | MEDIUM | Node.js built-in http module, API key auth, rate limiting per key, CORS, JSON request/response. Phase 7. [TAPI-01 through TAPI-07] |
| **Persistence Across Restarts** | Losing registration state, relationships, or scheduling data on restart is unacceptable for any server. | LOW | File-backed JSON (v1) or SQLite for all stores. Relationship, registration, scheduling, billing, and audit data survive restarts. Spans all phases. |

### Differentiators (Competitive Advantage / Ecosystem Value)

Features that set the Neuron apart from typical healthcare integration engines (Mirth Connect, Rhapsody) and practice management platforms (OpenEMR, OpenMRS). These create ecosystem value that existing tools do not provide.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Cryptographic Consent-First Architecture** | Unlike existing healthcare gateways that use role-based access or OAuth scopes, Neuron enforces Ed25519 cryptographic consent verification on every single connection. No connection without a valid signed token. This is the decentralized identity / verifiable credential pattern applied to real-time routing, not just data access. No existing open-source healthcare server does this. | HIGH | The consent model is the architectural innovation. It requires Ed25519 key management, stateless verification, and tight coupling with the routing pipeline. This is what makes Neuron not just another gateway. |
| **Zero Patient Identity Storage** | All references use opaque `relationship_id` and `patient_agent_id`. The Neuron never stores patient names, DOBs, SSNs, or any PII. This is a deliberate architectural choice that keeps the Neuron outside HIPAA covered entity classification. OpenEMR, OpenMRS, and every traditional EMR stores patient demographics. Neuron does not. | LOW | The complexity is in the discipline of maintaining this constraint everywhere (scheduling, billing, relationships, sync). The implementation is simple; the architectural commitment is the differentiator. |
| **Patient-Controlled Data Flow** | Patient CareAgents push data to the Neuron (chart sync). The Neuron does not pull. Patients revoke access and cached data is purged. This inverts the traditional model where organizations own and control patient data. Aligns with TEFCA and CMS interoperability trends pushing patient data ownership. | HIGH | Sync receiver, authorization checks, incremental sync with timestamp tracking, access revocation with cache purge. Phase 8. [SYNC-01 through SYNC-05] |
| **Local Network Discovery (mDNS/DNS-SD)** | When a patient is physically at the clinic, their CareAgent discovers the Neuron on the local network without any national infrastructure involvement. This creates the highest-trust connection state (physical presence + local network + cryptographic verification). No existing healthcare gateway offers mDNS-based patient device discovery. | MEDIUM | mDNS/DNS-SD advertisement (_careagent-neuron._tcp), TXT records with org NPI and protocol version, auto-start/stop with server lifecycle. Same consent flow as remote (no security shortcuts). Phase 5. [DISC-01 through DISC-04] |
| **Free, Open-Source Organizational Infrastructure** | Apache 2.0 licensed. Any NPI-holding organization runs it for free. This is not a product; it is infrastructure. OpenEMR and OpenMRS are open-source EMRs, but neither serves as a network routing endpoint. Neuron fills a unique role: the organizational boundary layer for an agent-based care network. | LOW | The differentiator is the positioning, not the implementation. The license and cost model are the strategic advantage. |
| **Agent-Aware Routing (Not Message-Based)** | Traditional healthcare integration engines (Mirth Connect, Rhapsody, Cloverleaf) route messages between systems using HL7/FHIR transforms. Neuron routes live WebSocket sessions between intelligent agents. This is a fundamentally different interaction model: real-time bidirectional sessions, not batch message transforms. | HIGH | WebSocket session bridging, ProtocolServer interface compliance, AxonMessage format, concurrent session management. This is the core architectural difference from existing integration engines. |
| **Scheduling/Billing Without Patient Identity** | The operational data layer references `relationship_id` only. ICD/CPT codes exist for billing justification but cannot be linked to a patient identity from the Neuron's data alone. No other practice management system works this way. | MEDIUM | Appointment CRUD, provider availability, billing records with CPT/ICD codes. All referencing relationship_id. Phase 6. [SCHED-01 through SCHED-04, BILL-01 through BILL-04] |
| **OpenAPI 3.1 Spec from Route Definitions** | Auto-generated OpenAPI spec means the API documentation is always accurate and third-party SDK generation is straightforward. Many healthcare APIs still use manually maintained specs that drift from implementation. | LOW | Generated from TypeBox schemas and route definitions. Served at GET /openapi.json. Phase 7. [TAPI-06] |

### Anti-Features (Deliberately NOT Building)

Features that seem useful but violate Neuron's architectural principles, create regulatory risk, or add complexity that blocks the v1 demo.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Clinical Data Storage** | Organizations want all data in one place. | Storing clinical data makes Neuron a HIPAA covered entity. Transforms infrastructure into a clinical system requiring certification, BAAs, and HIPAA audits. Violates the "organizational membrane" principle. | Clinical data lives in Patient Charts. Neuron caches synced chart data (read-only, purgeable) but never produces or modifies clinical content. |
| **LLM / AI Reasoning** | AI is the current hype. People will ask "why doesn't the server have AI?" | Neuron is a membrane, not a brain. Adding intelligence to infrastructure couples routing decisions to model quality, creates latency, and conflates concerns. Intelligence belongs in CareAgents. | CareAgents behind the Neuron perform all reasoning. Neuron routes, stores operational data, and manages relationships. |
| **Patient Identity Storage in Scheduling/Billing** | Practice staff want to see patient names on the schedule, not opaque IDs. | Storing patient PII in the Neuron creates a central identity target and brings HIPAA covered entity classification. Also contradicts the patient-controlled data model. | Patient identity is resolved through the CareAgent connection when needed. v1 uses relationship_id only. Display-layer name resolution can be a v2 feature where the patient's CareAgent provides the name on demand. |
| **EMR Replacement / Full Clinical Workflows** | "If it has scheduling and billing, why not add clinical notes and problem lists?" | Full EMR functionality requires clinical data storage, clinical decision support, certification (ONC), and HIPAA compliance. This is a multi-year, multi-million-dollar undertaking that OpenEMR and OpenMRS already serve (imperfectly). | Neuron provides the minimal operational data layer (scheduling, billing, routing). Clinical workflows are CareAgent-driven. Neuron integrates with EMRs through the REST API, not by becoming one. |
| **Direct Axon Protocol Exposure for Third Parties** | Third-party developers want the fastest path to the network. | Axon is a closed protocol layer for authorized ecosystem participants. Exposing it to arbitrary third parties creates attack surface, protocol versioning nightmares, and trust boundary violations. | Third parties integrate through the Neuron REST API. The API is the intentional, hardened boundary. |
| **BLE/NFC Discovery (v1)** | Proximity-based connection for in-clinic patients. | BLE and NFC require platform-specific native modules (iOS CoreBluetooth, Android Bluetooth LE APIs), device-specific testing matrices, and app-level permissions. This blocks the v1 demo with complexity orthogonal to the core server. | v1 uses mDNS/DNS-SD for local network discovery. BLE/NFC is v2 when native client SDKs exist. |
| **Multi-Site Clustering (v1)** | Hospital systems have multiple locations. | Distributed systems (consensus, partition tolerance, state sync across nodes) add massive complexity that blocks the demo. Single-process is sufficient to prove the architecture. | v1 is single-process. Multi-site clustering is v2 after the architecture is validated. |
| **Production Database (v1)** | "SQLite/JSON won't scale." | PostgreSQL/MySQL add operational burden (installation, configuration, backups, migrations) that blocks the demo. v1 is a functional demo, not a production deployment. | File-backed JSON or SQLite for v1. Production database backend is v2 when real organizations are deploying. |
| **Claims Submission to Payers** | "If it has billing, why can't it submit claims?" | Claims submission requires clearinghouse connectivity (e.g., Availity, Change Healthcare), payer-specific formats (837P/837I EDI), enrollment with each payer, and error handling for denials/appeals. This is an entire product domain. | Neuron tracks billing records (CPT/ICD codes, charge amounts, status). Claims submission to payers is a third-party integration that connects via the REST API. |
| **External Calendar Integration (v1)** | Providers want Google Calendar / Outlook sync. | Requires OAuth flows with Google/Microsoft, webhook subscriptions, conflict resolution, timezone handling, and ongoing API maintenance as providers change. | v1 scheduling is self-contained. Calendar integration is v2 when the API is stable and third-party developers build the bridges. |
| **OAuth 2.0 for API Auth (v1)** | "API keys aren't secure enough." | OAuth 2.0 adds authorization server infrastructure, token refresh flows, scope management, and client registration. For a locally-deployed organizational server, API keys with rate limiting are sufficient for the demo. | v1 uses API keys generated via CLI. OAuth 2.0 is v2 when third-party developer ecosystem matures. |
| **Data Encryption at Rest (v1)** | "Healthcare data should be encrypted." | Application-level encryption adds key management complexity. The Neuron is deployed on infrastructure controlled by the organization. | Filesystem-level encryption (FileVault, LUKS, BitLocker) is recommended. The Neuron documents this recommendation. Application-level encryption at rest is v2. |

## Feature Dependencies

```
[Configuration & Validation] (Phase 1)
    |
    +--requires--> [Audit Logging] (Phase 1)
    |                  |
    |                  +-- (consumed by all subsequent phases)
    |
    +--requires--> [Organization Registration] (Phase 2)
    |                  |
    |                  +--requires--> [Provider Credential Management] (Phase 2)
    |                  |
    |                  +--requires--> [Heartbeat / Health Monitoring] (Phase 2)
    |
    +--requires--> [Relationship Store & Consent Verification] (Phase 3)
    |                  |
    |                  +--requires--> [Relationship Termination] (Phase 3)
    |                  |
    |                  +--requires--> [Patient-to-Provider Connection Routing] (Phase 4)
    |                  |                  |
    |                  |                  +--requires--> [Session Management] (Phase 4)
    |                  |                  |
    |                  |                  +--enables--> [Local Network Discovery] (Phase 5)
    |                  |                  |
    |                  |                  +--enables--> [Patient Chart Sync] (Phase 8)
    |                  |
    |                  +--requires--> [Scheduling & Billing Data Layer] (Phase 6)
    |                                     |
    |                                     +--requires--> [REST API] (Phase 7)

[REST API] (Phase 7) --exposes--> [Scheduling & Billing Data Layer] (Phase 6)
[REST API] (Phase 7) --exposes--> [Relationship Store] (Phase 3) (read-only)
[REST API] (Phase 7) --exposes--> [Organization Registration] (Phase 2) (read-only)

[Local Network Discovery] (Phase 5) --enhances--> [Connection Routing] (Phase 4)
    (Same consent flow, additional discovery channel)

[Patient Chart Sync] (Phase 8) --depends-on--> [Connection Routing] (Phase 4)
[Patient Chart Sync] (Phase 8) --depends-on--> [Consent Verification] (Phase 3)
```

### Dependency Notes

- **Configuration requires Audit Logging:** Audit logging must be available from Phase 1 because all subsequent phases emit audit events. Building them together is correct.
- **Registration requires Configuration:** The Neuron cannot register without valid configuration (NPI, Axon URL, endpoint URL). Phase 2 depends on Phase 1.
- **Consent Verification requires Registration:** Consent tokens reference provider NPIs and organizational identity. The registration phase must establish these first.
- **Connection Routing requires Consent + Relationships:** Every connection goes through consent verification and relationship lookup. Phase 4 cannot function without Phase 3.
- **Scheduling/Billing requires Relationships:** All scheduling and billing records reference `relationship_id`. The relationship store (Phase 3) must exist first.
- **REST API requires Scheduling/Billing:** The REST API is the exposure layer for scheduling and billing data. Phase 7 builds on Phase 6.
- **Local Discovery enhances Routing:** mDNS discovery is an alternative channel into the same routing pipeline. Phase 5 adds a discovery method to Phase 4's routing infrastructure.
- **Patient Chart Sync requires Routing + Consent:** Chart sync happens over established WebSocket sessions (Phase 4) with consent authorization checks (Phase 3). Phase 8 depends on both.
- **Audit Logging has no upstream dependencies:** It is consumed by everything but depends on nothing except the basic project scaffold.

## MVP Definition

### Launch With (v1)

Minimum viable organizational endpoint that proves the architectural concept: consent-first routing, zero patient identity, agent-aware sessions.

- [x] **Configuration with validation** -- without this, nothing starts [Phase 1]
- [x] **Audit logging (hash-chained JSONL)** -- foundational infrastructure consumed by all modules [Phase 1]
- [x] **Organization + provider registration with Axon** -- without this, the Neuron is invisible to the network [Phase 2]
- [x] **Heartbeat / health monitoring** -- maintains reachable status in Axon directory [Phase 2]
- [x] **Relationship store and consent verification** -- the trust foundation; no routing without consent [Phase 3]
- [x] **Relationship termination** -- legally required lifecycle management [Phase 3]
- [x] **Patient-to-provider WebSocket routing** -- the core function of the Neuron [Phase 4]
- [x] **Session management** -- concurrency control and observability for routing [Phase 4]
- [x] **Local network discovery (mDNS)** -- proves the highest-trust connection model [Phase 5]
- [x] **Scheduling and billing data layer** -- minimal operational data store [Phase 6]
- [x] **REST API with API key auth** -- third-party integration surface [Phase 7]
- [x] **Patient Chart sync endpoint** -- proves patient-controlled data flow [Phase 8]
- [x] **E2E integration tests and documentation** -- validates all 9 functionalities work together [Phase 9]

### Add After Validation (v1.x)

Features to add once the core architecture is proven and real organizations start testing.

- [ ] **OAuth 2.0 for REST API** -- when third-party developer ecosystem expands beyond API keys
- [ ] **SQLite migration** (if starting with JSON) -- when data volume exceeds JSON file performance
- [ ] **Mutual TLS for Axon communication** -- when moving beyond demo bearer tokens
- [ ] **Display-layer patient name resolution** -- on-demand name lookup from patient CareAgent for scheduling UI
- [ ] **Neuron SDK package** (`@careagent/neuron-sdk`) -- TypeScript client generated from OpenAPI spec

### Future Consideration (v2+)

Features to defer until product-market fit is established and real deployments exist.

- [ ] **BLE/NFC discovery** -- requires native client SDKs and device-specific testing
- [ ] **Multi-site clustering** -- requires distributed consensus and state sync
- [ ] **Production database (PostgreSQL)** -- when file-backed storage is proven insufficient
- [ ] **Data encryption at rest** -- application-level key management
- [ ] **Claims submission to payers** -- clearinghouse integration, EDI formats
- [ ] **External calendar integration** -- Google/Outlook OAuth flows
- [ ] **Horizontal scaling / load balancing** -- when single-process is proven insufficient

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Configuration & Validation | HIGH | LOW | P1 |
| Audit Logging (Hash-Chained) | HIGH | MEDIUM | P1 |
| Organization Registration (NPI) | HIGH | MEDIUM | P1 |
| Provider Credential Management | HIGH | MEDIUM | P1 |
| Heartbeat / Health Monitoring | MEDIUM | LOW | P1 |
| Consent Verification (Ed25519) | HIGH | HIGH | P1 |
| Relationship Store | HIGH | MEDIUM | P1 |
| Relationship Termination | MEDIUM | MEDIUM | P1 |
| Patient-to-Provider Routing | HIGH | HIGH | P1 |
| Session Management | HIGH | MEDIUM | P1 |
| Local Network Discovery (mDNS) | MEDIUM | MEDIUM | P1 |
| Scheduling Data Layer | MEDIUM | MEDIUM | P1 |
| Billing Data Layer | MEDIUM | MEDIUM | P1 |
| REST API + Auth + Rate Limiting | HIGH | MEDIUM | P1 |
| OpenAPI 3.1 Spec Generation | MEDIUM | LOW | P1 |
| Patient Chart Sync | MEDIUM | HIGH | P1 |
| E2E Integration Tests | HIGH | MEDIUM | P1 |
| OAuth 2.0 API Auth | MEDIUM | HIGH | P2 |
| Mutual TLS (Axon) | MEDIUM | MEDIUM | P2 |
| Neuron SDK Package | MEDIUM | LOW | P2 |
| BLE/NFC Discovery | LOW | HIGH | P3 |
| Multi-Site Clustering | LOW | HIGH | P3 |
| Production Database | LOW | MEDIUM | P3 |
| Claims Submission | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1 launch (all 9 core functionalities)
- P2: Should have, add in v1.x when architecture is validated
- P3: Nice to have, future consideration for v2+

## Competitor / Comparable Feature Analysis

| Feature Area | Mirth Connect / Rhapsody (Integration Engines) | OpenEMR (Open-Source EMR) | FHIR Server (HAPI/Google Cloud Healthcare) | CareAgent Neuron |
|---|---|---|---|---|
| **Message/Session Routing** | HL7/FHIR message transforms and routing | N/A (not a routing system) | FHIR resource endpoints, not real-time sessions | Real-time WebSocket session routing between agents |
| **Consent Management** | None built-in (delegated to connected systems) | Basic consent forms (paper-oriented) | FHIR Consent resource (data-layer only) | Cryptographic Ed25519 consent verification on every connection |
| **Patient Identity** | Stores MRNs, demographics | Full patient demographics (name, DOB, SSN, insurance) | FHIR Patient resource with full demographics | Zero patient identity. Opaque relationship_id only. |
| **Scheduling** | N/A (not a scheduling system) | Full scheduling with patient names | FHIR Schedule/Slot/Appointment resources | Scheduling by relationship_id only (no patient identity) |
| **Billing** | N/A (not a billing system) | Full billing with patient demographics, insurance | FHIR Claim/Invoice resources | Billing by relationship_id with CPT/ICD codes (no patient identity) |
| **Audit Logging** | Channel-level logging, not hash-chained | Activity logs, not tamper-evident | FHIR AuditEvent resource | Hash-chained JSONL with SHA-256 tamper-evident chain |
| **Local Discovery** | N/A | N/A | N/A | mDNS/DNS-SD for in-clinic patient discovery |
| **Third-Party API** | Channel APIs for system integration | Limited REST API | Full FHIR REST API | OpenAPI 3.1 REST API with key auth and rate limiting |
| **Open Source** | Mirth: Yes (MPL). Rhapsody: No. | Yes (GPL-2.0) | HAPI: Yes (Apache 2.0). Google: No. | Yes (Apache 2.0) |
| **Cost** | Mirth: Free (community). Rhapsody: Licensed. | Free | HAPI: Free. Google: Usage-based. | Free for any NPI-holding organization |

**Key takeaway:** Neuron occupies a unique position. It is not an integration engine (it routes agent sessions, not messages). It is not an EMR (it stores no clinical data or patient identity). It is not a FHIR server (it uses a custom protocol with cryptographic consent). It is the organizational membrane for an agent-based care network -- a category that does not currently exist in the open-source healthcare ecosystem.

## Sources

- [NPPES NPI Registry (CMS)](https://npiregistry.cms.hhs.gov/) -- NPI validation standards
- [HIPAA Audit Log Requirements (Kiteworks, 2025)](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/) -- tamper-evident audit logging requirements
- [Building HIPAA-Grade Audit Logging (Keshav Agrawal, 2025)](https://medium.com/@keshavagrawal/building-a-hipaa-grade-audit-logging-system-lessons-from-the-healthcare-trenches-d5a8bb691e3b) -- hash chain implementation patterns
- [Healthcare API Interoperability and FHIR Guide 2026 (ClindCast)](https://www.clindcast.com/healthcare-api-interoperability-and-fhir-guide-2026/) -- FHIR API and CMS interoperability requirements
- [Decentralized Identity & Consent in Healthcare (VerifNow)](https://www.getverifinow.com/decentralized-identity-consent-in-healthcare-from-portals-to-patient-controlled-credentials/) -- Ed25519 verifiable credentials in healthcare
- [JCS Ed25519 Signature 2020 (DIF)](https://identity.foundation/JcsEd25519Signature2020/) -- Ed25519 signature specification
- [Terminating a Patient Relationship (Tebra)](https://www.tebra.com/theintake/checklists-and-guides/patient-scheduling-retention/terminating-a-patient-relationship-a-guide-for-practices-and-providers-includes-sample-letters) -- state protocol termination requirements
- [Terminating a Provider-Patient Relationship (MedPro)](https://www.medpro.com/documents/10502/2837997/Guideline_Terminating+a+Provider-Patient+Relationship.pdf) -- legal requirements for relationship termination
- [TEFCA 500M Records Exchanged (HHS, 2025)](https://www.hhs.gov/press-room/tefca-americas-national-interoperability-network-reaches-nearly-500-million-health-records-exchanged.html) -- national interoperability trends
- [OpenEMR vs OpenMRS Comparison (CapMinds)](https://www.capminds.com/blog/the-ultimate-breakdown-comparing-openemr-and-openmrs/) -- open-source EMR feature comparison
- [WebSocket Architecture Best Practices (Ably)](https://ably.com/topic/websocket-architecture-best-practices) -- WebSocket session management patterns
- [Healthcare Integration Engine (Mirth Connect)](https://www.nextgen.com/solutions/interoperability/mirth-integration-engine) -- traditional integration engine capabilities
- [Unified API Gateway for Healthcare (CapMinds)](https://www.capminds.com/blog/how-to-build-a-unified-api-gateway-for-patient-facing-and-internal-applications/) -- healthcare API gateway patterns

---
*Feature research for: Healthcare organizational endpoint/routing server (CareAgent Neuron)*
*Researched: 2026-02-21*
