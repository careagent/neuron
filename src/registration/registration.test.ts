import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AxonClient, AxonError } from './axon-client.js'
import { RegistrationStateStore } from './state.js'
import { HeartbeatManager, HEARTBEAT_INTERVAL_MS, writeHealthFile } from './heartbeat.js'
import { AxonRegistrationService } from './service.js'
import { SqliteStorage } from '../storage/sqlite.js'
import type { StorageEngine } from '../storage/interface.js'
import type { NeuronConfig } from '../types/config.js'

// ---------------------------------------------------------------------------
// MSW Mock Handlers
// ---------------------------------------------------------------------------

const MOCK_BASE = 'http://mock-axon.test'

const handlers = [
  http.post(`${MOCK_BASE}/v1/neurons`, () => {
    return HttpResponse.json(
      {
        registration_id: 'test-reg-id',
        bearer_token: 'test-bearer-token',
        status: 'reachable',
      },
      { status: 201 },
    )
  }),

  http.put(`${MOCK_BASE}/v1/neurons/:id/endpoint`, () => {
    return HttpResponse.json({ status: 'reachable' }, { status: 200 })
  }),

  http.post(`${MOCK_BASE}/v1/neurons/:id/providers`, () => {
    return HttpResponse.json(
      { provider_id: 'test-provider-id', status: 'registered' },
      { status: 201 },
    )
  }),

  http.delete(`${MOCK_BASE}/v1/neurons/:id/providers/:npi`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]

const mswServer = setupServer(...handlers)

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }))
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestStorage(): SqliteStorage {
  const storage = new SqliteStorage(':memory:')
  storage.initialize()
  return storage
}

