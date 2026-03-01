/**
 * Comprehensive tests for InjectaVox clinical data ingestion.
 *
 * Covers:
 * - Valid ingestion (POST /v1/injectavox/ingest)
 * - Schema validation failures
 * - Auth failures
 * - Rate limiting (InjectaVox-specific)
 * - Data retrieval (GET /v1/injectavox/visits/:provider_npi)
 * - Duplicate visit_id rejection
 * - Audit logging
 * - Provider notification events
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { SqliteStorage } from '../storage/sqlite.js'
import { ApiKeyStore } from './keys.js'
import { TokenBucketRateLimiter } from './rate-limiter.js'
import { RelationshipStore } from '../relationships/store.js'
import { InjectaVoxStore } from './injectavox-store.js'
import { InjectaVoxEventEmitter } from './injectavox-events.js'
import { createApiRouter, type ApiRouterDeps } from './router.js'
import type { NeuronConfig } from '../types/config.js'

const testConfig: NeuronConfig = {
  organization: {
    npi: '1234567890',
    name: 'Test Clinic',
    type: 'clinic',
  },
  server: { port: 0, host: '0.0.0.0' },
  websocket: {
    path: '/ws/handshake',
    maxConcurrentHandshakes: 10,
    authTimeoutMs: 10000,
    queueTimeoutMs: 30000,
    maxPayloadBytes: 65536,
  },
  storage: { path: ':memory:' },
  audit: { path: './data/audit.jsonl', enabled: false },
  localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
  heartbeat: { intervalMs: 60000 },
  axon: { registryUrl: 'http://localhost:9999', endpointUrl: 'http://localhost:3000', backoffCeilingMs: 300000 },
  api: {
    rateLimit: { maxRequests: 1000, windowMs: 60000 },
    cors: { allowedOrigins: ['*'] },
  },
}

const mockRegistrationService = {
  getStatus() {
    return {
      neuron: {
        organization_npi: '1234567890',
        organization_name: 'Test Clinic',
        organization_type: 'clinic',
        axon_registry_url: 'http://localhost:9999',
        neuron_endpoint_url: 'http://localhost:3000',
        registration_id: 'reg-001',
        status: 'registered' as const,
        first_registered_at: '2026-01-01T00:00:00.000Z',
        providers: [],
      },
      heartbeat: 'healthy' as const,
    }
  },
  listProviders() { return [] },
} as unknown as ApiRouterDeps['registrationService']

const mockProtocolServer = {
  activeSessions() { return [] },
} as unknown as ApiRouterDeps['protocolServer']

/** Create a valid InjectaVox payload */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    visit_id: randomUUID(),
    provider_npi: '1234567890',
    patient_id: 'patient-001',
    visit_type: 'in_person',
    visit_date: '2026-02-28T10:00:00.000Z',
    chief_complaint: 'Persistent headache for 2 weeks',
    clinical_notes: 'Patient reports daily tension headaches. No visual disturbances.',
    vitals: {
      blood_pressure: '120/80',
      heart_rate: 72,
      temperature: 98.6,
      weight: 170,
      height: 68,
    },
    assessment: 'Tension-type headache, episodic',
    plan: 'OTC ibuprofen 400mg PRN, follow up in 2 weeks if no improvement',
    medications: [
      { name: 'Ibuprofen', dosage: '400mg', frequency: 'PRN', route: 'oral' },
    ],
    follow_up: {
      date: '2026-03-14T10:00:00.000Z',
      instructions: 'Return if headaches persist or worsen',
    },
    ...overrides,
  }
}

