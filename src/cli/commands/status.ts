import type { Command } from 'commander'
import { sendIpcCommand, getSocketPath } from '../../ipc/index.js'
import { loadConfig, ConfigError } from '../../config/index.js'
import { output } from '../output.js'

/** Status response shape from the IPC server. */
interface StatusData {
  neuron: {
    organization_npi: string
    organization_name: string
    status: string
    registration_id?: string
    last_heartbeat_at?: string
    providers: Array<{
      provider_npi: string
      registration_status: string
      last_heartbeat_at?: string
    }>
  } | null
  heartbeat: 'healthy' | 'degraded'
}

/**
 * Register the `status` command on the Commander program.
 *
 * Connects to the running Neuron via IPC and displays registration state,
 * heartbeat status, Axon connectivity, and provider list.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Neuron server status')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (options: { config: string }) => {
      // Derive socket path from config
      let socketPath: string
      try {
        const config = loadConfig(options.config)
        socketPath = getSocketPath(config.storage.path)
      } catch {
        socketPath = getSocketPath('./data/neuron.db')
      }

      try {
        const response = await sendIpcCommand<StatusData>(socketPath, {
          type: 'status',
        })

        if (!response.ok || !response.data) {
          output.error(response.error ?? 'Failed to get status')
          process.exit(1)
          return
        }

        const data = response.data as StatusData
        const neuron = data.neuron

        output.info('Neuron Status')
        output.info('')

        if (neuron) {
          output.info(`Organization: ${neuron.organization_name} (NPI: ${neuron.organization_npi})`)
          output.info(`Axon Registration: ${neuron.status}`)
          output.info(`Registration ID: ${neuron.registration_id ?? 'N/A'}`)
          output.info(`Heartbeat: ${data.heartbeat}`)
          output.info(`Last Heartbeat: ${neuron.last_heartbeat_at ?? 'Never'}`)
          output.info(`Axon Connectivity: ${data.heartbeat === 'healthy' ? 'reachable' : 'unreachable'}`)
          output.info('')

          if (neuron.providers.length > 0) {
            output.info('Providers:')
            output.table(
              neuron.providers.map((p) => ({
                NPI: p.provider_npi,
                Status: p.registration_status,
                'Last Heartbeat': p.last_heartbeat_at ?? 'Never',
              })),
            )
          } else {
            output.info('Providers: None')
          }
        } else {
          output.info('Neuron is running but not yet registered')
          output.info(`Heartbeat: ${data.heartbeat}`)
        }
      } catch {
        output.info('Neuron is not running')
      }
    })
}
