import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, ConfigError } from './loader.js'

describe('loadConfig', () => {
  let tempDir: string
  let configPath: string

  const validConfig = {
    organization: {
      npi: '1234567893',
      name: 'Test Practice',
      type: 'practice',
    },
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuron-test-'))
    configPath = join(tempDir, 'neuron.config.json')
  })

  afterEach(() => {
    // Clean up env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEURON_')) {
        delete process.env[key]
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('successful loading', () => {
    it('should load a valid config file and return typed NeuronConfig', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      const config = loadConfig(configPath)
      expect(config.organization.npi).toBe('1234567893')
      expect(config.organization.name).toBe('Test Practice')
      expect(config.organization.type).toBe('practice')
    })

    it('should apply defaults for missing fields', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      const config = loadConfig(configPath)
      expect(config.server.port).toBe(3000)
      expect(config.server.host).toBe('0.0.0.0')
      expect(config.storage.path).toBe('./data/neuron.db')
      expect(config.audit.path).toBe('./data/audit.jsonl')
      expect(config.audit.enabled).toBe(true)
      expect(config.localNetwork.enabled).toBe(false)
      expect(config.heartbeat.intervalMs).toBe(60000)
    })

    it('should override defaults with user-specified values', () => {
      const customConfig = {
        ...validConfig,
        server: { port: 8080, host: 'localhost' },
      }
      writeFileSync(configPath, JSON.stringify(customConfig))
      const config = loadConfig(configPath)
      expect(config.server.port).toBe(8080)
      expect(config.server.host).toBe('localhost')
    })
  })

  describe('environment variable overrides', () => {
    it('should override nested config with double underscore (NEURON_SERVER__PORT)', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      process.env.NEURON_SERVER__PORT = '8080'
      const config = loadConfig(configPath)
      expect(config.server.port).toBe(8080)
    })

    it('should coerce boolean env vars (NEURON_AUDIT__ENABLED=false)', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      process.env.NEURON_AUDIT__ENABLED = 'false'
      const config = loadConfig(configPath)
      expect(config.audit.enabled).toBe(false)
    })

    it('should coerce numeric string to number', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      process.env.NEURON_HEARTBEAT__INTERVALMS = '30000'
      const config = loadConfig(configPath)
      expect(config.heartbeat.intervalMs).toBe(30000)
    })

    it('should keep string values as strings', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      process.env.NEURON_SERVER__HOST = '127.0.0.1'
      const config = loadConfig(configPath)
      expect(config.server.host).toBe('127.0.0.1')
    })
  })

  describe('error handling', () => {
    it('should throw ConfigError for missing config file', () => {
      expect(() => loadConfig('/tmp/nonexistent-config.json')).toThrow(ConfigError)
      expect(() => loadConfig('/tmp/nonexistent-config.json')).toThrow('Configuration file not found')
    })

    it('should throw ConfigError for invalid JSON', () => {
      writeFileSync(configPath, '{ invalid json }')
      expect(() => loadConfig(configPath)).toThrow(ConfigError)
      expect(() => loadConfig(configPath)).toThrow('Invalid JSON')
    })

    it('should throw ConfigError for missing required fields', () => {
      writeFileSync(configPath, JSON.stringify({ server: { port: 3000 } }))
      try {
        loadConfig(configPath)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        const configErr = err as ConfigError
        expect(configErr.message).toContain('Configuration invalid')
        expect(configErr.fields.length).toBeGreaterThan(0)
      }
    })

    it('should throw ConfigError for invalid NPI (bad Luhn)', () => {
      const badNpiConfig = {
        organization: {
          npi: '1234567890', // Invalid check digit
          name: 'Test Practice',
          type: 'practice',
        },
      }
      writeFileSync(configPath, JSON.stringify(badNpiConfig))
      expect(() => loadConfig(configPath)).toThrow(ConfigError)
      expect(() => loadConfig(configPath)).toThrow('Luhn check digit')
    })

    it('should throw ConfigError for NPI with wrong format', () => {
      const shortNpiConfig = {
        organization: {
          npi: '12345',
          name: 'Test Practice',
          type: 'practice',
        },
      }
      writeFileSync(configPath, JSON.stringify(shortNpiConfig))
      expect(() => loadConfig(configPath)).toThrow(ConfigError)
    })
  })

  describe('config immutability', () => {
    it('should return a frozen config object', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      const config = loadConfig(configPath)
      expect(Object.isFrozen(config)).toBe(true)
    })

    it('should deeply freeze nested objects', () => {
      writeFileSync(configPath, JSON.stringify(validConfig))
      const config = loadConfig(configPath)
      expect(Object.isFrozen(config.server)).toBe(true)
      expect(Object.isFrozen(config.organization)).toBe(true)
      expect(Object.isFrozen(config.storage)).toBe(true)
    })
  })
})