function createTestConfig(overrides?: Partial<NeuronConfig>): NeuronConfig {
  const tempDir = mkdtempSync(join(tmpdir(), 'neuron-svc-test-'))
  return {
    organization: {
      npi: '1234567893',
      name: 'Test Clinic',
      type: 'practice',
    },
    server: { port: 3000, host: '0.0.0.0' },
    storage: { path: join(tempDir, 'neuron.db') },
    audit: { path: join(tempDir, 'audit.jsonl'), enabled: true },
    localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
    heartbeat: { intervalMs: 60000 },
    axon: {
      registryUrl: MOCK_BASE,
      endpointUrl: 'http://localhost:3000',
      backoffCeilingMs: 300000,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AxonClient Tests
// ---------------------------------------------------------------------------

describe('AxonClient', () => {
  it('registerNeuron returns registration_id and bearer_token', async () => {
    const client = new AxonClient(MOCK_BASE)
    const result = await client.registerNeuron({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      neuron_endpoint_url: 'http://localhost:3000',
    })
    expect(result.registration_id).toBe('test-reg-id')
    expect(result.bearer_token).toBe('test-bearer-token')
    expect(result.status).toBe('reachable')
  })

  it('updateEndpoint succeeds with 200', async () => {
    const client = new AxonClient(MOCK_BASE, 'token')
    await expect(
      client.updateEndpoint('test-reg-id', { neuron_endpoint_url: 'http://localhost:3000' }),
    ).resolves.toBeUndefined()
  })

  it('registerProvider returns provider_id', async () => {
    const client = new AxonClient(MOCK_BASE, 'token')
    const result = await client.registerProvider('test-reg-id', {
      provider_npi: '9876543210',
    })
    expect(result.provider_id).toBe('test-provider-id')
    expect(result.status).toBe('registered')
  })

  it('removeProvider succeeds with 204', async () => {
    const client = new AxonClient(MOCK_BASE, 'token')
    await expect(
      client.removeProvider('test-reg-id', '9876543210'),
    ).resolves.toBeUndefined()
  })

  it('throws AxonError with status code on non-ok response', async () => {
    mswServer.use(
      http.post(`${MOCK_BASE}/v1/neurons`, () => {
        return HttpResponse.json({ error: 'bad request' }, { status: 400 })
      }),
    )

    const client = new AxonClient(MOCK_BASE)
    await expect(
      client.registerNeuron({
        organization_npi: '1234567893',
        organization_name: 'Test',
        organization_type: 'practice',
        neuron_endpoint_url: 'http://localhost:3000',
      }),
    ).rejects.toThrow(AxonError)

    try {
      await client.registerNeuron({
        organization_npi: '1234567893',
        organization_name: 'Test',
        organization_type: 'practice',
        neuron_endpoint_url: 'http://localhost:3000',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(AxonError)
      expect((err as AxonError).statusCode).toBe(400)
    }
  })

  it('setBearerToken updates authorization header', async () => {
    const client = new AxonClient(MOCK_BASE)
    client.setBearerToken('new-token')

    // Should work without throwing (server accepts any token in mock)
    await expect(
      client.updateEndpoint('test-reg-id', { neuron_endpoint_url: 'http://localhost:3000' }),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// RegistrationStateStore Tests
// ---------------------------------------------------------------------------

describe('RegistrationStateStore', () => {
  let storage: SqliteStorage
  let store: RegistrationStateStore

  beforeEach(() => {
    storage = createTestStorage()
    store = new RegistrationStateStore(storage)
  })

  afterEach(() => {
    storage.close()
  })

  it('load returns null when no registration exists', () => {
    const state = store.load()
    expect(state).toBeNull()
  })

  it('save and load round-trip', () => {
    store.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: 'http://axon.test',
      neuron_endpoint_url: 'http://localhost:3000',
      registration_id: 'reg-001',
      axon_bearer_token: 'secret-token',
      status: 'registered',
      first_registered_at: '2026-01-01T00:00:00Z',
    })

    const state = store.load()
    expect(state).not.toBeNull()
    expect(state!.organization_npi).toBe('1234567893')
    expect(state!.organization_name).toBe('Test Clinic')
    expect(state!.registration_id).toBe('reg-001')
    expect(state!.axon_bearer_token).toBe('secret-token')
    expect(state!.status).toBe('registered')
    expect(state!.first_registered_at).toBe('2026-01-01T00:00:00Z')
    expect(state!.providers).toEqual([])
  })

  it('updateHeartbeat updates timestamps', () => {
    store.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: 'http://axon.test',
      neuron_endpoint_url: 'http://localhost:3000',
      status: 'registered',
    })

    const timestamp = '2026-01-15T12:00:00Z'
    store.updateHeartbeat(timestamp)

    const state = store.load()
    expect(state!.last_heartbeat_at).toBe(timestamp)
    expect(state!.last_axon_response_at).toBe(timestamp)
  })

  it('updateStatus updates the status', () => {
    store.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: 'http://axon.test',
      neuron_endpoint_url: 'http://localhost:3000',
      status: 'unregistered',
    })

    store.updateStatus('registered')
    const state = store.load()
    expect(state!.status).toBe('registered')
  })

  it('saveProvider and listProviders', () => {
    store.saveProvider({
      provider_npi: '9876543210',
      axon_provider_id: 'prov-001',
      registration_status: 'registered',
      first_registered_at: '2026-01-01T00:00:00Z',
    })

    store.saveProvider({
      provider_npi: '1111111111',
      registration_status: 'pending',
    })

    const providers = store.listProviders()
    expect(providers).toHaveLength(2)

    const registered = providers.find((p) => p.provider_npi === '9876543210')
    expect(registered).toBeDefined()
    expect(registered!.axon_provider_id).toBe('prov-001')
    expect(registered!.registration_status).toBe('registered')

    const pending = providers.find((p) => p.provider_npi === '1111111111')
    expect(pending).toBeDefined()
    expect(pending!.registration_status).toBe('pending')
  })

  it('removeProvider deletes from provider_registrations', () => {
    store.saveProvider({
      provider_npi: '9876543210',
      registration_status: 'registered',
    })

    store.removeProvider('9876543210')
    const providers = store.listProviders()
    expect(providers).toHaveLength(0)
  })

  it('load includes providers from provider_registrations', () => {
    store.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: 'http://axon.test',
      neuron_endpoint_url: 'http://localhost:3000',
      status: 'registered',
    })

    store.saveProvider({
      provider_npi: '9876543210',
      axon_provider_id: 'prov-001',
      registration_status: 'registered',
    })

    const state = store.load()
    expect(state!.providers).toHaveLength(1)
    expect(state!.providers[0].provider_npi).toBe('9876543210')
  })
})

// ---------------------------------------------------------------------------
// HeartbeatManager Tests
// ---------------------------------------------------------------------------

describe('HeartbeatManager', () => {
  let storage: SqliteStorage
  let stateStore: RegistrationStateStore

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createTestStorage()
    stateStore = new RegistrationStateStore(storage)

    // Set up a registered state
    stateStore.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: MOCK_BASE,
      neuron_endpoint_url: 'http://localhost:3000',
      registration_id: 'test-reg-id',
      axon_bearer_token: 'test-token',
      status: 'registered',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    storage.close()
  })

  it('calls updateEndpoint at HEARTBEAT_INTERVAL_MS intervals', async () => {
    const client = new AxonClient(MOCK_BASE, 'test-token')
    const updateSpy = vi.spyOn(client, 'updateEndpoint')

    const heartbeat = new HeartbeatManager(client, stateStore, 300000)
    heartbeat.start()

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith('test-reg-id', {
      neuron_endpoint_url: 'http://localhost:3000',
    })

    // Advance past second interval
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(updateSpy).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })

  it('enters backoff on failure (delay increases)', async () => {
    const client = new AxonClient(MOCK_BASE, 'test-token')
    vi.spyOn(client, 'updateEndpoint').mockRejectedValue(new Error('network error'))

    const statusChanges: string[] = []
    const heartbeat = new HeartbeatManager(
      client,
      stateStore,
      300000,
      (status) => statusChanges.push(status),
    )
    heartbeat.start()

    // First beat: should fail and go degraded
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(heartbeat.getStatus()).toBe('degraded')
    expect(statusChanges).toContain('degraded')
  })

  it('resets attempt on success after failure', async () => {
    const client = new AxonClient(MOCK_BASE, 'test-token')
    const updateSpy = vi.spyOn(client, 'updateEndpoint')

    // First call fails, second succeeds
    updateSpy
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue(undefined)

    const statusChanges: string[] = []
    const heartbeat = new HeartbeatManager(
      client,
      stateStore,
      300000,
      (status) => statusChanges.push(status),
    )
    heartbeat.start()

    // First beat: fail
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(heartbeat.getStatus()).toBe('degraded')

    // Advance past backoff (max possible is 300000)
    await vi.advanceTimersByTimeAsync(300001)
    expect(heartbeat.getStatus()).toBe('healthy')
    expect(statusChanges).toContain('healthy')

    heartbeat.stop()
  })

  it('stops cleanly', async () => {
    const client = new AxonClient(MOCK_BASE, 'test-token')
    const updateSpy = vi.spyOn(client, 'updateEndpoint')

    const heartbeat = new HeartbeatManager(client, stateStore, 300000)
    heartbeat.start()
    heartbeat.stop()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('skips beat when not registered', async () => {
    // Set state to unregistered
    stateStore.updateStatus('unregistered')

    const client = new AxonClient(MOCK_BASE, 'test-token')
    const updateSpy = vi.spyOn(client, 'updateEndpoint')

    const heartbeat = new HeartbeatManager(client, stateStore, 300000)
    heartbeat.start()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(updateSpy).not.toHaveBeenCalled()

    heartbeat.stop()
  })
})

// ---------------------------------------------------------------------------
// writeHealthFile Tests
// ---------------------------------------------------------------------------

describe('writeHealthFile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-health-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes neuron.health.json with correct structure', () => {
    writeHealthFile(tempDir, 'healthy', '2026-01-15T12:00:00Z')

    const filePath = join(tempDir, 'neuron.health.json')
    expect(existsSync(filePath)).toBe(true)

    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(content.status).toBe('healthy')
    expect(content.last_heartbeat_at).toBe('2026-01-15T12:00:00Z')
    expect(content.updated_at).toBeDefined()
    expect(typeof content.updated_at).toBe('string')
  })

  it('writes null last_heartbeat_at when not provided', () => {
    writeHealthFile(tempDir, 'degraded')

    const filePath = join(tempDir, 'neuron.health.json')
    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(content.status).toBe('degraded')
    expect(content.last_heartbeat_at).toBeNull()
  })

  it('produces valid JSON parseable by external tools', () => {
    writeHealthFile(tempDir, 'healthy', '2026-01-15T12:00:00Z')

    const filePath = join(tempDir, 'neuron.health.json')
    const raw = readFileSync(filePath, 'utf-8')

    // Should not throw
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('status')
    expect(parsed).toHaveProperty('last_heartbeat_at')
    expect(parsed).toHaveProperty('updated_at')
  })
})

