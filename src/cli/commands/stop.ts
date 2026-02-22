import type { Command } from 'commander'
import { sendIpcCommand, getSocketPath } from '../../ipc/index.js'
import type { IpcCommand } from '../../ipc/index.js'
import { loadConfig } from '../../config/index.js'
import { output } from '../output.js'

/**
 * Register the `stop` command on the Commander program.
 *
 * Sends a shutdown signal to the running Neuron via IPC.
 * Idempotent: exits 0 even if the server is not running.
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the Neuron server')
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
        const response = await sendIpcCommand(socketPath, { type: 'shutdown' } as IpcCommand)

        if (!response.ok) {
          output.error(response.error ?? 'Failed to stop Neuron')
          process.exit(1)
          return
        }

        output.info('Neuron stopped')
      } catch {
        // Server not running — idempotent stop
        output.info('Neuron is not running')
      }
    })
}
