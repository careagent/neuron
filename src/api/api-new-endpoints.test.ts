import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { SqliteStorage } from '../storage/sqlite.js'
import { ApiKeyStore } from './keys.js'
import { TokenBucketRateLimiter } from './rate-limiter.js'
import { RelationshipStore } from '../relationships/store.js'
import { ConsentRelationshipStore } from '../consent/relationship-store.js'
import { createApiRouter, type ApiRouterDeps } from './router.js'
import type { NeuronConfig } from '../types/config.js'

/**
 * Tests for new REST API endpoints:
 * - GET /health (unauthenticated)
 * - GET /v1/registrations (list registered entities)
 * - GET /v1/registrations/:id (get registration by NPI)
 * - GET /v1/consent/status/:relationship_id (consent status)
 * - POST /v1/registrations (register new entity)
 */

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
    rateLimit: { maxRequests: 100, windowMs: 60000 },
    cors: { allowedOrigins: ['*'] },
  },
}

/** Mock AxonRegistrationService */
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
        providers: [
          {
            provider_npi: '1111111111',
            axon_provider_id: 'prov-001',
            registration_status: 'registered' as const,
            first_registered_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      heartbeat: 'healthy' as const,
    }
  },
  listProviders() {
    return [
      {
        provider_npi: '1111111111',
        provider_name: 'Dr. Smith',
        provider_types: ['physician'],
        specialty: 'cardiology',
        axon_provider_id: 'prov-001',
        registration_status: 'registered' as const,
        first_registered_at: '2026-01-01T00:00:00.000Z',
      },
      {
        provider_npi: '2222222222',
        provider_name: 'Dr. Jones',
        provider_types: ['physician'],
        registration_status: 'registered' as const,
        first_registered_at: '2026-01-02T00:00:00.000Z',
      },
    ]
  },
  async addProvider(npi: string, name: string, types: string[], specialty?: string) {
    if (npi === '0000000000') {
      throw new Error('Cannot add provider: neuron not registered')
    }
    // Success case: no-op for mock
  },
} as unknown as ApiRouterDeps['registrationService']

const mockProtocolServer = {
  activeSessions() { return [] },
} as unknown as ApiRouterDeps['protocolServer']

let server: Server
let baseUrl: string
let storage: SqliteStorage
let apiKeyStore: ApiKeyStore
let validApiKey: string
let consentRelStore: ConsentRelationshipStore

beforeAll(async () => {
  storage = new SqliteStorage(':memory:')
  storage.initialize()

  apiKeyStore = new ApiKeyStore(storage)
  const rateLimiter = new TokenBucketRateLimiter(1000, 1000, 60000)
  const relationshipStore = new RelationshipStore(storage)
  consentRelStore = new ConsentRelationshipStore(storage)

  // Seed test relationships
  const now = new Date().toISOString()
  relationshipStore.create({
    relationship_id: 'rel-001',
    patient_agent_id: 'patient-1',
    provider_npi: '1111111111',
    status: 'active',
    consented_actions: ['read_vitals', 'read_labs'],
    patient_public_key: 'pk-test-1',
    created_at: now,
    updated_at: now,
  })

  // Seed consent relationship
  consentRelStore.create({
    patientPublicKey: 'pk-patient-1',
    providerPublicKey: 'pk-provider-1',
    scope: ['read_vitals'],
    consentToken: 'token-123',
    expiresAt: Date.now() + 3600000,
    id: 'consent-rel-001',
  })

  const created = apiKeyStore.create('test-key')
  validApiKey = created.raw

  const deps: ApiRouterDeps = {
    config: testConfig,
    storage,
    apiKeyStore,
    rateLimiter,
    relationshipStore,
    registrationService: mockRegistrationService,
    protocolServer: mockProtocolServer,
    consentRelationshipStore: consentRelStore,
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

describe('GET /health', () => {
  it('should return health status without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(typeof body.uptime_seconds).toBe('number')
  })

  it('should return Content-Type: application/json', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })
})

describe('GET /v1/registrations', () => {
  it('should return neuron and provider registrations', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.neuron).toBeDefined()
    expect(body.neuron.organization_npi).toBe('1234567890')
    expect(body.neuron.status).toBe('registered')
    expect(body.providers).toHaveLength(2)
    expect(body.total_providers).toBe(2)
    expect(body.providers[0].provider_npi).toBe('1111111111')
    expect(body.providers[0].provider_name).toBe('Dr. Smith')
  })

  it('should require authentication', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`)
    expect(res.status).toBe(401)
  })
})

describe('GET /v1/registrations/:id', () => {
  it('should return a specific provider registration by NPI', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations/1111111111`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider_npi).toBe('1111111111')
    expect(body.provider_name).toBe('Dr. Smith')
    expect(body.provider_types).toEqual(['physician'])
    expect(body.specialty).toBe('cardiology')
    expect(body.registration_status).toBe('registered')
  })

  it('should return 404 for unknown NPI', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations/9999999999`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Registration not found' })
  })

  it('should require authentication', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations/1111111111`)
    expect(res.status).toBe(401)
  })
})