describe('InjectaVox Ingestion API', () => {
  let server: Server
  let baseUrl: string
  let storage: SqliteStorage
  let apiKeyStore: ApiKeyStore
  let validApiKey: string
  let injectaVoxStore: InjectaVoxStore
  let injectaVoxEvents: InjectaVoxEventEmitter
  const mockAuditLogger = { append: vi.fn() }

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()

    apiKeyStore = new ApiKeyStore(storage)
    const rateLimiter = new TokenBucketRateLimiter(1000, 1000, 60000)
    const relationshipStore = new RelationshipStore(storage)
    injectaVoxStore = new InjectaVoxStore(storage)
    injectaVoxEvents = new InjectaVoxEventEmitter()

    const created = apiKeyStore.create('injectavox-key')
    validApiKey = created.raw

    const deps: ApiRouterDeps = {
      config: testConfig,
      storage,
      apiKeyStore,
      rateLimiter,
      relationshipStore,
      registrationService: mockRegistrationService,
      protocolServer: mockProtocolServer,
      auditLogger: mockAuditLogger as unknown as ApiRouterDeps['auditLogger'],
      injectaVoxStore,
      injectaVoxEvents,
    }
    const handler = createApiRouter(deps)

    server = createServer(handler)
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`
        }
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    storage.close()
  })

  describe('POST /v1/injectavox/ingest', () => {
    it('should ingest a valid visit payload', async () => {
      const payload = validPayload()
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.visit_id).toBe(payload.visit_id)
      expect(body.provider_npi).toBe('1234567890')
      expect(body.patient_id).toBe('patient-001')
      expect(body.status).toBe('ingested')
      expect(body.ingested_at).toBeTruthy()
    })

    it('should ingest a minimal valid payload (no optional fields)', async () => {
      const payload = {
        visit_id: randomUUID(),
        provider_npi: '1234567890',
        patient_id: 'patient-002',
        visit_type: 'telehealth',
        visit_date: '2026-02-28T14:00:00.000Z',
        chief_complaint: 'Follow up on lab results',
        clinical_notes: 'Labs within normal range.',
        assessment: 'Normal lab values',
        plan: 'Continue current medications',
      }
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.visit_id).toBe(payload.visit_id)
      expect(body.status).toBe('ingested')
    })

    it('should reject duplicate visit_id', async () => {
      const visitId = randomUUID()
      const payload = validPayload({ visit_id: visitId })

      // First ingestion
      await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      // Duplicate
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toBe('Visit already ingested')
      expect(body.visit_id).toBe(visitId)
    })

    it('should return 400 for invalid JSON', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: 'not json',
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid JSON body')
    })

    it('should return 400 with details for missing required fields', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visit_id: randomUUID() }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Validation failed')
      expect(Array.isArray(body.details)).toBe(true)
      expect(body.details.length).toBeGreaterThan(0)
    })

    it('should return 400 for invalid visit_type enum', async () => {
      const payload = validPayload({ visit_type: 'house_call' })
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Validation failed')
    })

    it('should return 400 for invalid provider_npi format', async () => {
      const payload = validPayload({ provider_npi: 'not-an-npi' })
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Validation failed')
    })

    it('should return 400 for invalid medication entry', async () => {
      const payload = validPayload({
        medications: [{ name: 'Aspirin' }], // missing dosage, frequency, route
      })
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Validation failed')
    })

    it('should return 401 without API key', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload()),
      })
      expect(res.status).toBe(401)
    })

    it('should return 401 with invalid API key', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'nrn_invalid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validPayload()),
      })
      expect(res.status).toBe(401)
    })

    it('should emit audit log for ingestion', async () => {
      mockAuditLogger.append.mockClear()
      const payload = validPayload()

      await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      // Should have api_access audit + ingestion audit
      const ingestionCall = mockAuditLogger.append.mock.calls.find(
        (call: unknown[]) => (call[0] as { category: string }).category === 'ingestion',
      )
      expect(ingestionCall).toBeDefined()
      expect(ingestionCall![0]).toEqual(
        expect.objectContaining({
          category: 'ingestion',
          action: 'visit_ingested',
          details: expect.objectContaining({
            visit_id: payload.visit_id,
            provider_npi: '1234567890',
            patient_id: 'patient-001',
          }),
        }),
      )
    })

    it('should emit visit_ingested event', async () => {
      const eventSpy = vi.fn()
      injectaVoxEvents.onVisitIngested(eventSpy)

      const payload = validPayload()
      await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          visit_id: payload.visit_id,
          provider_npi: '1234567890',
          patient_id: 'patient-001',
          visit_type: 'in_person',
        }),
      )

      injectaVoxEvents.removeAllListeners('visit_ingested')
    })
  })

  describe('GET /v1/injectavox/visits/:provider_npi', () => {
    let seededNpi: string

    beforeAll(async () => {
      // Seed some visits for a known NPI
      seededNpi = '9999999999'
      for (let i = 0; i < 3; i++) {
        const payload = validPayload({
          visit_id: randomUUID(),
          provider_npi: seededNpi,
          patient_id: `patient-seed-${i}`,
        })
        await fetch(`${baseUrl}/v1/injectavox/ingest`, {
          method: 'POST',
          headers: {
            'X-API-Key': validApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
      }
    })

    it('should return unprocessed visits for a provider', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/${seededNpi}`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(3)
      expect(body.data).toHaveLength(3)
      expect(body.limit).toBe(50)
      expect(body.offset).toBe(0)

      // Verify each visit has expected fields
      for (const visit of body.data) {
        expect(visit.visit_id).toBeTruthy()
        expect(visit.provider_npi).toBe(seededNpi)
        expect(visit.patient_id).toBeTruthy()
        expect(visit.visit_type).toBe('in_person')
        expect(visit.chief_complaint).toBeTruthy()
        expect(visit.clinical_notes).toBeTruthy()
        expect(visit.assessment).toBeTruthy()
        expect(visit.plan).toBeTruthy()
        expect(visit.ingested_at).toBeTruthy()
      }
    })

    it('should return deserialized vitals and medications', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/${seededNpi}`, {
        headers: { 'X-API-Key': validApiKey },
      })
      const body = await res.json()
      const visit = body.data[0]
      expect(visit.vitals).toEqual({
        blood_pressure: '120/80',
        heart_rate: 72,
        temperature: 98.6,
        weight: 170,
        height: 68,
      })
      expect(visit.medications).toEqual([
        { name: 'Ibuprofen', dosage: '400mg', frequency: 'PRN', route: 'oral' },
      ])
      expect(visit.follow_up).toEqual({
        date: '2026-03-14T10:00:00.000Z',
        instructions: 'Return if headaches persist or worsen',
      })
    })

    it('should support pagination', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/${seededNpi}?limit=2&offset=0`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(2)
      expect(body.total).toBe(3)
      expect(body.limit).toBe(2)
      expect(body.offset).toBe(0)
    })

    it('should return empty list for provider with no visits', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/5555555555`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(0)
      expect(body.data).toHaveLength(0)
    })

    it('should return 400 for invalid NPI format', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/not-npi`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid provider NPI format')
    })

    it('should return 401 without API key', async () => {
      const res = await fetch(`${baseUrl}/v1/injectavox/visits/${seededNpi}`)
      expect(res.status).toBe(401)
    })
  })
})

