import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerStartCommand } from './commands/start.js'
import { registerStopCommand } from './commands/stop.js'
import { registerStatusCommand } from './commands/status.js'

describe('CLI', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-cli-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    return program
  }

  describe('help output', () => {
    it('should list all four commands in help', () => {
      const program = createProgram()
      const help = program.helpInformation()
      expect(help).toContain('init')
      expect(help).toContain('start')
      expect(help).toContain('stop')
      expect(help).toContain('status')
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
    it('should succeed with a valid config', () => {
      const configPath = join(tempDir, 'neuron.config.json')
      const dbPath = join(tempDir, 'data', 'neuron.db')
      const auditPath = join(tempDir, 'data', 'audit.jsonl')

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
          localNetwork: { enabled: false },
          heartbeat: { intervalMs: 60000 },
        }),
      )

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      // Mock setInterval to prevent keepalive
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      expect(exitSpy).not.toHaveBeenCalled()

      // Verify storage DB was created
      expect(existsSync(dbPath)).toBe(true)

      // Verify audit log was created with startup entry
      expect(existsSync(auditPath)).toBe(true)
      const auditContent = readFileSync(auditPath, 'utf-8').trim()
      const entry = JSON.parse(auditContent)
      expect(entry.category).toBe('admin')
      expect(entry.action).toBe('neuron_start')
      expect(entry.details.npi).toBe('1234567893')
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
          localNetwork: { enabled: false },
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

    it('should create data directory if missing', () => {
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
          localNetwork: { enabled: false },
          heartbeat: { intervalMs: 60000 },
        }),
      )

      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      vi.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

      const program = createProgram()
      program.parse(['node', 'neuron', 'start', '--config', configPath])

      expect(existsSync(nestedDataDir)).toBe(true)
      expect(existsSync(dbPath)).toBe(true)
    })
  })
})
