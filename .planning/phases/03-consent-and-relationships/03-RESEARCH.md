# Phase 3: Consent and Relationships - Research

**Researched:** 2026-02-21
**Domain:** Ed25519 cryptographic verification, consent token structure, relationship lifecycle management, challenge-response identity verification, termination state machine
**Confidence:** HIGH (crypto APIs verified on live Node.js 22), HIGH (architecture patterns follow Phase 2 conventions), MEDIUM (consent token wire format -- Axon protocol not yet finalized)

---

## Summary

Phase 3 builds the trust layer that gates all communication through the Neuron. Three interlocking subsystems are required: (1) Ed25519 consent token verification using Node.js built-in `node:crypto`, (2) a `RelationshipRecord` store in SQLite with query support and a consent handshake handler, and (3) a termination subsystem that permanently ends relationships with audit trail linkage. This phase produces no new runtime dependencies -- everything uses `node:crypto` (already available) and `better-sqlite3` (already installed).

The existing codebase provides strong foundations: the `relationships` and `termination_records` tables already exist in SQLite migration v1 with correct indexes, the TypeBox schemas for `RelationshipRecordSchema` and `TerminationRecordSchema` are already defined in `src/types/`, and the `StorageEngine` interface provides the CRUD primitives. The primary work is building the domain logic layer on top of these foundations: a `ConsentVerifier` for Ed25519 token verification, a `RelationshipStore` for CRUD + queries (following the `RegistrationStateStore` pattern from Phase 2), a `ConsentHandshakeHandler` orchestrating the handshake protocol, and a `TerminationHandler` managing the termination state machine.

The critical design decision is the consent token wire format. The PRD specifies Ed25519 signatures but does not prescribe a specific encoding. The research recommends a compact JSON token structure (not JWT/JOSE) signed with Ed25519, verified using `crypto.verify(null, payload, publicKey, signature)`. This avoids adding the `jose` dependency and keeps the verification path minimal and auditable. The public key exchange happens during the initial handshake and is stored in the `RelationshipRecord` for subsequent re-verification (CSNT-02).

