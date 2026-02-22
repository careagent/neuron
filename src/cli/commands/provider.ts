import { createInterface } from 'node:readline'
import type { Command } from 'commander'
import { sendIpcCommand, getSocketPath } from '../../ipc/index.js'
import { isValidNpi } from '../../validators/npi.js'
import { loadConfig, ConfigError } from '../../config/index.js'
import { output } from '../output.js'

/**
 * Load config and derive the IPC socket path.
 *
 * Reads the config file path from the parent program's --config option,
 * defaulting to 'neuron.config.json'. Falls back to default socket path
 * if config cannot be loaded.
 */
function resolveSocketPath(program: Command): string {
  const configPath =
    (program.parent?.opts()?.config as string | undefined) ??
    'neuron.config.json'
  try {
    const config = loadConfig(configPath)
    return getSocketPath(config.storage.path)
  } catch {
    // Fall back to default socket path if config is unavailable
    return getSocketPath('./data/neuron.db')
  }
}

/**
 * Register the `provider` command group on the Commander program.
 *
 * Subcommands:
 *   - provider add <npi>    Register a provider with Axon immediately
 *   - provider remove <npi> Unregister a provider from Axon (with confirmation)
 *   - provider list         Show all registered providers in table format
 */
export function registerProviderCommand(program: Command): void {
  const provider = program
    .command('provider')
    .description('Manage providers')

  // --- provider add <npi> ---
  provider
    .command('add <npi>')
    .description('Register a provider with Axon')
    .action(async (npi: string) => {
      if (!isValidNpi(npi)) {
        output.error(`Invalid NPI: ${npi}`)
        process.exit(1)
        return
      }

      const socketPath = resolveSocketPath(provider)

      try {
        const response = await sendIpcCommand(socketPath, {
          type: 'provider.add',
          npi,
        })

        if (response.ok) {
          output.success(`Provider ${npi} registered with Axon`)
        } else {
          output.error(response.error ?? 'Registration failed')
          process.exit(1)
        }
      } catch {
        output.error('Could not connect to Neuron — is it running?')
        process.exit(1)
      }
    })

  // --- provider list ---
  provider
    .command('list')
    .description('List registered providers')
    .action(async () => {
      const socketPath = resolveSocketPath(provider)

      try {
        const response = await sendIpcCommand<
          Array<{ npi: string; status: string; last_heartbeat: string }>
        >(socketPath, { type: 'provider.list' })

        if (response.ok && response.data) {
          const providers = response.data as Array<{
            npi: string
            status: string
            last_heartbeat: string
          }>
          if (providers.length === 0) {
            output.info('No providers registered')
          } else {
            output.table(
              providers.map((p) => ({
                NPI: p.npi,
                Status: p.status,
                'Last Heartbeat': p.last_heartbeat,
              })),
            )
          }
        } else {
          output.error(response.error ?? 'Failed to list providers')
          process.exit(1)
        }
      } catch {
        output.error('Could not connect to Neuron — is it running?')
        process.exit(1)
      }
    })

  // --- provider remove <npi> ---
  provider
    .command('remove <npi>')
    .description('Unregister a provider from Axon')
    .action(async (npi: string) => {
      if (!isValidNpi(npi)) {
        output.error(`Invalid NPI: ${npi}`)
        process.exit(1)
        return
      }

      // Interactive confirmation (locked decision: always confirm before unregistering)
      const confirmed = await new Promise<boolean>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        })
        rl.question(
          `Remove provider ${npi}? This will unregister from Axon. (y/N): `,
          (answer) => {
            rl.close()
            resolve(answer.trim().toLowerCase() === 'y')
          },
        )
      })

      if (!confirmed) {
        output.info('Cancelled')
        return
      }

      const socketPath = resolveSocketPath(provider)

      try {
        const response = await sendIpcCommand(socketPath, {
          type: 'provider.remove',
          npi,
        })

        if (response.ok) {
          output.success(`Provider ${npi} removed and unregistered from Axon`)
        } else {
          output.error(response.error ?? 'Removal failed')
          process.exit(1)
        }
      } catch {
        output.error('Could not connect to Neuron — is it running?')
        process.exit(1)
      }
    })
}
