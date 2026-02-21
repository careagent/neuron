import { existsSync, writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { DEFAULT_CONFIG } from '../../config/index.js'
import { output } from '../output.js'

/**
 * Register the `init` command on the Commander program.
 *
 * Generates a starter neuron.config.json with placeholder values.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new Neuron configuration')
    .option('-o, --output <path>', 'output file path', 'neuron.config.json')
    .action((options: { output: string }) => {
      const configPath = options.output

      if (existsSync(configPath)) {
        output.warn(`Configuration file already exists: ${configPath}`)
        output.warn('Use a different path with --output or remove the existing file.')
        process.exit(1)
        return
      }

      const starterConfig = {
        organization: {
          npi: '0000000000',
          name: 'My Organization',
          type: 'practice' as const,
        },
        server: DEFAULT_CONFIG.server,
        storage: DEFAULT_CONFIG.storage,
        audit: DEFAULT_CONFIG.audit,
        localNetwork: DEFAULT_CONFIG.localNetwork,
        heartbeat: DEFAULT_CONFIG.heartbeat,
      }

      writeFileSync(configPath, JSON.stringify(starterConfig, null, 2) + '\n')
      output.info(`Configuration written to ${configPath}`)
      output.info('Edit the file to set your organization NPI and details, then run: neuron start')
    })
}