**Primary recommendation:** Build the consent/relationship layer using only `node:crypto` for Ed25519 operations (verified working on Node.js 22.22.0), SQLite for persistence (existing tables), and the established project patterns (TypeBox schemas, `StorageEngine` CRUD, audit logger integration). No new dependencies required.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CSNT-01 | Ed25519 consent token verification using Node.js built-in `crypto` | `crypto.verify(null, payload, publicKey, signature)` verified working on Node.js 22.22.0. Public keys imported via JWK format (`{ kty: 'OKP', crv: 'Ed25519', x: base64url }`) or DER with static 12-byte prefix. |
| CSNT-02 | Stateless re-verification on every connection (no cached trust) | `ConsentVerifier.verify()` is a pure function: takes token + public key, returns verified claims or error. No internal state, no trust cache. Public key stored in `RelationshipRecord.patient_public_key` for re-verification. |
| CSNT-03 | Expired consent tokens rejected with specific error code | Token payload includes `exp` (Unix timestamp). Verifier checks `Date.now() > exp * 1000` before signature verification. Returns typed `ConsentError` with code `CONSENT_EXPIRED`. |
| CSNT-04 | Consent scope passed to provider CareAgent (Neuron does not interpret scope) | Token payload includes `consented_actions: string[]`. After verification, the scope is extracted and passed through to the provider CareAgent connection. Neuron stores it in the relationship record but does not validate the action strings. |
| RELN-01 | RelationshipRecord store with persistent storage (survives restarts) | `relationships` table already exists in SQLite migration v1 with indexes on `patient_agent_id`, `provider_npi`, and `status`. Build `RelationshipStore` class following `RegistrationStateStore` pattern. |
| RELN-02 | Consent handshake handler (Neuron side of Axon protocol handshake) | `ConsentHandshakeHandler` orchestrates: challenge generation -> patient signs challenge -> Neuron verifies signature + consent token -> creates `RelationshipRecord` -> returns relationship_id. |
| RELN-03 | Relationship queries by patient agent ID, provider NPI, relationship ID, status | SQLite indexes already exist. Build query methods: `findByPatient(agentId)`, `findByProvider(npi)`, `findById(relationshipId)`, `findByStatus(status)`, with compound queries. |
| RELN-04 | Challenge-response generation for identity verification | `crypto.randomBytes(32)` generates a 32-byte nonce. Patient signs nonce with their Ed25519 private key. Neuron verifies signature with patient's public key. Nonce stored transiently with TTL to prevent replay. |
| TERM-01 | Provider-initiated termination following state protocol requirements | `TerminationHandler.terminate()` validates provider NPI matches relationship, creates `TerminationRecord`, updates `RelationshipRecord.status` to `'terminated'` in a single SQLite transaction. |
| TERM-02 | Terminated relationships permanently stop routing (no reactivation) | Every routing check (Phase 4) queries relationship status. `status === 'terminated'` immediately rejects with `RELATIONSHIP_TERMINATED` error. No status transition from `terminated` to any other state. |
| TERM-03 | TerminationRecord persistence with audit trail linkage | `termination_records` table already exists in migration v1. `audit_entry_sequence` column links to the audit log entry. Termination handler appends audit event first, then stores the sequence number. |
| TERM-04 | Terminated = permanent; new relationship requires fresh handshake | Enforced at two levels: (1) `RelationshipStore.updateStatus()` rejects transitions from `terminated`, (2) handshake handler checks for existing terminated relationships and requires new consent (new relationship_id). |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` (built-in) | Node 22+ | Ed25519 sign/verify, key import, challenge nonce generation | Zero dependencies; Ed25519 fully supported since Node 16; `crypto.verify(null, data, key, sig)` verified on Node 22.22.0 |
| `better-sqlite3` | ^12.6.2 (already installed) | Persist relationships, termination records, handle transactions | Already in project; synchronous API; tables already exist in migration v1 |
| `@sinclair/typebox` | ^0.34.48 (already installed) | Consent token schema, error type schemas | Already in project; all data models use TypeBox |

### Supporting (Dev/Test Only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ~4.0.18 (already installed) | Unit tests for verifier, store, handlers | All tests follow existing vitest patterns |
| `msw` | ^2.12.10 (already installed) | Not needed for Phase 3 | Phase 3 has no HTTP calls; all logic is local crypto + SQLite |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `crypto.verify` | `jose` npm package for JWT/JWS | `jose` adds a dependency and JWT complexity; consent tokens are simpler than JWTs -- we only need sign/verify, not the full JOSE stack |
| Custom JSON token format | Standard JWT with EdDSA (`alg: 'EdDSA'`) | JWT adds base64url encoding overhead and requires JOSE header parsing; the Neuron's token format is internal to the CareAgent ecosystem, not a public OAuth flow |
| `crypto.createPublicKey` with DER | JWK import via `{ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: ... } }` | Both work; JWK is more self-describing and avoids manual DER prefix construction. Recommend JWK for public key wire format. |
| `node:crypto` randomBytes | `uuid` package for challenge nonces | `crypto.randomBytes(32)` produces 256 bits of entropy; more than sufficient for challenge nonces; no dependency needed |

**Installation:** No new dependencies required. Everything uses existing project packages.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── consent/
│   ├── index.ts              # Public exports: ConsentVerifier, ConsentHandshakeHandler
│   ├── verifier.ts           # Ed25519 consent token verification (stateless)
│   ├── token.ts              # Consent token type definitions and serialization
│   ├── challenge.ts          # Challenge-response nonce generation and verification
│   ├── errors.ts             # Typed consent error codes
│   └── consent.test.ts       # Unit tests
├── relationships/
│   ├── index.ts              # Public exports: RelationshipStore, RelationshipService
│   ├── store.ts              # SQLite CRUD for RelationshipRecord (follows RegistrationStateStore pattern)
│   ├── handshake.ts          # Consent handshake handler (Neuron side)
│   ├── termination.ts        # Termination handler with TerminationRecord persistence
│   └── relationships.test.ts # Unit tests
├── types/
│   ├── relationship.ts       # Already exists -- needs patient_public_key added
│   └── termination.ts        # Already exists -- sufficient as-is
```

### Pattern 1: ConsentVerifier -- Stateless Ed25519 Token Verification

**What:** A pure function (or thin class with no mutable state) that takes a consent token and the patient's public key, verifies the Ed25519 signature, checks expiration, and returns the verified claims or a typed error.

**When to use:** Called on every connection attempt (CSNT-02). Called during the consent handshake to verify the initial consent token. Called during subsequent reconnections to re-verify.

**Example:**
```typescript
// src/consent/verifier.ts
import { verify, createPublicKey, type KeyObject } from 'node:crypto'

export interface ConsentToken {
  /** Raw payload bytes (the signed content) */
  payload: Buffer
  /** Ed25519 signature (64 bytes) */
  signature: Buffer
}

export interface ConsentClaims {
  patient_agent_id: string
  provider_npi: string
  consented_actions: string[]
  exp: number         // Unix timestamp (seconds)
  iat: number         // Unix timestamp (seconds)
  nonce?: string      // Optional replay prevention
}

export type ConsentErrorCode =
  | 'INVALID_SIGNATURE'
  | 'CONSENT_EXPIRED'
  | 'MALFORMED_TOKEN'

export class ConsentError extends Error {
  constructor(
    readonly code: ConsentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConsentError'
  }
}

/**
 * Import an Ed25519 public key from its raw 32-byte representation.
 * Uses JWK format for clean import without manual DER construction.
 */
export function importPublicKey(rawKeyBase64url: string): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rawKeyBase64url },
    format: 'jwk',
  })
}

/**
 * Verify a consent token's Ed25519 signature and claims.
 *
 * Stateless -- no internal cache or trust state. Re-verifies fully
 * on every call per CSNT-02.
 */
export function verifyConsentToken(
  token: ConsentToken,
  publicKey: KeyObject,
): ConsentClaims {
  // 1. Verify Ed25519 signature
  const valid = verify(null, token.payload, publicKey, token.signature)
  if (!valid) {
    throw new ConsentError('INVALID_SIGNATURE', 'Ed25519 signature verification failed')
  }

  // 2. Parse claims from payload
  let claims: ConsentClaims
  try {
    claims = JSON.parse(token.payload.toString('utf-8')) as ConsentClaims
  } catch {
    throw new ConsentError('MALFORMED_TOKEN', 'Token payload is not valid JSON')
  }

  // 3. Check expiration (CSNT-03)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (claims.exp <= nowSeconds) {
    throw new ConsentError('CONSENT_EXPIRED', `Token expired at ${new Date(claims.exp * 1000).toISOString()}`)
  }

  return claims
}
```

