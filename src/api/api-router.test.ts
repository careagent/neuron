import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { SqliteStorage } from '../storage/sqlite.js'
import { ApiKeyStore } from './keys.js'
import { TokenBucketRateLimiter } from './rate-limiter.js'
import { RelationshipStore } from '../relationships/store.js'
import { createApiRouter, type ApiRouterDeps } from './router.js'
import type { NeuronConfig } from '../types/config.js'

/**
 * Comprehensive integration tests for the REST API router.
 *
 * Uses an in-memory SQLite database, a real HTTP server on port 0,
 * and mock registration/protocol services.
 */

/** Minimal NeuronConfig for testing */
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
    rateLimit: { maxRequests: 5, windowMs: 60000 },
    cors: { allowedOrigins: ['https://allowed.example.com'] },
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
} as unknown as ApiRouterDeps['registrationService']

/** Mock NeuronProtocolServer */
const mockProtocolServer = {
  activeSessions() {
    return [
      {
        sessionId: 'sess-001',
        patientAgentId: 'patient-1',
        providerAgentId: '1111111111',
        startedAt: '2026-01-01T00:00:00.000Z',
        status: 'active' as const,
      },
    ]
  },
} as unknown as ApiRouterDeps['protocolServer']

let server: Server
let baseUrl: string
let storage: SqliteStorage
let apiKeyStore: ApiKeyStore
let validApiKey: string

