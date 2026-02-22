/**
 * E2E: REST API Test
 *
 * Validates ROADMAP Phase 7 Success Criterion 3: REST API key creation
 * with rate limiting enforcement.
 *
 * Tests cover: authenticated endpoints, unauthenticated rejection, rate
 * limit exhaustion, OpenAPI spec access, and CORS preflight.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NeuronTestHarness } from './helpers/neuron-harness.js'

describe('E2E: REST API', { timeout: 15000 }, () => {
  let harness: NeuronTestHarness
  let apiKeyRaw: string

  beforeAll(async () => {
    harness = new NeuronTestHarness()
    await harness.start({
      rateLimit: { maxRequests: 3, windowMs: 60000 }, // Low limit, long window
    })

    // Create API key for testing
    const keyResult = harness.apiKeyStore.create('e2e-test-key')
    apiKeyRaw = keyResult.raw
  })

  afterAll(async () => {
    await harness.stop()
  })

  it('GET /v1/organization returns org data with valid API key', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/organization`, {
      headers: { 'X-API-Key': apiKeyRaw },
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.npi).toBe('9999999999') // Org NPI from harness config
    expect(body.name).toBe('E2E Test Org')
    expect(body.type).toBe('practice')
    expect(body).toHaveProperty('axon_status')
    expect(body).toHaveProperty('providers')
  })

  it('GET /v1/relationships returns relationship list', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/relationships`, {
      headers: { 'X-API-Key': apiKeyRaw },
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('offset')
    expect(body).toHaveProperty('limit')
  })

  it('GET /v1/status returns server status', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/status`, {
      headers: { 'X-API-Key': apiKeyRaw },
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('running')
    expect(body).toHaveProperty('uptime_seconds')
    expect(body.organization.npi).toBe('9999999999')
    expect(body.organization.name).toBe('E2E Test Org')
    expect(body).toHaveProperty('axon')
    expect(body).toHaveProperty('active_sessions')
    expect(body).toHaveProperty('providers')
  })

  it('GET /openapi.json returns valid OpenAPI spec without auth', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/openapi.json`)
    // No API key header

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.openapi).toBe('3.1.0')
    expect(body.info.title).toBe('Neuron REST API')
    expect(body).toHaveProperty('paths')
    expect(body).toHaveProperty('components')
  })

  it('requests without API key receive 401', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/organization`)
    // No API key header

    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('Missing API key')
  })

  it('requests with invalid API key receive 401', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/organization`, {
      headers: { 'X-API-Key': 'nrn_invalid_key_12345' },
    })

    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('Invalid API key')
  })

  it('rate limiting returns 429 after token exhaustion', async () => {
    // Create a fresh API key to avoid interference from earlier tests
    const freshKey = harness.apiKeyStore.create('rate-limit-test')

    // Exhaust all 3 tokens
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`http://127.0.0.1:${harness.port}/v1/status`, {
        headers: { 'X-API-Key': freshKey.raw },
      })
      expect(r.status).toBe(200)
    }

    // Next request should be rate limited
    const limitedRes = await fetch(`http://127.0.0.1:${harness.port}/v1/status`, {
      headers: { 'X-API-Key': freshKey.raw },
    })

    expect(limitedRes.status).toBe(429)

    const body = await limitedRes.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('Rate limit')

    // Verify Retry-After header is present
    expect(limitedRes.headers.get('retry-after')).toBeDefined()
  })

  it('CORS preflight returns correct headers for allowed origin', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/v1/organization`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    })

    expect(res.status).toBe(204)

    // Since harness uses allowedOrigins: ['*'], CORS should be allowed
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('access-control-allow-headers')).toContain('X-API-Key')
  })
})