### Pattern 2: RelationshipStore -- SQLite CRUD Following Phase 2 Pattern

**What:** A class that wraps `StorageEngine` for `RelationshipRecord` CRUD operations. Follows the exact same pattern as `RegistrationStateStore` from Phase 2.

**When to use:** Called by the handshake handler to create relationships, by the routing layer (Phase 4) to check relationship status, and by the termination handler to update status.

**Example:**
```typescript
// src/relationships/store.ts
import type { StorageEngine } from '../storage/interface.js'
import type { RelationshipRecord } from '../types/relationship.js'

interface RelationshipRow {
  relationship_id: string
  patient_agent_id: string
  provider_npi: string
  status: string
  consented_actions: string  // JSON array stored as TEXT
  patient_public_key: string // base64url Ed25519 public key
  created_at: string
  updated_at: string
}

export class RelationshipStore {
  constructor(private readonly storage: StorageEngine) {}

  create(record: RelationshipRecord): void {
    this.storage.run(
      `INSERT INTO relationships
        (relationship_id, patient_agent_id, provider_npi, status,
         consented_actions, patient_public_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.relationship_id,
        record.patient_agent_id,
        record.provider_npi,
        record.status,
        JSON.stringify(record.consented_actions),
        record.patient_public_key,
        record.created_at,
        record.updated_at,
      ],
    )
  }

  findById(relationshipId: string): RelationshipRecord | undefined {
    const row = this.storage.get<RelationshipRow>(
      'SELECT * FROM relationships WHERE relationship_id = ?',
      [relationshipId],
    )
    return row ? this.rowToRecord(row) : undefined
  }

  findByPatient(patientAgentId: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE patient_agent_id = ?',
      [patientAgentId],
    )
    return rows.map(this.rowToRecord)
  }

  findByProvider(providerNpi: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE provider_npi = ?',
      [providerNpi],
    )
    return rows.map(this.rowToRecord)
  }

  findByStatus(status: string): RelationshipRecord[] {
    const rows = this.storage.all<RelationshipRow>(
      'SELECT * FROM relationships WHERE status = ?',
      [status],
    )
    return rows.map(this.rowToRecord)
  }

  updateStatus(relationshipId: string, status: string): void {
    // Enforce: terminated is permanent (TERM-04)
    const current = this.findById(relationshipId)
    if (current?.status === 'terminated') {
      throw new Error('Cannot update status of a terminated relationship')
    }
    this.storage.run(
      'UPDATE relationships SET status = ?, updated_at = ? WHERE relationship_id = ?',
      [status, new Date().toISOString(), relationshipId],
    )
  }

  private rowToRecord(row: RelationshipRow): RelationshipRecord {
    return {
      relationship_id: row.relationship_id,
      patient_agent_id: row.patient_agent_id,
      provider_npi: row.provider_npi,
      status: row.status as RelationshipRecord['status'],
      consented_actions: JSON.parse(row.consented_actions),
      patient_public_key: row.patient_public_key,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }
}
```

### Pattern 3: Consent Handshake Protocol

**What:** A multi-step handshake that establishes a new care relationship. This is the Neuron's side of the Axon protocol handshake (PRD section 2.5.2).

**When to use:** When a patient CareAgent connects for the first time and no active relationship exists.

**Handshake sequence:**
```
Patient CareAgent                    Neuron
     |                                 |
     |--- 1. HANDSHAKE_INIT --------->|  (patient_agent_id, target_provider_npi)
     |                                 |
     |<-- 2. CHALLENGE ---------------|  (nonce: 32 random bytes, provider credentials)
     |                                 |
     |--- 3. CHALLENGE_RESPONSE ----->|  (signed_nonce, consent_token)
     |                                 |
     |    Neuron verifies:             |
     |    a) Ed25519 signature on nonce|
     |    b) Consent token signature   |
     |    c) Token not expired         |
     |    d) Provider NPI matches      |
     |                                 |
     |<-- 4. HANDSHAKE_COMPLETE ------|  (relationship_id, status: 'active')
     |                                 |
     |    RelationshipRecord created   |
     |    Audit event logged           |
