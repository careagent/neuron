import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Command } from 'commander'
import { loadConfig, ConfigError } from '../../config/index.js'
import { SqliteStorage } from '../../storage/index.js'
import { AuditLogger } from '../../audit/index.js'
import { output } from '../output.js'

/**
 * Register the `start` command on the Commander program.
 *
 * Loads configuration, initializes storage, starts audit logging,
 * and keeps the process alive.
 */
export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Neuron server')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action((options: { config: string }) => {
      // 1. Load and validate configuration
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

      output.info('Configuration loaded')

      // 2. Ensure data directory exists
      mkdirSync(dirname(config.storage.path), { recursive: true })

      // 3. Initialize storage
      const storage = new SqliteStorage(config.storage.path)
      storage.initialize()
      output.info(`Storage initialized: ${config.storage.path}`)

      // 4. Start audit logging if enabled
      let auditLogger: AuditLogger | undefined
      if (config.audit.enabled) {
        mkdirSync(dirname(config.audit.path), { recursive: true })
        auditLogger = new AuditLogger(config.audit.path)
        auditLogger.append({
          category: 'admin',
          action: 'neuron_start',
          details: { npi: config.organization.npi },
        })
        output.info(`Audit logging active: ${config.audit.path}`)
      }

      // 5. Report ready
      output.success(`Neuron started for ${config.organization.name} (NPI: ${config.organization.npi})`)

      // 6. Keep alive (Phase 1: no WebSocket server yet)
      const keepAlive = setInterval(() => {}, config.heartbeat.intervalMs)

      // 7. Clean shutdown on signals
      const shutdown = () => {
        clearInterval(keepAlive)
        try {
          storage.close()
        } catch {
          // Ignore close errors during shutdown
        }
        output.info('Neuron stopped')
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
}