describe('GET /v1/consent/status/:relationship_id', () => {
  it('should return consent status for a known relationship', async () => {
    const res = await fetch(`${baseUrl}/v1/consent/status/rel-001`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.relationship_id).toBe('rel-001')
    expect(body.status).toBe('active')
    expect(body.patient_agent_id).toBe('patient-1')
    expect(body.provider_npi).toBe('1111111111')
    expect(body.consented_actions).toEqual(['read_vitals', 'read_labs'])
  })

  it('should return consent status from consent relationship store', async () => {
    const res = await fetch(`${baseUrl}/v1/consent/status/consent-rel-001`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.relationship_id).toBe('consent-rel-001')
    expect(body.status).toBe('pending')
    expect(body.scope).toEqual(['read_vitals'])
  })

  it('should return 404 for unknown relationship', async () => {
    const res = await fetch(`${baseUrl}/v1/consent/status/nonexistent`, {
      headers: { 'X-API-Key': validApiKey },
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Relationship not found' })
  })

  it('should require authentication', async () => {
    const res = await fetch(`${baseUrl}/v1/consent/status/rel-001`)
    expect(res.status).toBe(401)
  })
})

describe('POST /v1/registrations', () => {
  it('should register a new provider with valid data', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: 'POST',
      headers: {
        'X-API-Key': validApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_npi: '3333333333',
        provider_name: 'Dr. New',
        provider_types: ['physician'],
        specialty: 'pediatrics',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.provider_npi).toBe('3333333333')
    expect(body.provider_name).toBe('Dr. New')
    expect(body.registration_status).toBe('registered')
  })

  it('should return 400 for invalid JSON body', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
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

  it('should return 400 for missing required fields', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: 'POST',
      headers: {
        'X-API-Key': validApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_npi: '3333333333',
        // missing provider_name and provider_types
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
    expect(body.details).toBeDefined()
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('should return 400 for invalid NPI format', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: 'POST',
      headers: {
        'X-API-Key': validApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_npi: 'abc',
        provider_name: 'Dr. Bad',
        provider_types: ['physician'],
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('should return 500 when registration service fails', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: 'POST',
      headers: {
        'X-API-Key': validApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_npi: '0000000000',
        provider_name: 'Dr. Fail',
        provider_types: ['physician'],
      }),
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('not registered')
  })

  it('should require authentication', async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_npi: '3333333333',
        provider_name: 'Dr. New',
        provider_types: ['physician'],
      }),
    })
    expect(res.status).toBe(401)
  })
})

describe('OpenAPI spec includes new endpoints', () => {
  it('should include /health, /registrations, and /consent/status paths', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paths['/health']).toBeDefined()
    expect(body.paths['/registrations']).toBeDefined()
    expect(body.paths['/registrations/{id}']).toBeDefined()
    expect(body.paths['/consent/status/{relationship_id}']).toBeDefined()
  })

  it('should have POST method for /registrations', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    const body = await res.json()
    expect(body.paths['/registrations'].post).toBeDefined()
    expect(body.paths['/registrations'].post.operationId).toBe('createRegistration')
  })

  it('should mark /health as requiring no authentication', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    const body = await res.json()
    expect(body.paths['/health'].get.security).toEqual([])
  })
})