// ---------------------------------------------------------------------------
// AxonRegistrationService Tests
// ---------------------------------------------------------------------------

describe('AxonRegistrationService', () => {
  let storage: SqliteStorage
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-svc-test-'))
    storage = createTestStorage()
  })

  afterEach(() => {
    storage.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createConfig(): NeuronConfig {
    return {
      organization: {
        npi: '1234567893',
        name: 'Test Clinic',
        type: 'practice',
      },
      server: { port: 3000, host: '0.0.0.0' },
      storage: { path: join(tempDir, 'neuron.db') },
      audit: { path: join(tempDir, 'audit.jsonl'), enabled: true },
      localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
      heartbeat: { intervalMs: 60000 },
      axon: {
        registryUrl: MOCK_BASE,
        endpointUrl: 'http://localhost:3000',
        backoffCeilingMs: 300000,
      },
    }
  }

  it('start() registers with Axon on first boot', async () => {
    const config = createConfig()
    const service = new AxonRegistrationService(config, storage)

    await service.start()

    const status = service.getStatus()
    expect(status.neuron).not.toBeNull()
    expect(status.neuron!.status).toBe('registered')
    expect(status.neuron!.registration_id).toBe('test-reg-id')
    // Bearer token should be stored but never exposed in status response
    expect(status.neuron!.axon_bearer_token).toBe('test-bearer-token')

    await service.stop()
  })

  it('start() skips registration on restart if already registered', async () => {
    const config = createConfig()

    // Pre-populate registration state (simulating a restart)
    const stateStore = new RegistrationStateStore(storage)
    stateStore.save({
      organization_npi: '1234567893',
      organization_name: 'Test Clinic',
      organization_type: 'practice',
      axon_registry_url: MOCK_BASE,
      neuron_endpoint_url: 'http://localhost:3000',
      registration_id: 'existing-reg-id',
      axon_bearer_token: 'existing-token',
      status: 'registered',
      first_registered_at: '2026-01-01T00:00:00Z',
    })

    // Track whether registerNeuron is called
    let registerCalled = false
    mswServer.use(
      http.post(`${MOCK_BASE}/v1/neurons`, () => {
        registerCalled = true
        return HttpResponse.json(
          { registration_id: 'new-id', bearer_token: 'new-token', status: 'reachable' },
          { status: 201 },
        )
      }),
    )

    const service = new AxonRegistrationService(config, storage)
    await service.start()

    // Should NOT have called registerNeuron
    expect(registerCalled).toBe(false)

    // Should still have the existing registration
    const status = service.getStatus()
    expect(status.neuron!.registration_id).toBe('existing-reg-id')

    await service.stop()
  })

  it('addProvider registers with Axon and persists', async () => {
    const config = createConfig()
    const service = new AxonRegistrationService(config, storage)
    await service.start()

    await service.addProvider('9876543210')

    const providers = service.listProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0].provider_npi).toBe('9876543210')
    expect(providers[0].axon_provider_id).toBe('test-provider-id')
    expect(providers[0].registration_status).toBe('registered')

    await service.stop()
  })

  it('removeProvider unregisters and removes from state', async () => {
    const config = createConfig()
    const service = new AxonRegistrationService(config, storage)
    await service.start()

    await service.addProvider('9876543210')
    expect(service.listProviders()).toHaveLength(1)

    await service.removeProvider('9876543210')
    expect(service.listProviders()).toHaveLength(0)

    await service.stop()
  })

  it('handles Axon unreachable on first start gracefully', async () => {
    mswServer.use(
      http.post(`${MOCK_BASE}/v1/neurons`, () => {
        return HttpResponse.error()
      }),
    )

    const config = createConfig()
    const service = new AxonRegistrationService(config, storage)

    // Should not throw
    await expect(service.start()).resolves.toBeUndefined()

    const status = service.getStatus()
    // Heartbeat should report degraded since start failed
    expect(status.heartbeat).toBe('degraded')

    await service.stop()
  })
})