describe('InjectaVox Rate Limiting', () => {
  let server: Server
  let baseUrl: string
  let storage: SqliteStorage
  let validApiKey: string

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()

    const apiKeyStore = new ApiKeyStore(storage)
    const rateLimiter = new TokenBucketRateLimiter(1000, 1000, 60000)
    const injectaVoxRateLimiter = new TokenBucketRateLimiter(2, 2, 60000) // tight limit
    const relationshipStore = new RelationshipStore(storage)
    const injectaVoxStore = new InjectaVoxStore(storage)
    const injectaVoxEvents = new InjectaVoxEventEmitter()

    const created = apiKeyStore.create('rate-limit-test-key')
    validApiKey = created.raw

    const deps: ApiRouterDeps = {
      config: testConfig,
      storage,
      apiKeyStore,
      rateLimiter,
      relationshipStore,
      registrationService: mockRegistrationService,
      protocolServer: mockProtocolServer,
      injectaVoxStore,
      injectaVoxEvents,
      injectaVoxRateLimiter,
    }
    const handler = createApiRouter(deps)

    server = createServer(handler)
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`
        }
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    storage.close()
  })

  it('should return 429 when InjectaVox rate limit is exceeded', async () => {
    // Exhaust the 2-token limit
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
        method: 'POST',
        headers: {
          'X-API-Key': validApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validPayload()),
      })
      expect(res.status).toBe(201)
    }

    // Third request should be rate limited
    const res = await fetch(`${baseUrl}/v1/injectavox/ingest`, {
      method: 'POST',
      headers: {
        'X-API-Key': validApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validPayload()),
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    const body = await res.json()
    expect(body.error).toBe('Ingestion rate limit exceeded')
  })
})

describe('InjectaVox Store', () => {
  let storage: SqliteStorage
  let store: InjectaVoxStore

  beforeAll(() => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()
    store = new InjectaVoxStore(storage)
  })

  afterAll(() => {
    storage.close()
  })

  it('should insert and retrieve a visit', () => {
    const visitId = randomUUID()
    const payload = {
      visit_id: visitId,
      provider_npi: '1234567890',
      patient_id: 'patient-store-1',
      visit_type: 'in_person' as const,
      visit_date: '2026-02-28T10:00:00.000Z',
      chief_complaint: 'Test complaint',
      clinical_notes: 'Test notes',
      assessment: 'Test assessment',
      plan: 'Test plan',
    }

    const row = store.insert(payload)
    expect(row.visit_id).toBe(visitId)
    expect(row.processed).toBe(0)
    expect(row.ingested_at).toBeTruthy()

    const fetched = store.getById(visitId)
    expect(fetched).toBeDefined()
    expect(fetched!.visit_id).toBe(visitId)
    expect(fetched!.processed).toBe(0)
  })

  it('should list unprocessed visits for a provider', () => {
    const npi = '1111111111'
    for (let i = 0; i < 3; i++) {
      store.insert({
        visit_id: randomUUID(),
        provider_npi: npi,
        patient_id: `patient-list-${i}`,
        visit_type: 'telehealth' as const,
        visit_date: '2026-02-28T10:00:00.000Z',
        chief_complaint: `Complaint ${i}`,
        clinical_notes: `Notes ${i}`,
        assessment: `Assessment ${i}`,
        plan: `Plan ${i}`,
      })
    }

    const visits = store.listUnprocessed(npi)
    expect(visits).toHaveLength(3)
    const count = store.countUnprocessed(npi)
    expect(count).toBe(3)
  })

  it('should mark a visit as processed', () => {
    const visitId = randomUUID()
    store.insert({
      visit_id: visitId,
      provider_npi: '2222222222',
      patient_id: 'patient-mark',
      visit_type: 'follow_up' as const,
      visit_date: '2026-02-28T10:00:00.000Z',
      chief_complaint: 'Follow up',
      clinical_notes: 'Notes',
      assessment: 'Assessment',
      plan: 'Plan',
    })

    expect(store.markProcessed(visitId)).toBe(true)

    const fetched = store.getById(visitId)
    expect(fetched!.processed).toBe(1)

    // Should not appear in unprocessed list
    const unprocessed = store.listUnprocessed('2222222222')
    expect(unprocessed.find((v) => v.visit_id === visitId)).toBeUndefined()
  })

  it('should return false when marking non-existent visit as processed', () => {
    expect(store.markProcessed('nonexistent')).toBe(false)
  })

  it('should serialize vitals and medications as JSON', () => {
    const visitId = randomUUID()
    store.insert({
      visit_id: visitId,
      provider_npi: '3333333333',
      patient_id: 'patient-json',
      visit_type: 'in_person' as const,
      visit_date: '2026-02-28T10:00:00.000Z',
      chief_complaint: 'Test',
      clinical_notes: 'Notes',
      vitals: { blood_pressure: '130/85', heart_rate: 80 },
      assessment: 'Assessment',
      plan: 'Plan',
      medications: [{ name: 'Aspirin', dosage: '81mg', frequency: 'daily', route: 'oral' }],
      follow_up: { date: '2026-03-15T00:00:00.000Z', instructions: 'Come back' },
    })

    const fetched = store.getById(visitId)
    expect(fetched!.vitals).toBe(JSON.stringify({ blood_pressure: '130/85', heart_rate: 80 }))
    expect(fetched!.medications).toBe(JSON.stringify([{ name: 'Aspirin', dosage: '81mg', frequency: 'daily', route: 'oral' }]))
    expect(fetched!.follow_up).toBe(JSON.stringify({ date: '2026-03-15T00:00:00.000Z', instructions: 'Come back' }))
  })
})

describe('InjectaVox Event Emitter', () => {
  it('should emit and receive visit_ingested events', () => {
    const emitter = new InjectaVoxEventEmitter()
    const handler = vi.fn()
    emitter.onVisitIngested(handler)

    const event = {
      visit_id: randomUUID(),
      provider_npi: '1234567890',
      patient_id: 'patient-event',
      visit_type: 'in_person',
      ingested_at: new Date().toISOString(),
    }
    emitter.emitVisitIngested(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(event)
  })
})

describe('OpenAPI spec includes InjectaVox endpoints', () => {
  let server: Server
  let baseUrl: string
  let storage: SqliteStorage

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:')
    storage.initialize()

    const apiKeyStore = new ApiKeyStore(storage)
    const rateLimiter = new TokenBucketRateLimiter(100, 100, 60000)
    const relationshipStore = new RelationshipStore(storage)

    const deps: ApiRouterDeps = {
      config: testConfig,
      storage,
      apiKeyStore,
      rateLimiter,
      relationshipStore,
      registrationService: mockRegistrationService,
      protocolServer: mockProtocolServer,
    }
    const handler = createApiRouter(deps)

    server = createServer(handler)
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`
        }
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    storage.close()
  })

  it('should include InjectaVox paths in OpenAPI spec', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paths['/injectavox/ingest']).toBeDefined()
    expect(body.paths['/injectavox/ingest'].post).toBeDefined()
    expect(body.paths['/injectavox/visits/{provider_npi}']).toBeDefined()
    expect(body.paths['/injectavox/visits/{provider_npi}'].get).toBeDefined()
  })

  it('should include InjectaVox schemas', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    const body = await res.json()
    expect(body.components.schemas.InjectaVoxPayload).toBeDefined()
    expect(body.components.schemas.InjectaVoxIngestResult).toBeDefined()
    expect(body.components.schemas.InjectaVoxVisitList).toBeDefined()
  })
})
