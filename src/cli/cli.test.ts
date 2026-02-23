import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerStartCommand } from './commands/start.js'
import { registerStopCommand } from './commands/stop.js'
import { registerStatusCommand } from './commands/status.js'
import { registerProviderCommand } from './commands/provider.js'
import { registerDiscoverCommand } from './commands/discover.js'
import { registerApiKeyCommand } from './commands/api-key.js'
import { registerVerifyAuditCommand } from './commands/verify-audit.js'

// Mock IPC and registration modules for Phase 2 tests
vi.mock('../ipc/index.js', () => ({
  startIpcServer: vi.fn(() => ({
    close: vi.fn(),
  })),
  getSocketPath: vi.fn((storagePath: string) =>
    join(storagePath, '..', 'neuron.sock'),
  ),
  sendIpcCommand: vi.fn(),
}))

vi.mock('../routing/index.js', () => {
  const MockNeuronProtocolServer = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined)
    this.stop = vi.fn().mockResolvedValue(undefined)
    this.activeSessions = vi.fn().mockReturnValue([])
    this.getSessionManager = vi.fn().mockReturnValue({
      create: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
      size: 0,
    })
    this.setConnectionHandler = vi.fn()
    this.setOnSessionEnd = vi.fn()
    this.notifySessionEnd = vi.fn()
    this.port = null
    this.server = { on: vi.fn() }
  })
  return {
    NeuronProtocolServer: MockNeuronProtocolServer,
    createConnectionHandler: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('../discovery/index.js', () => ({
  DiscoveryService: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../api/index.js', () => {
  const MockApiKeyStore = vi.fn(function (this: Record<string, unknown>) {
    this.create = vi.fn().mockReturnValue({
      keyId: 'test-key-id',
      raw: 'nrn_test-raw-key',
      name: 'test-key',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    this.revoke = vi.fn()
    this.list = vi.fn().mockReturnValue([])
  })
  return {
    ApiKeyStore: MockApiKeyStore,
    TokenBucketRateLimiter: vi.fn(function (this: Record<string, unknown>) {
      this.consume = vi.fn().mockReturnValue(true)
      this.retryAfter = vi.fn().mockReturnValue(0)
      this.cleanup = vi.fn()
    }),
    createApiRouter: vi.fn().mockReturnValue(vi.fn()),
  }
})

vi.mock('../registration/index.js', () => {
  const MockAxonRegistrationService = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined)
    this.stop = vi.fn().mockResolvedValue(undefined)
    this.addProvider = vi.fn().mockResolvedValue(undefined)
    this.removeProvider = vi.fn().mockResolvedValue(undefined)
    this.listProviders = vi.fn().mockReturnValue([])
    this.getStatus = vi.fn().mockReturnValue({
      neuron: {
        organization_npi: '1234567893',
        organization_name: 'Test Practice',
        status: 'registered',
        registration_id: 'reg-123',
        last_heartbeat_at: null,
        providers: [],
      },
      heartbeat: 'healthy',
    })
  })
  return { AxonRegistrationService: MockAxonRegistrationService }
})

vi.mock('../audit/index.js', () => ({
  AuditLogger: vi.fn(function (this: Record<string, unknown>) {
    this.append = vi.fn()
  }),
  verifyAuditChain: vi.fn(),
  canonicalize: vi.fn(),
}))

describe('CLI', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-cli-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createProgram(): Command {
    const program = new Command()
    program
      .name('neuron')
      .description('CareAgent organizational boundary server')
      .version('0.1.0')
      .exitOverride()
    registerInitCommand(program)
    registerStartCommand(program)
    registerStopCommand(program)
    registerStatusCommand(program)
    registerProviderCommand(program)
    registerDiscoverCommand(program)
    registerApiKeyCommand(program)
    registerVerifyAuditCommand(program)
    return program
  }

  function writeValidConfig(dir: string): {
    configPath: string
    dbPath: string
    auditPath: string
  } {
    const configPath = join(dir, 'neuron.config.json')
    const dbPath = join(dir, 'data', 'neuron.db')
    const auditPath = join(dir, 'data', 'audit.jsonl')

    writeFileSync(
      configPath,
      JSON.stringify({
        organization: {
          npi: '1234567893',
          name: 'Test Practice',
          type: 'practice',
        },
        server: { port: 3000, host: '0.0.0.0' },
        storage: { path: dbPath },
        audit: { path: auditPath, enabled: true },
        localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
        heartbeat: { intervalMs: 60000 },
        axon: {
          registryUrl: 'http://localhost:9999',
          endpointUrl: 'http://localhost:3000',
          backoffCeilingMs: 300000,
        },
        api: {
          rateLimit: { maxRequests: 100, windowMs: 60000 },
          cors: { allowedOrigins: [] },
        },
      }),
    )

    return { configPath, dbPath, auditPath }
  }

  describe('help output', () => {
    it('should list all commands in help including provider, discover, and api-key', () => {
      const program = createProgram()
      const help = program.helpInformation()
      expect(help).toContain('init')
      expect(help).toContain('start')
      expect(help).toContain('stop')
      expect(help).toContain('status')
      expect(help).toContain('provider')
      expect(help).toContain('discover')
      expect(help).toContain('api-key')
      expect(help).toContain('verify-audit')
    })
  })

  describe('init command', () => {
    it('should create a valid config file', () => {
      const configPath = join(tempDir, 'neuron.config.json')

      // Mock process.exit to prevent test exit
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'init', '--output', configPath])

      expect(exitSpy).not.toHaveBeenCalled()
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(content)
      expect(config.organization).toBeDefined()
      expect(config.organization.npi).toBe('0000000000')
      expect(config.organization.name).toBe('My Organization')
      expect(config.organization.type).toBe('practice')
      expect(config.server).toBeDefined()
      expect(config.storage).toBeDefined()
      expect(config.audit).toBeDefined()
    })

    it('should refuse to overwrite existing config', () => {
      const configPath = join(tempDir, 'existing.config.json')
      writeFileSync(configPath, '{}')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'init', '--output', configPath])

      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('start command', () => {
    it('should succeed with a valid config and initialize registration', async () => {
      const { configPath, dbPath, auditPath } = writeValidConfig(tempDir)

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      // Mock setInterval to prevent keepalive
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      // Wait for async action to complete
      await vi.waitFor(() => {
        expect(existsSync(dbPath)).toBe(true)
      })

      expect(exitSpy).not.toHaveBeenCalled()

      // Verify storage DB was created
      expect(existsSync(dbPath)).toBe(true)

      // Verify AuditLogger was constructed and append was called with startup entry
      const { AuditLogger } = await import('../audit/index.js')
      expect(AuditLogger).toHaveBeenCalledWith(auditPath)
      const mockInstance = vi.mocked(AuditLogger).mock.instances[0] as unknown as { append: ReturnType<typeof vi.fn> }
      expect(mockInstance.append).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'admin',
          action: 'neuron_start',
          details: expect.objectContaining({ npi: '1234567893' }),
        }),
      )
    })

    it('should start IPC server during startup', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const { startIpcServer } = await import('../ipc/index.js')

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      // Wait for async action
      await vi.waitFor(() => {
        expect(startIpcServer).toHaveBeenCalled()
      })
    })

    it('should initialize AxonRegistrationService during startup', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const { AxonRegistrationService } = await import('../registration/index.js')

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      // Wait for async action
      await vi.waitFor(() => {
        expect(AxonRegistrationService).toHaveBeenCalled()
      })
    })

    it('should exit with error for invalid NPI config', () => {
      const configPath = join(tempDir, 'bad-npi.config.json')

      writeFileSync(
        configPath,
        JSON.stringify({
          organization: {
            npi: '0000000000',
            name: 'Test Practice',
            type: 'practice',
          },
          server: { port: 3000, host: '0.0.0.0' },
          storage: { path: join(tempDir, 'data', 'neuron.db') },
          audit: { path: join(tempDir, 'data', 'audit.jsonl'), enabled: true },
          localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
          heartbeat: { intervalMs: 60000 },
        }),
      )

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit with error for missing config file', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', join(tempDir, 'nonexistent.json')])

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit with error for malformed JSON', () => {
      const configPath = join(tempDir, 'bad.json')
      writeFileSync(configPath, '{ not valid json }')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should create data directory if missing', async () => {
      const configPath = join(tempDir, 'neuron.config.json')
      const nestedDataDir = join(tempDir, 'nested', 'deep', 'data')
      const dbPath = join(nestedDataDir, 'neuron.db')
      const auditPath = join(nestedDataDir, 'audit.jsonl')

      writeFileSync(
        configPath,
        JSON.stringify({
          organization: {
            npi: '1234567893',
            name: 'Test Practice',
            type: 'practice',
          },
          server: { port: 3000, host: '0.0.0.0' },
          storage: { path: dbPath },
          audit: { path: auditPath, enabled: true },
          localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
          heartbeat: { intervalMs: 60000 },
          axon: {
            registryUrl: 'http://localhost:9999',
            endpointUrl: 'http://localhost:3000',
            backoffCeilingMs: 300000,
          },
          api: {
            rateLimit: { maxRequests: 100, windowMs: 60000 },
            cors: { allowedOrigins: [] },
          },
        }),
      )

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      await vi.waitFor(() => {
        expect(existsSync(nestedDataDir)).toBe(true)
      })

      expect(existsSync(dbPath)).toBe(true)
    })

    it('should log discovery disabled when localNetwork.enabled is false', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      await vi.waitFor(() => {
        const calls = stdoutSpy.mock.calls.map((c) => c[0])
        expect(calls.some((c) => typeof c === 'string' && c.includes('Local network discovery disabled'))).toBe(true)
      })
    })
  })

  describe('provider commands', () => {
    it('should validate NPI on provider add', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'provider', 'add', '0000000000', '--name', 'Dr. Test', '--type', 'physician'])

      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(1)
      })

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid NPI'),
      )
    })

    it('should send IPC command on provider add with valid NPI', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({ ok: true })

      const program = createProgram()
      program.parse(['node', 'neuron', 'provider', 'add', '1234567893', '--name', 'Dr. Test', '--type', 'physician'])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalledWith(
          expect.any(String),
          { type: 'provider.add', npi: '1234567893', name: 'Dr. Test', provider_types: ['physician'] },
        )
      })

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should format provider list as table', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({
        ok: true,
        data: [
          { npi: '1234567893', status: 'registered', last_heartbeat: '2026-01-01T00:00:00Z' },
        ],
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'provider', 'list'])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalledWith(
          expect.any(String),
          { type: 'provider.list' },
        )
      })

      // Table output should include NPI
      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('1234567893'))).toBe(true)
    })

    it('should show message when no providers registered', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({
        ok: true,
        data: [],
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'provider', 'list'])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalled()
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('No providers registered'))).toBe(true)
    })

    it('should handle connection error on provider add', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockRejectedValue(new Error('ENOENT'))

      const program = createProgram()
      program.parse(['node', 'neuron', 'provider', 'add', '1234567893', '--name', 'Dr. Test', '--type', 'physician'])

      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(1)
      })

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not connect to Neuron'),
      )
    })
  })

  describe('status command', () => {
    it('should show "not running" when server is not running', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockRejectedValue(
        new Error('Neuron is not running (socket not found)'),
      )

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'status', '--config', join(tempDir, 'nonexistent.json')])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalled()
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Neuron is not running'))).toBe(true)
    })

    it('should display registration status when server is running', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({
        ok: true,
        data: {
          neuron: {
            organization_npi: '1234567893',
            organization_name: 'Test Practice',
            status: 'registered',
            registration_id: 'reg-123',
            last_heartbeat_at: '2026-01-01T00:00:00Z',
            providers: [],
          },
          heartbeat: 'healthy',
        },
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'status', '--config', join(tempDir, 'nonexistent.json')])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalled()
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      const allOutput = calls.filter((c): c is string => typeof c === 'string').join('')
      expect(allOutput).toContain('Neuron Status')
      expect(allOutput).toContain('Test Practice')
      expect(allOutput).toContain('registered')
      expect(allOutput).toContain('reg-123')
      expect(allOutput).toContain('healthy')
    })
  })

  describe('stop command', () => {
    it('should send shutdown IPC command', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({ ok: true, data: { message: 'Shutting down' } })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'stop', '--config', join(tempDir, 'nonexistent.json')])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ type: 'shutdown' }),
        )
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Neuron stopped'))).toBe(true)
    })

    it('should show "not running" when server is not running', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockRejectedValue(
        new Error('Neuron is not running (socket not found)'),
      )

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'stop', '--config', join(tempDir, 'nonexistent.json')])

      await vi.waitFor(() => {
        expect(sendIpcCommand).toHaveBeenCalled()
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Neuron is not running'))).toBe(true)
      // Idempotent stop — should NOT exit with error
      expect(exitSpy).not.toHaveBeenCalledWith(1)
    })

    it('should handle server error', async () => {
      const { sendIpcCommand } = await import('../ipc/index.js')
      vi.mocked(sendIpcCommand).mockResolvedValue({ ok: false, error: 'Shutdown failed' })

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'stop', '--config', join(tempDir, 'nonexistent.json')])

      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(1)
      })

      const calls = stderrSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Shutdown failed'))).toBe(true)
    })
  })

  describe('api-key commands', () => {
    it('should list api-key in help output', () => {
      const program = createProgram()
      const help = program.helpInformation()
      expect(help).toContain('api-key')
    })

    it('should create an API key and display the raw key', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'api-key', 'create', '--name', 'my-key', '--config', configPath])

      await vi.waitFor(() => {
        const calls = stdoutSpy.mock.calls.map((c) => c[0])
        expect(calls.some((c) => typeof c === 'string' && c.includes('API key created'))).toBe(true)
      })

      const allStdout = stdoutSpy.mock.calls.map((c) => c[0]).filter((c): c is string => typeof c === 'string').join('')
      expect(allStdout).toContain('Key ID:')
      expect(allStdout).toContain('API Key:')

      // Warning should be shown
      const allStderr = stderrSpy.mock.calls.map((c) => c[0]).filter((c): c is string => typeof c === 'string').join('')
      expect(allStderr).toContain('Save this key now')
    })

    it('should revoke an API key', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'api-key', 'revoke', 'some-key-id', '--config', configPath])

      await vi.waitFor(() => {
        const calls = stdoutSpy.mock.calls.map((c) => c[0])
        expect(calls.some((c) => typeof c === 'string' && c.includes('some-key-id') && c.includes('revoked'))).toBe(true)
      })
    })

    it('should list API keys with no keys', async () => {
      const { configPath } = writeValidConfig(tempDir)

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'api-key', 'list', '--config', configPath])

      await vi.waitFor(() => {
        const calls = stdoutSpy.mock.calls.map((c) => c[0])
        expect(calls.some((c) => typeof c === 'string' && c.includes('No API keys'))).toBe(true)
      })
    })

    it('should list API keys with entries', async () => {
      const { configPath } = writeValidConfig(tempDir)

      // Override mock to return keys for this test
      const { ApiKeyStore } = await import('../api/index.js')
      vi.mocked(ApiKeyStore).mockImplementation(function (this: Record<string, unknown>) {
        this.create = vi.fn()
        this.revoke = vi.fn()
        this.list = vi.fn().mockReturnValue([
          {
            key_id: 'key-abc',
            name: 'production',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: null,
            last_used_at: '2026-02-01T00:00:00.000Z',
          },
          {
            key_id: 'key-xyz',
            name: 'staging',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: '2026-02-15T00:00:00.000Z',
            last_used_at: null,
          },
        ])
        return this as never
      })

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const program = createProgram()
      program.parse(['node', 'neuron', 'api-key', 'list', '--config', configPath])

      await vi.waitFor(() => {
        const calls = stdoutSpy.mock.calls.map((c) => c[0])
        expect(calls.some((c) => typeof c === 'string' && c.includes('key-abc'))).toBe(true)
      })

      const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).filter((c): c is string => typeof c === 'string').join('')
      expect(allOutput).toContain('production')
      expect(allOutput).toContain('[active]')
      expect(allOutput).toContain('key-xyz')
      expect(allOutput).toContain('staging')
      expect(allOutput).toContain('REVOKED')
    })
  })

  describe('verify-audit command', () => {
    it('should report valid chain with --path', async () => {
      const { verifyAuditChain } = await import('../audit/index.js')
      vi.mocked(verifyAuditChain).mockReturnValue({
        valid: true,
        entries: 5,
        errors: [],
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'verify-audit', '--path', join(tempDir, 'audit.jsonl')])

      await vi.waitFor(() => {
        expect(verifyAuditChain).toHaveBeenCalledWith(join(tempDir, 'audit.jsonl'))
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Audit chain verified'))).toBe(true)
      expect(calls.some((c) => typeof c === 'string' && c.includes('5 entries'))).toBe(true)
    })

    it('should report empty audit log', async () => {
      const { verifyAuditChain } = await import('../audit/index.js')
      vi.mocked(verifyAuditChain).mockReturnValue({
        valid: true,
        entries: 0,
        errors: [],
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'verify-audit', '--path', join(tempDir, 'audit.jsonl')])

      await vi.waitFor(() => {
        expect(verifyAuditChain).toHaveBeenCalled()
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Audit log is empty'))).toBe(true)
    })

    it('should report broken chain and exit 1', async () => {
      const { verifyAuditChain } = await import('../audit/index.js')
      vi.mocked(verifyAuditChain).mockReturnValue({
        valid: false,
        entries: 3,
        errors: [
          { line: 2, error: 'Hash mismatch on line 2' },
        ],
      })

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'verify-audit', '--path', join(tempDir, 'audit.jsonl')])

      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(1)
      })

      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0])
      expect(stderrCalls.some((c) => typeof c === 'string' && c.includes('Audit chain BROKEN'))).toBe(true)
      expect(stderrCalls.some((c) => typeof c === 'string' && c.includes('Line 2'))).toBe(true)

      const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(stdoutCalls.some((c) => typeof c === 'string' && c.includes('3 entries checked'))).toBe(true)
    })

    it('should resolve path from config when --path not provided', async () => {
      const { configPath, auditPath } = writeValidConfig(tempDir)

      const { verifyAuditChain } = await import('../audit/index.js')
      vi.mocked(verifyAuditChain).mockReturnValue({
        valid: true,
        entries: 2,
        errors: [],
      })

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      const program = createProgram()
      program.parse(['node', 'neuron', 'verify-audit', '--config', configPath])

      await vi.waitFor(() => {
        expect(verifyAuditChain).toHaveBeenCalledWith(auditPath)
      })

      const calls = stdoutSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => typeof c === 'string' && c.includes('Audit chain verified'))).toBe(true)
    })
  })
})
