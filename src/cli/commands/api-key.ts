/**
 * CLI commands for REST API key management.
 *
 * Subcommands:
 *   - api-key create --name <name>  Generate a new API key
 *   - api-key revoke <key-id>       Revoke an API key
 *   - api-key list                  List all API keys
 *
 * API key commands work OFFLINE (direct SQLite access, no IPC to running server).
 * Keys are stored in SQLite and can be managed without the Neuron running.
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Command } from 'commander'
import { loadConfig, ConfigError } from '../../config/index.js'
import { SqliteStorage } from '../../storage/index.js'
import { ApiKeyStore } from '../../api/index.js'
import { output } from '../output.js'

/** Ensure the data directory exists and open a storage connection. */
function openStorage(storagePath: string): SqliteStorage {
  mkdirSync(dirname(storagePath), { recursive: true })
  const storage = new SqliteStorage(storagePath)
  storage.initialize()
  return storage
}

/**
 * Register the `api-key` command group on the Commander program.
 */
export function registerApiKeyCommand(program: Command): void {
  const apiKey = program
    .command('api-key')
    .description('Manage REST API keys')

  // --- api-key create ---
  apiKey
    .command('create')
    .description('Create a new API key')
    .requiredOption('--name <name>', 'Name/label for this API key')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (options: { name: string; config: string }) => {
      let config
      try {
        config = loadConfig(options.config)
      } catch (err) {
        if (err instanceof ConfigError) {
          output.error(err.message)
          process.exit(1)
          return
        }
        throw err
      }

      const storage = openStorage(config.storage.path)
      const apiKeyStore = new ApiKeyStore(storage)

      const result = apiKeyStore.create(options.name)

      output.success('API key created')
      output.info(`Key ID: ${result.keyId}`)
      output.info(`API Key: ${result.raw}`)
      output.warn('Save this key now — it cannot be retrieved later')

      storage.close()
    })

  // --- api-key revoke ---
  apiKey
    .command('revoke <key-id>')
    .description('Revoke an API key')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (keyId: string, options: { config: string }) => {
      let config
      try {
        config = loadConfig(options.config)
      } catch (err) {
        if (err instanceof ConfigError) {
          output.error(err.message)
          process.exit(1)
          return
        }
        throw err
      }

      const storage = openStorage(config.storage.path)
      const apiKeyStore = new ApiKeyStore(storage)

      apiKeyStore.revoke(keyId)
      output.success(`API key ${keyId} revoked`)

      storage.close()
    })

  // --- api-key list ---
  apiKey
    .command('list')
    .description('List all API keys')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (options: { config: string }) => {
      let config
      try {
        config = loadConfig(options.config)
      } catch (err) {
        if (err instanceof ConfigError) {
          output.error(err.message)
          process.exit(1)
          return
        }
        throw err
      }

      const storage = openStorage(config.storage.path)
      const apiKeyStore = new ApiKeyStore(storage)

      const keys = apiKeyStore.list()
      if (keys.length === 0) {
        output.info('No API keys')
        storage.close()
        return
      }

      for (const key of keys) {
        const status = key.revoked_at ? 'REVOKED' : 'active'
        const lastUsed = key.last_used_at ?? 'Never'
        output.info(`${key.key_id}  ${key.name}  [${status}]  Last used: ${lastUsed}`)
      }

      storage.close()
    })
}
