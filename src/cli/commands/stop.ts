import type { Command } from 'commander'
import { output } from '../output.js'

/**
 * Register the `stop` command on the Commander program.
 *
 * Phase 1 stub: server runs in foreground, use Ctrl+C to stop.
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the Neuron server')
    .action(() => {
      output.info('Stop command not yet implemented (server runs in foreground, use Ctrl+C)')
    })
}
