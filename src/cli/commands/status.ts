import type { Command } from 'commander'
import { output } from '../output.js'

/**
 * Register the `status` command on the Commander program.
 *
 * Phase 1 stub: no background process monitoring yet.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Neuron server status')
    .action(() => {
      output.info('Status command not yet implemented')
    })
}