beforeAll(async () => {
  // Set up in-memory storage
  storage = new SqliteStorage(':memory:')
  storage.initialize()

  // Create stores
  apiKeyStore = new ApiKeyStore(storage)
  const rateLimiter = new TokenBucketRateLimiter(1000, 1000, 60000) // generous limit for shared tests
  const relationshipStore = new RelationshipStore(storage)

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
  relationshipStore.create({
    relationship_id: 'rel-002',
    patient_agent_id: 'patient-2',
    provider_npi: '2222222222',
    status: 'pending',
    consented_actions: ['read_vitals'],
    patient_public_key: 'pk-test-2',
    created_at: now,
    updated_at: now,
  })
  relationshipStore.create({
    relationship_id: 'rel-003',
    patient_agent_id: 'patient-3',
    provider_npi: '1111111111',
    status: 'active',
    consented_actions: ['read_vitals'],
    patient_public_key: 'pk-test-3',
    created_at: now,
    updated_at: now,
  })

  // Generate a valid API key
  const created = apiKeyStore.create('test-key')
  validApiKey = created.raw

  // Build deps and router
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

  // Create HTTP server
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

describe('REST API Router', () => {
  describe('Authentication', () => {
    it('should return 401 when X-API-Key header is missing', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Missing API key' })
    })

    it('should return 401 when X-API-Key is invalid', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': 'nrn_invalid_key_here' },
      })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Invalid API key' })
    })

    it('should return 401 when API key has been revoked', async () => {
      const revokedKey = apiKeyStore.create('revoked-key')
      apiKeyStore.revoke(revokedKey.keyId)

      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': revokedKey.raw },
      })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toEqual({ error: 'Invalid API key' })
    })

    it('should return 200 with valid API key', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
    })
  })

  describe('Rate Limiting', () => {
    it('should return 429 with Retry-After when rate limit is exceeded', async () => {
      // Create a fresh key for isolated rate limit testing
      const freshKey = apiKeyStore.create('rate-limit-key')

      // Use a fresh limiter with very low limit for this test
      const tightLimiter = new TokenBucketRateLimiter(2, 2, 60000)
      const tightDeps: ApiRouterDeps = {
        config: testConfig,
        storage,
        apiKeyStore,
        rateLimiter: tightLimiter,
        relationshipStore: new RelationshipStore(storage),
        registrationService: mockRegistrationService,
        protocolServer: mockProtocolServer,
      }
      const tightHandler = createApiRouter(tightDeps)

      const tightServer = createServer(tightHandler)
      const tightBaseUrl = await new Promise<string>((resolve) => {
        tightServer.listen(0, () => {
          const addr = tightServer.address()
          if (addr && typeof addr === 'object') {
            resolve(`http://127.0.0.1:${addr.port}`)
          }
        })
      })

      try {
        // Exhaust rate limit (2 tokens)
        await fetch(`${tightBaseUrl}/v1/organization`, {
          headers: { 'X-API-Key': freshKey.raw },
        })
        await fetch(`${tightBaseUrl}/v1/organization`, {
          headers: { 'X-API-Key': freshKey.raw },
        })

        // Third request should be rate limited
        const res = await fetch(`${tightBaseUrl}/v1/organization`, {
          headers: { 'X-API-Key': freshKey.raw },
        })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBeDefined()
        const body = await res.json()
        expect(body).toEqual({ error: 'Rate limit exceeded' })
      } finally {
        await new Promise<void>((resolve, reject) => {
          tightServer.close((err) => (err ? reject(err) : resolve()))
        })
      }
    })
  })

  describe('CORS', () => {
    it('should return 204 with CORS headers for OPTIONS from allowed origin', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://allowed.example.com',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com')
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-API-Key, Content-Type')
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    it('should return 204 without CORS headers for OPTIONS from disallowed origin', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('should include CORS headers on GET responses for allowed origin', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: {
          'X-API-Key': validApiKey,
          Origin: 'https://allowed.example.com',
        },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com')
    })

    it('should not include CORS headers when no Origin header is sent', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })

  describe('GET /v1/organization', () => {
    it('should return organization info', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({
        npi: '1234567890',
        name: 'Test Clinic',
        type: 'clinic',
        axon_status: 'registered',
        providers: 1,
      })
    })
  })

  describe('GET /v1/relationships', () => {
    it('should return paginated list of relationships', async () => {
      const res = await fetch(`${baseUrl}/v1/relationships`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(3)
      expect(body.offset).toBe(0)
      expect(body.limit).toBe(50)
      expect(body.data).toHaveLength(3)
      // Verify patient_public_key is excluded
      for (const rel of body.data) {
        expect(rel).not.toHaveProperty('patient_public_key')
        expect(rel).toHaveProperty('relationship_id')
        expect(rel).toHaveProperty('patient_agent_id')
        expect(rel).toHaveProperty('provider_npi')
        expect(rel).toHaveProperty('status')
        expect(rel).toHaveProperty('consented_actions')
        expect(rel).toHaveProperty('created_at')
        expect(rel).toHaveProperty('updated_at')
      }
    })

    it('should filter by status', async () => {
      const res = await fetch(`${baseUrl}/v1/relationships?status=active`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.total).toBe(2)
      for (const rel of body.data) {
        expect(rel.status).toBe('active')
      }
    })

    it('should paginate correctly with limit and offset', async () => {
      const res = await fetch(`${baseUrl}/v1/relationships?limit=1&offset=1`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.offset).toBe(1)
      expect(body.limit).toBe(1)
      expect(body.total).toBe(3)
    })
  })

  describe('GET /v1/relationships/:id', () => {
    it('should return a single relationship', async () => {
      const res = await fetch(`${baseUrl}/v1/relationships/rel-001`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.relationship_id).toBe('rel-001')
      expect(body.patient_agent_id).toBe('patient-1')
      expect(body.status).toBe('active')
      expect(body).not.toHaveProperty('patient_public_key')
    })

    it('should return 404 for unknown relationship ID', async () => {
      const res = await fetch(`${baseUrl}/v1/relationships/nonexistent`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toEqual({ error: 'Relationship not found' })
    })
  })

  describe('GET /v1/status', () => {
    it('should return server operational status', async () => {
      const res = await fetch(`${baseUrl}/v1/status`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('running')
      expect(typeof body.uptime_seconds).toBe('number')
      expect(body.organization).toEqual({
        npi: '1234567890',
        name: 'Test Clinic',
      })
      expect(body.axon).toEqual({ status: 'registered' })
      expect(body.active_sessions).toBe(1)
      expect(body.providers).toBe(1)
    })
  })

  describe('GET /openapi.json', () => {
    it('should return OpenAPI 3.1 spec', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.openapi).toBe('3.1.0')
      expect(body.info.title).toBe('Neuron REST API')
      expect(body.paths).toBeDefined()
      expect(body.components?.securitySchemes?.apiKey).toBeDefined()
    })

    it('should NOT require API key authentication', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.openapi).toBe('3.1.0')
    })
  })

  describe('404 handling', () => {
    it('should return 404 for unknown API paths', async () => {
      const res = await fetch(`${baseUrl}/v1/unknown`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toEqual({ error: 'Not found' })
    })

    it('should return 404 for non-GET methods on valid paths', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        method: 'POST',
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toEqual({ error: 'Not found' })
    })

    it('should not handle non-API paths', async () => {
      // createServer handler returns without calling res.end() for non-API paths
      // We need a server that has a fallback handler to test this
      const fallbackHandler = createApiRouter({
        config: testConfig,
        storage,
        apiKeyStore,
        rateLimiter: new TokenBucketRateLimiter(100, 100, 60000),
        relationshipStore: new RelationshipStore(storage),
        registrationService: mockRegistrationService,
        protocolServer: mockProtocolServer,
      })

      const fallbackServer = createServer((req, res) => {
        // Let router try first
        fallbackHandler(req, res)
        // If router didn't handle (non-API path), respond with 999 as sentinel
        if (!res.writableEnded) {
          res.writeHead(999)
          res.end()
        }
      })

      const fallbackUrl = await new Promise<string>((resolve) => {
        fallbackServer.listen(0, () => {
          const addr = fallbackServer.address()
          if (addr && typeof addr === 'object') {
            resolve(`http://127.0.0.1:${addr.port}`)
          }
        })
      })

      try {
        const res = await fetch(`${fallbackUrl}/some/random/path`)
        expect(res.status).toBe(999) // Sentinel: router did NOT handle this path
      } finally {
        await new Promise<void>((resolve, reject) => {
          fallbackServer.close((err) => (err ? reject(err) : resolve()))
        })
      }
    })
  })

  describe('Response format', () => {
    it('should always return Content-Type: application/json', async () => {
      const res = await fetch(`${baseUrl}/v1/organization`, {
        headers: { 'X-API-Key': validApiKey },
      })
      expect(res.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return error responses in { error: "message" } format', async () => {
      // 401
      const res401 = await fetch(`${baseUrl}/v1/organization`)
      const body401 = await res401.json()
      expect(body401).toHaveProperty('error')
      expect(typeof body401.error).toBe('string')

      // 404
      const res404 = await fetch(`${baseUrl}/v1/nonexistent`, {
        headers: { 'X-API-Key': validApiKey },
      })
      const body404 = await res404.json()
      expect(body404).toHaveProperty('error')
      expect(typeof body404.error).toBe('string')
    })
  })
})