```

**Example:**
```typescript
// src/relationships/handshake.ts
import { randomBytes } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { verifyConsentToken, importPublicKey, ConsentError } from '../consent/verifier.js'
import type { RelationshipStore } from './store.js'
import type { AuditLogger } from '../audit/logger.js'

export interface HandshakeInit {
  patient_agent_id: string
  provider_npi: string
  patient_public_key: string  // base64url Ed25519 public key
}

export interface HandshakeChallenge {
  nonce: string               // hex-encoded 32 random bytes
  provider_npi: string
  organization_npi: string
}

export interface ChallengeResponse {
  signed_nonce: string        // base64url Ed25519 signature of the nonce
  consent_token_payload: string  // base64url JSON claims
  consent_token_signature: string  // base64url Ed25519 signature
}

export class ConsentHandshakeHandler {
  /** In-flight challenges, keyed by nonce hex. TTL-based cleanup. */
  private pendingChallenges = new Map<string, {
    init: HandshakeInit
    expiresAt: number
  }>()

  constructor(
    private readonly store: RelationshipStore,
    private readonly organizationNpi: string,
    private readonly auditLogger?: AuditLogger,
  ) {}

  /** Step 1-2: Receive init, return challenge */
  startHandshake(init: HandshakeInit): HandshakeChallenge {
    const nonce = randomBytes(32).toString('hex')

    this.pendingChallenges.set(nonce, {
      init,
      expiresAt: Date.now() + 30_000,  // 30 second TTL
    })

    // Periodic cleanup of expired challenges
    this.cleanExpiredChallenges()

    return {
      nonce,
      provider_npi: init.provider_npi,
      organization_npi: this.organizationNpi,
    }
  }

  /** Step 3-4: Verify response, create relationship */
  completeHandshake(nonce: string, response: ChallengeResponse): string {
    const pending = this.pendingChallenges.get(nonce)
    if (!pending) {
      throw new ConsentError('MALFORMED_TOKEN', 'Unknown or expired challenge nonce')
    }
    if (Date.now() > pending.expiresAt) {
      this.pendingChallenges.delete(nonce)
      throw new ConsentError('CONSENT_EXPIRED', 'Challenge nonce has expired')
    }

    this.pendingChallenges.delete(nonce)
    const { init } = pending

    // Import patient public key
    const publicKey = importPublicKey(init.patient_public_key)

    // Verify consent token
    const token = {
      payload: Buffer.from(response.consent_token_payload, 'base64url'),
      signature: Buffer.from(response.consent_token_signature, 'base64url'),
    }
    const claims = verifyConsentToken(token, publicKey)

    // Validate claims match the handshake
    if (claims.provider_npi !== init.provider_npi) {
      throw new ConsentError('MALFORMED_TOKEN', 'Provider NPI in token does not match handshake')
    }

    // Create relationship record
    const relationshipId = randomUUID()
    const now = new Date().toISOString()

    this.store.create({
      relationship_id: relationshipId,
      patient_agent_id: init.patient_agent_id,
      provider_npi: init.provider_npi,
      status: 'active',
      consented_actions: claims.consented_actions,
      patient_public_key: init.patient_public_key,
      created_at: now,
      updated_at: now,
    })

    // Audit log
    this.auditLogger?.append({
      category: 'consent',
      action: 'consent.relationship_established',
      actor: init.patient_agent_id,
      details: {
        relationship_id: relationshipId,
        provider_npi: init.provider_npi,
        consented_actions: claims.consented_actions,
      },
    })

    return relationshipId
  }

  private cleanExpiredChallenges(): void {
    const now = Date.now()
    for (const [nonce, challenge] of this.pendingChallenges) {
      if (now > challenge.expiresAt) {
        this.pendingChallenges.delete(nonce)
      }
    }
  }
}
```

### Pattern 4: Termination Handler with Transactional Safety

**What:** Terminates a relationship in a single SQLite transaction: updates `RelationshipRecord.status` to `terminated`, creates a `TerminationRecord`, and links to the audit log entry.

**When to use:** Provider CareAgent initiates termination through the Neuron.

**Example:**
```typescript
// src/relationships/termination.ts
import { randomUUID } from 'node:crypto'
import type { StorageEngine } from '../storage/interface.js'
import type { RelationshipStore } from './store.js'
import type { AuditLogger } from '../audit/logger.js'

export class TerminationHandler {
  constructor(
    private readonly storage: StorageEngine,
    private readonly relationshipStore: RelationshipStore,
    private readonly auditLogger?: AuditLogger,
  ) {}

