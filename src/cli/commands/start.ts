import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Command } from 'commander'
import { loadConfig, ConfigError } from '../../config/index.js'
import { SqliteStorage } from '../../storage/index.js'
import { AuditLogger } from '../../audit/index.js'
import { startIpcServer, getSocketPath, type IpcHandler } from '../../ipc/index.js'
import { AxonRegistrationService } from '../../registration/index.js'
import type { IpcCommand, IpcResponse } from '../../ipc/index.js'
import { output } from '../output.js'

/**
 * Register the `start` command on the Commander program.
 *
 * Loads configuration, initializes storage, starts audit logging,
 * starts IPC server, registers with Axon, and starts heartbeat.
 */
export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Neuron server')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (options: { config: string }) => {
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

      // 5. Start IPC server
      const socketPath = getSocketPath(config.storage.path)

      // Registration service must be declared before IPC handler (handler references it)
      // but started after IPC server is listening.
      const registrationService = new AxonRegistrationService(
        config,
        storage,
        auditLogger,
      )

      const ipcHandler: IpcHandler = async (command: IpcCommand): Promise<IpcResponse> => {
        try {
          switch (command.type) {
            case 'provider.add': {
              await registrationService.addProvider(command.npi)
              return { ok: true, data: { npi: command.npi } }
            }
            case 'provider.remove': {
              await registrationService.removeProvider(command.npi)
              return { ok: true }
            }
            case 'provider.list': {
              const providers = registrationService.listProviders()
              return {
                ok: true,
                data: providers.map((p) => ({
                  npi: p.provider_npi,
                  status: p.registration_status,
                  last_heartbeat: p.last_heartbeat_at ?? 'Never',
                })),
              }
            }
            case 'status': {
              const status = registrationService.getStatus()
              return { ok: true, data: status }
            }
            default:
              return { ok: false, error: 'Unknown command' }
          }
        } catch (err) {
          return { ok: false, error: String(err) }
        }
      }

      const ipcServer = startIpcServer(socketPath, ipcHandler)
      output.info(`IPC server listening: ${socketPath}`)

      // 6. Start Axon registration
      try {
        await registrationService.start()
        const status = registrationService.getStatus()
        if (status.neuron?.registration_id) {
          output.success(`Registered with Axon (ID: ${status.neuron.registration_id})`)
        } else {
          output.warn('Axon unreachable — running in degraded mode, will retry')
        }
      } catch {
        output.warn('Axon unreachable — running in degraded mode, will retry')
      }

      // 7. Report ready
      output.success(`Neuron started for ${config.organization.name} (NPI: ${config.organization.npi})`)

      // 8. Keep alive
      const keepAlive = setInterval(() => {}, config.heartbeat.intervalMs)

      // 9. Clean shutdown on signals
      const shutdown = async () => {
        clearInterval(keepAlive)

        // Stop registration service (stops heartbeat)
        try {
          await registrationService.stop()
        } catch {
          // Ignore stop errors during shutdown
        }

        // Close IPC server
        ipcServer.close()

        // Remove socket file
        try {
          unlinkSync(socketPath)
        } catch {
          // Socket may already be cleaned up
        }

        // Close storage
        try {
          storage.close()
        } catch {
          // Ignore close errors during shutdown
        }

        output.info('Neuron stopped')
        process.exit(0)
      }

      process.on('SIGINT', () => void shutdown())
      process.on('SIGTERM', () => void shutdown())
    })
}