describe('REST API Audit Events', () => {
  let auditServer: Server
  let auditBaseUrl: string
  let auditStorage: SqliteStorage
  let auditApiKeyStore: ApiKeyStore
  let auditValidKey: string
  const mockAuditLogger = { append: vi.fn() }

  beforeAll(async () => {
    auditStorage = new SqliteStorage(':memory:')
    auditStorage.initialize()
    auditApiKeyStore = new ApiKeyStore(auditStorage)
    const created = auditApiKeyStore.create('audit-test-key')
    auditValidKey = created.raw

    const deps: ApiRouterDeps = {
      config: testConfig,
      storage: auditStorage,
      apiKeyStore: auditApiKeyStore,
      rateLimiter: new TokenBucketRateLimiter(100, 100, 60000),
      relationshipStore: new RelationshipStore(auditStorage),
      registrationService: mockRegistrationService,
      protocolServer: mockProtocolServer,
      auditLogger: mockAuditLogger as unknown as ApiRouterDeps['auditLogger'],
    }
    const handler = createApiRouter(deps)

    auditServer = createServer(handler)
    await new Promise<void>((resolve) => {
      auditServer.listen(0, () => {
        const addr = auditServer.address()
        if (addr && typeof addr === 'object') {
          auditBaseUrl = `http://127.0.0.1:${addr.port}`
        }
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      auditServer.close((err) => (err ? reject(err) : resolve()))
    })
    auditStorage.close()
  })

  it('should emit api_access auth_failure for missing API key', async () => {
    mockAuditLogger.append.mockClear()
    await fetch(`${auditBaseUrl}/v1/organization`)

    expect(mockAuditLogger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'api_access',
        action: 'auth_failure',
        details: expect.objectContaining({ reason: 'missing_key' }),
      }),
    )
  })

  it('should emit api_access auth_failure for invalid API key', async () => {
    mockAuditLogger.append.mockClear()
    await fetch(`${auditBaseUrl}/v1/organization`, {
      headers: { 'X-API-Key': 'nrn_invalid_key' },
    })

    expect(mockAuditLogger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'api_access',
        action: 'auth_failure',
        details: expect.objectContaining({ reason: 'invalid_key' }),
      }),
    )
  })

  it('should emit api_access api_request for successful authenticated request', async () => {
    mockAuditLogger.append.mockClear()
    await fetch(`${auditBaseUrl}/v1/organization`, {
      headers: { 'X-API-Key': auditValidKey },
    })

    expect(mockAuditLogger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'api_access',
        action: 'api_request',
        details: expect.objectContaining({
          method: 'GET',
          path: '/v1/organization',
        }),
      }),
    )
  })

  it('should emit api_access rate_limited when rate limit exceeded', async () => {
    // Create a tight rate-limited router
    const tightLimiter = new TokenBucketRateLimiter(1, 1, 60000)
    const tightMockAudit = { append: vi.fn() }
    const tightKey = auditApiKeyStore.create('rate-limit-audit-key')

    const tightDeps: ApiRouterDeps = {
      config: testConfig,
      storage: auditStorage,
      apiKeyStore: auditApiKeyStore,
      rateLimiter: tightLimiter,
      relationshipStore: new RelationshipStore(auditStorage),
      registrationService: mockRegistrationService,
      protocolServer: mockProtocolServer,
      auditLogger: tightMockAudit as unknown as ApiRouterDeps['auditLogger'],
    }
    const tightHandler = createApiRouter(tightDeps)
    const tightServer = createServer(tightHandler)
    const tightBaseUrl = await new Promise<string>((resolve) => {
      tightServer.listen(0, () => {
        const addr = tightServer.address()
        if (addr && typeof addr === 'object') {
          resolve(`http://127.0.0.1:${addr.port}`)
        }
      })
    })

    try {
      // First request — consumes the single token
      await fetch(`${tightBaseUrl}/v1/organization`, {
        headers: { 'X-API-Key': tightKey.raw },
      })

      tightMockAudit.append.mockClear()

      // Second request — rate limited
      await fetch(`${tightBaseUrl}/v1/organization`, {
        headers: { 'X-API-Key': tightKey.raw },
      })

      expect(tightMockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'api_access',
          action: 'rate_limited',
        }),
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        tightServer.close((err) => (err ? reject(err) : resolve()))
      })
    }
  })
})