  terminate(relationshipId: string, providerNpi: string, reason: string): void {
    this.storage.transaction(() => {
      // 1. Load and validate relationship
      const relationship = this.relationshipStore.findById(relationshipId)
      if (!relationship) {
        throw new Error(`Relationship ${relationshipId} not found`)
      }
      if (relationship.status === 'terminated') {
        throw new Error(`Relationship ${relationshipId} is already terminated`)
      }
      if (relationship.provider_npi !== providerNpi) {
        throw new Error('Provider NPI does not match relationship')
      }

      // 2. Log audit event first (to get sequence number for linkage)
      const auditEntry = this.auditLogger?.append({
        category: 'termination',
        action: 'termination.relationship_terminated',
        actor: providerNpi,
        details: {
          relationship_id: relationshipId,
          reason,
        },
      })

      // 3. Update relationship status
      this.storage.run(
        'UPDATE relationships SET status = ?, updated_at = ? WHERE relationship_id = ?',
        ['terminated', new Date().toISOString(), relationshipId],
      )

      // 4. Create termination record with audit linkage
      const terminationId = randomUUID()
      this.storage.run(
        `INSERT INTO termination_records
          (termination_id, relationship_id, provider_npi, reason, terminated_at, audit_entry_sequence)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          terminationId,
          relationshipId,
          providerNpi,
          reason,
          new Date().toISOString(),
          auditEntry?.sequence ?? null,
        ],
      )
    })
  }
}
```

### Pattern 5: Consent Token Wire Format

**What:** The consent token is a two-part structure: a JSON payload (the claims) and an Ed25519 signature over the raw payload bytes. The payload is transmitted as base64url-encoded JSON; the signature is transmitted as base64url-encoded raw bytes (64 bytes for Ed25519).

**Why not JWT:** JWTs add the JOSE header overhead (`{ "alg": "EdDSA", "typ": "JWT" }`), require base64url encoding of both header and payload with dot-separated concatenation, and typically need a JOSE library for standards-compliant parsing. Since the consent token is internal to the CareAgent ecosystem (not a public OAuth flow), a simpler format reduces implementation surface and attack surface.

**Token payload structure:**
```typescript
interface ConsentTokenPayload {
  /** Patient's opaque agent identifier */
  patient_agent_id: string
  /** Target provider NPI */
  provider_npi: string
  /** Actions the patient consents to (opaque to Neuron) */
  consented_actions: string[]
  /** Issued-at Unix timestamp (seconds) */
  iat: number
  /** Expiration Unix timestamp (seconds) */
  exp: number
  /** Optional nonce for replay prevention */
  nonce?: string
}
```

**Signing (done by patient-core, shown for context):**
```typescript
const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
const signature = crypto.sign(null, payload, patientPrivateKey)
// Transmit: { payload: payload.toString('base64url'), signature: signature.toString('base64url') }
```

**Verification (done by Neuron):**
```typescript
const payloadBuf = Buffer.from(tokenPayload, 'base64url')
const signatureBuf = Buffer.from(tokenSignature, 'base64url')
const valid = crypto.verify(null, payloadBuf, patientPublicKey, signatureBuf)
```

### Anti-Patterns to Avoid

- **Caching consent verification results:** CSNT-02 explicitly requires stateless re-verification on every connection. Never cache a "this token was valid" result -- always re-verify. Token expiration could have passed between cache time and use time.
- **Allowing status transitions from `terminated`:** The `updateStatus` method on `RelationshipStore` must throw if the current status is `terminated`. Never rely on the caller to check this -- enforce it in the store layer.
- **Storing raw private keys in the Neuron:** The Neuron only stores public keys (for verification). Private keys belong to the patient CareAgent. Never request, store, or log private key material.
- **Using `JSON.stringify` output directly as the signed payload without canonicalization:** JSON serialization is not guaranteed to be deterministic across platforms. The signing side (patient-core) and verification side (Neuron) must agree on the exact bytes. Solution: the patient signs the exact bytes of their JSON serialization, and those exact bytes are transmitted alongside the signature. The Neuron verifies those bytes, not a re-serialized version.
- **Skipping nonce TTL cleanup:** The in-memory `pendingChallenges` map in the handshake handler will leak memory if challenges expire but are never cleaned up. Clean expired entries on every new challenge or on a periodic timer.
- **Performing termination without a transaction:** The relationship status update and termination record creation must happen atomically. If the process crashes between the two operations, the data would be inconsistent. Always use `storage.transaction()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ed25519 key generation for tests | Custom key generation | `crypto.generateKeyPairSync('ed25519')` | Built-in, well-tested, deterministic |
| UUID generation | Custom UUID function | `crypto.randomUUID()` | Built-in Node.js 19+; already used in project |
| Challenge nonce generation | Custom random string | `crypto.randomBytes(32)` | Cryptographically secure; 256 bits of entropy |
| JSON canonicalization | Custom sorting/normalization | Sign the exact payload bytes, transmit alongside signature | Avoids needing a canonical JSON library entirely |
| Relationship query pagination | Custom LIMIT/OFFSET logic | SQLite `LIMIT ? OFFSET ?` with parameterized queries | SQLite handles this natively and efficiently |
| Audit log event creation | Custom audit entry construction | Existing `AuditLogger.append()` with `category: 'consent'` / `category: 'termination'` | Phase 1 already built the audit logger |
| NPI validation for provider in termination | New validator | `isValidNpi()` from `src/validators/npi.ts` | Already built in Phase 1 |

**Key insight:** Phase 3 adds significant domain logic but zero new infrastructure. Everything hooks into existing foundations: SQLite tables (migration v1), TypeBox schemas, `StorageEngine` interface, `AuditLogger`, and `node:crypto` built-in.

---

## Common Pitfalls

### Pitfall 1: Ed25519 Algorithm Parameter Must Be `null`

**What goes wrong:** Passing `'sha256'` or `'ed25519'` as the algorithm parameter to `crypto.verify()` causes it to fail or produce incorrect results.
**Why it happens:** Ed25519 uses SHA-512 internally and does not accept an external algorithm parameter. The Node.js API requires `null` as the first argument.
**How to avoid:** Always call `crypto.verify(null, data, key, signature)` and `crypto.sign(null, data, key)` for Ed25519.
**Warning signs:** "Error: not EdDSA" or silent verification failures.

### Pitfall 2: Public Key Format Mismatch

**What goes wrong:** Patient-core sends the public key in one format (e.g., raw hex), but the Neuron tries to import it as another format (e.g., PEM).
**Why it happens:** Ed25519 public keys are 32 bytes raw, 44 bytes DER, or variable-length in PEM/JWK. The format must be agreed upon.
**How to avoid:** Standardize on base64url-encoded raw 32-byte keys for wire format, imported via JWK: `{ kty: 'OKP', crv: 'Ed25519', x: base64urlRawKey }`. Verified working on Node.js 22.22.0.
**Warning signs:** `ERR_CRYPTO_INVALID_KEYTYPE` or incorrect key length errors.

### Pitfall 3: Payload Byte Mismatch Between Signing and Verification

**What goes wrong:** Signature verification fails even though the key and signature are correct.
**Why it happens:** The patient-core signs `Buffer.from(JSON.stringify(claims))` but the Neuron re-serializes the claims before verification. Different JSON serialization order produces different bytes.
**How to avoid:** Transmit the exact signed payload bytes alongside the signature. The Neuron verifies those exact bytes, then parses the JSON from them. Never re-serialize before verification.
**Warning signs:** Signatures that verify in patient-core but fail in Neuron; intermittent failures depending on JSON key ordering.

### Pitfall 4: Race Between Consent Handshake and Termination

**What goes wrong:** A handshake completes just as a termination is being processed for the same patient-provider pair (e.g., re-establishing after termination).
**Why it happens:** Handshake and termination are separate code paths. Without coordination, a new relationship could be created for a terminated pair.
**How to avoid:** In the handshake handler, after verifying the consent token and before creating the relationship, check if a terminated relationship exists for this patient-provider pair. If it does, the handshake creates a new relationship with a new `relationship_id` (TERM-04 says terminated cannot be reactivated, but a fresh handshake creates a new relationship).
**Warning signs:** Duplicate relationships for the same patient-provider pair where one is terminated.

### Pitfall 5: Expired Challenge Nonces Not Cleaned Up

**What goes wrong:** The `pendingChallenges` map in the handshake handler grows unboundedly.
**Why it happens:** Patients start handshakes but never complete them (abandon, network error, malicious probing).
**How to avoid:** (1) Set a short TTL (30 seconds) on challenge nonces. (2) Clean expired entries on every `startHandshake` call. (3) Set a hard cap on pending challenges (e.g., 1000) and reject new handshakes if at capacity.
**Warning signs:** Increasing memory usage on the Neuron process over time.

### Pitfall 6: Termination Record Without Matching Relationship Update

**What goes wrong:** A `TerminationRecord` is created but the `RelationshipRecord.status` is not updated to `terminated`.
**Why it happens:** The two writes are not in a transaction. Process crashes after the first write.
**How to avoid:** Wrap both operations in `storage.transaction()`. If either fails, both are rolled back.
**Warning signs:** `termination_records` has entries for relationships that are still `active` in the `relationships` table.

### Pitfall 7: consented_actions Stored as String Instead of JSON Array

**What goes wrong:** SQLite stores `consented_actions` as TEXT. If you store the array directly, it becomes `"action1,action2"` instead of `'["action1","action2"]'`.
**Why it happens:** Forgetting to `JSON.stringify()` before insert and `JSON.parse()` on read.
**How to avoid:** Always serialize arrays with `JSON.stringify()` before SQLite insert and `JSON.parse()` on read. The existing migration v1 stores `consented_actions` as `TEXT`.
**Warning signs:** `JSON.parse()` errors when reading relationship records.

---

## Code Examples

### Ed25519 Key Generation for Tests

```typescript
// test helper -- generate a patient key pair for testing consent tokens
import { generateKeyPairSync, sign, createPublicKey } from 'node:crypto'

export function generateTestPatientKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  // Export raw public key as base64url for wire format
  const jwk = publicKey.export({ format: 'jwk' })
  const publicKeyBase64url = jwk.x! // base64url-encoded 32-byte raw key

  return { publicKey, privateKey, publicKeyBase64url }
}

export function signConsentToken(
  claims: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
): { payload: string; signature: string } {
  const payloadBytes = Buffer.from(JSON.stringify(claims), 'utf-8')
  const signatureBytes = sign(null, payloadBytes, privateKey)
  return {
    payload: payloadBytes.toString('base64url'),
    signature: signatureBytes.toString('base64url'),
  }
}
```

### SQLite Migration v3: Add patient_public_key Column

```typescript
// Addition to src/storage/migrations.ts
{
  version: 3,
  description: 'Add patient_public_key to relationships table',
  up: `
    ALTER TABLE relationships ADD COLUMN patient_public_key TEXT NOT NULL DEFAULT '';
  `,
}
```

**Note:** The `DEFAULT ''` is required because SQLite `ALTER TABLE ADD COLUMN` requires a default for existing rows. For a fresh database, the constraint is enforced at the application layer (the store always provides a value). This is safe because migration v1 created the table and no relationship records exist yet (Phase 3 is the first phase that creates them).

### Relationship Query with Compound Filters

```typescript
// Example compound query: active relationships for a specific provider
findActiveByProvider(providerNpi: string): RelationshipRecord[] {
  const rows = this.storage.all<RelationshipRow>(
    'SELECT * FROM relationships WHERE provider_npi = ? AND status = ?',
    [providerNpi, 'active'],
  )
  return rows.map(this.rowToRecord)
}
```

### Consent Token Verification Test

```typescript
// src/consent/consent.test.ts
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyConsentToken, importPublicKey, ConsentError } from './verifier.js'

describe('ConsentVerifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  const keyObject = importPublicKey(jwk.x!)

  function makeToken(claims: Record<string, unknown>) {
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    const signature = sign(null, payload, privateKey)
    return { payload, signature }
  }

  it('verifies a valid consent token', () => {
    const token = makeToken({
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      consented_actions: ['office_visit'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const claims = verifyConsentToken(token, keyObject)
    expect(claims.patient_agent_id).toBe('patient-001')
    expect(claims.consented_actions).toEqual(['office_visit'])
  })

  it('rejects expired token with CONSENT_EXPIRED', () => {
    const token = makeToken({
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      consented_actions: [],
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,  // expired 1 hour ago
    })

    expect(() => verifyConsentToken(token, keyObject))
      .toThrow(ConsentError)
    try {
      verifyConsentToken(token, keyObject)
    } catch (err) {
      expect((err as ConsentError).code).toBe('CONSENT_EXPIRED')
    }
  })

  it('rejects tampered signature with INVALID_SIGNATURE', () => {
    const token = makeToken({
      patient_agent_id: 'patient-001',
      provider_npi: '1234567893',
      consented_actions: [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    // Tamper with signature
    const tampered = Buffer.from(token.signature)
    tampered[0] ^= 0xff

    expect(() => verifyConsentToken({ payload: token.payload, signature: tampered }, keyObject))
      .toThrow(ConsentError)
  })
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@noble/ed25519` npm package for Ed25519 | `node:crypto` built-in Ed25519 | Node 16+ (stable) | No dependency needed |
| Manual DER prefix construction for key import | JWK format import via `createPublicKey({ format: 'jwk' })` | Node 16+ | Cleaner, self-describing key format |
| `jsonwebtoken` npm for JWT | `jose` npm (universal, no deps) or raw `crypto.sign/verify` | 2023+ | `jose` is the modern standard if JWT is needed; raw `crypto` is sufficient for non-JWT tokens |
| Separate `crypto.createVerify` stream API | `crypto.verify()` one-shot function | Node 12+ | Simpler API; one function call instead of stream setup |

**Deprecated/outdated:**
- `crypto.createVerify().update(data).verify(key, sig)`: The stream-based API still works but the one-shot `crypto.verify(null, data, key, sig)` is cleaner for Ed25519.
- `@noble/ed25519`: Excellent library, but unnecessary when Node.js built-in `crypto` supports Ed25519 natively. Only needed for environments without OpenSSL (browsers, Cloudflare Workers).
- DER prefix approach for key import: The JWK import path (`{ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: ... } }`) is cleaner and avoids hardcoding the 12-byte `302a300506032b6570032100` prefix.

---

## Open Questions

1. **Consent token wire format is not finalized in the Axon protocol spec**
   - What we know: PRD says Ed25519 signature, includes patient ID, provider NPI, consented actions, expiration. The Axon PRD is "Draft -- Pending Review."
   - What's unclear: Exact encoding (JWT vs custom JSON), transport encoding (base64url vs hex), JOSE header presence.
   - Recommendation: Use the custom JSON + base64url format described in this research. If Axon later mandates JWT/JOSE, the `ConsentVerifier` is the only module that changes. The `verifyConsentToken` function is the single verification entry point -- all callers go through it.

2. **Patient public key delivery mechanism**
   - What we know: PRD says "received during the initial handshake or stored from previous relationship establishment." The public key needs to be in the handshake init message.
   - What's unclear: Does the patient public key come from Axon (pre-registered) or from the patient CareAgent directly during the handshake?
   - Recommendation: For v1, the patient CareAgent sends their public key in the handshake init message. The Neuron stores it in `RelationshipRecord.patient_public_key` for subsequent re-verification. Trust is established through the challenge-response (patient proves they control the private key by signing the nonce). Axon-mediated key distribution is a v2 enhancement.

3. **Challenge-response vs consent-token-only authentication**
   - What we know: RELN-04 requires "challenge-response generation for identity verification." The PRD describes both a challenge-response flow and consent token verification.
   - What's unclear: Is the challenge-response separate from the consent token, or does signing the consent token itself serve as the challenge response?
   - Recommendation: The handshake uses both: (1) a challenge nonce signed by the patient to prove they hold the private key matching the public key, and (2) a consent token with a separate signature over the consent claims. The challenge-response proves identity; the consent token proves consent. They are separate concerns even though both use Ed25519.

4. **RelationshipRecord schema needs `patient_public_key` field**
   - What we know: The existing `RelationshipRecordSchema` in `src/types/relationship.ts` does not include `patient_public_key`. The PRD's data model (section 2.5.3) includes it.
   - What's unclear: Whether the existing schema was intentionally minimal or an oversight.
   - Recommendation: Add `patient_public_key: Type.String()` to the TypeBox schema and add the column via SQLite migration v3. This is required for CSNT-02 (re-verification on every connection needs the stored public key).

5. **IPC integration for termination (CLI command)**
   - What we know: Phase 2 established the IPC pattern for provider management. Termination might need a similar CLI path for providers to initiate termination.
   - What's unclear: Whether termination is initiated via CLI, WebSocket message from provider CareAgent, or both.
   - Recommendation: For Phase 3, implement termination as a programmatic API (handler callable from either IPC or WebSocket). Defer the CLI command to Phase 4 (when WebSocket is available) or add a simple IPC command (`relationship.terminate`) following the Phase 2 pattern. The IPC command can be added as an extension to `IpcCommandSchema`.

---

## Sources

### Primary (HIGH confidence)
- **Node.js v22 `crypto` module** (nodejs.org/api/crypto.html) -- Ed25519 `sign`, `verify`, `generateKeyPairSync`, `createPublicKey` with JWK import. Verified via live execution on Node.js 22.22.0.
- **Project codebase** -- Phase 1 and Phase 2 artifacts: `StorageEngine`, `SqliteStorage`, `AuditLogger`, migration v1 (relationships and termination_records tables), `RegistrationStateStore` (pattern reference), TypeBox schemas
- **PRD.md** -- Sections 2.4 (Consent Verification), 2.5 (Relationship Registration), 2.9 (Relationship Termination) -- definitive requirements and data models

### Secondary (MEDIUM confidence)
- **Keygen blog** (keygen.sh/blog/how-to-use-hexadecimal-ed25519-keys-in-node/) -- DER prefix approach for Ed25519 public key import. Verified that JWK approach is simpler.
- **Wikipedia: Challenge-response authentication** -- Standard nonce-based challenge-response protocol pattern
- **jose npm package** (npmjs.com/package/jose) -- v6.1.0 supports EdDSA/Ed25519 for JWTs. Evaluated and rejected for Phase 3 (overkill for internal tokens).

### Tertiary (LOW confidence)
- **Axon protocol specification** -- Consent handshake sequence inferred from PRD section 2.5.2. Actual Axon protocol not yet built. The handshake handler is the only module that would change if the protocol evolves.
- **State protocol compliance** (TERM-01) -- PRD says "v1: state protocol data is provider-attested; external validation is v2." The termination handler stores a reason string but does not validate against actual state regulations.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All tooling is Node.js built-in `crypto` or already installed in the project
- Architecture: HIGH -- Patterns follow Phase 2 conventions exactly (store classes, typed errors, audit integration)
- Consent token format: MEDIUM -- Format is a design decision (Axon protocol not finalized); recommendation is well-justified but subject to change when Axon ships
- Termination logic: HIGH -- Simple state machine with transactional guarantees
- Pitfalls: HIGH -- Based on verified Ed25519 behavior on Node.js 22 and well-known crypto verification patterns

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days; crypto APIs are stable, but Axon protocol spec is a moving target)
