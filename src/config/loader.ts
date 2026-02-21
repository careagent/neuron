import { readFileSync } from 'node:fs'
import { Value } from '@sinclair/typebox/value'
import { NeuronConfigSchema, type NeuronConfig } from '../types/config.js'
import { isValidNpi } from '../validators/npi.js'
import { DEFAULT_CONFIG } from './defaults.js'

/**
 * Configuration validation error with field-level details.
 */
export class ConfigError extends Error {
  public readonly fields: Array<{ path: string; message: string }>

  constructor(message: string, fields: Array<{ path: string; message: string }> = []) {
    super(message)
    this.name = 'ConfigError'
    this.fields = fields
  }
}

/**
 * Deep merge source into target. Source values override target values.
 * Arrays from source replace target arrays (no concatenation).
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = result[key]
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }
  return result
}

/**
 * Coerce string values to appropriate types.
 * Environment variables are always strings; this converts numeric strings
 * and boolean strings to their proper types.
 */
function coerceValue(value: string): string | number | boolean {
  // Boolean coercion
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false

  // Numeric coercion (integers and floats)
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)

  return value
}

/**
 * Find the actual key in an object that matches the given key case-insensitively.
 * Returns the original-cased key if found, or the input key if no match exists.
 */
function findCaseInsensitiveKey(obj: Record<string, unknown>, key: string): string {
  const lowerKey = key.toLowerCase()
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lowerKey) return k
  }
  return key
}

/**
 * Set a nested value in an object using a path array.
 * Resolves each path segment case-insensitively against existing keys.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const resolvedKey = findCaseInsensitiveKey(current, path[i])
    if (!(resolvedKey in current) || typeof current[resolvedKey] !== 'object' || current[resolvedKey] === null) {
      current[resolvedKey] = {}
    }
    current = current[resolvedKey] as Record<string, unknown>
  }
  const finalKey = findCaseInsensitiveKey(current, path[path.length - 1])
  current[finalKey] = value
}

/**
 * Apply NEURON_ prefixed environment variable overrides to config.
 * Double underscores (__) indicate nested paths:
 *   NEURON_SERVER__PORT=8080 -> config.server.port = 8080
 */
function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const prefix = 'NEURON_'
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue
    const pathStr = key.slice(prefix.length).toLowerCase()
    const path = pathStr.split('__')
    setNestedValue(config, path, coerceValue(value))
  }
  return config
}

/**
 * Recursively freeze an object and all nested objects.
 */
function deepFreeze<T extends Record<string, unknown>>(obj: T): Readonly<T> {
  Object.freeze(obj)
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as Record<string, unknown>)
    }
  }
  return obj
}

/**
 * Load, validate, and return a frozen NeuronConfig.
 *
 * Pipeline: read file -> parse JSON -> merge defaults -> apply env overrides
 *           -> validate against TypeBox schema -> validate NPI -> freeze
 *
 * @param configPath - Path to neuron.config.json
 * @returns Frozen, validated NeuronConfig
 * @throws ConfigError with field-level details on validation failure
 */
export function loadConfig(configPath: string): NeuronConfig {
  // 1. Read file
  let rawContent: string
  try {
    rawContent = readFileSync(configPath, 'utf-8')
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new ConfigError(`Configuration file not found: ${configPath}`)
    }
    throw new ConfigError(`Failed to read configuration file: ${configPath}`)
  }

  // 2. Parse JSON
  let userConfig: Record<string, unknown>
  try {
    userConfig = JSON.parse(rawContent) as Record<string, unknown>
  } catch {
    throw new ConfigError(`Invalid JSON in configuration file: ${configPath}`)
  }

  // 3. Merge with defaults (deep clone to avoid frozen default objects)
  let config = JSON.parse(JSON.stringify(
    deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      userConfig,
    ),
  )) as Record<string, unknown>

  // 4. Apply environment variable overrides
  config = applyEnvOverrides(config)

  // 5. Validate with TypeBox
  if (!Value.Check(NeuronConfigSchema, config)) {
    const errors = [...Value.Errors(NeuronConfigSchema, config)]
    const fields = errors.map((e) => ({
      path: e.path,
      message: e.message,
    }))
    const fieldMessages = fields.map((f) => `  - ${f.path}: ${f.message}`).join('\n')
    throw new ConfigError(`Configuration invalid:\n${fieldMessages}`, fields)
  }

  const validConfig = config as unknown as NeuronConfig

  // 6. Validate NPI with Luhn check
  if (!isValidNpi(validConfig.organization.npi)) {
    throw new ConfigError(
      `Invalid NPI "${validConfig.organization.npi}": fails Luhn check digit validation`,
      [{ path: '/organization/npi', message: 'fails Luhn check digit validation' }],
    )
  }

  // 7. Freeze and return
  return deepFreeze(validConfig as unknown as Record<string, unknown>) as unknown as NeuronConfig
}
