import type { Command } from 'commander'
import { verifyAuditChain } from '../../audit/index.js'
import { loadConfig } from '../../config/index.js'
import { output } from '../output.js'

/**
 * Register the `verify-audit` command on the Commander program.
 *
 * Runs audit chain integrity verification and reports results.
 * Exit code 0 on valid/empty chain, exit code 1 on integrity failure.
 */
export function registerVerifyAuditCommand(program: Command): void {
  program
    .command('verify-audit')
    .description('Verify audit log chain integrity')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .option('-p, --path <path>', 'explicit audit log file path (overrides config)')
    .action((options: { config: string; path?: string }) => {
      // Resolve audit path
      let auditPath: string

      if (options.path) {
        auditPath = options.path
      } else {
        try {
          const config = loadConfig(options.config)
          auditPath = config.audit.path
        } catch {
          output.error('Could not load configuration to determine audit log path. Use --path to specify directly.')
          process.exit(1)
          return
        }
      }

      // Run verification
      const result = verifyAuditChain(auditPath)

      if (result.entries === 0) {
        output.info('Audit log is empty (no entries)')
        return
      }

      if (result.valid) {
        output.success(`Audit chain verified: ${result.entries} entries, chain intact`)
        return
      }

      // Chain broken
      output.error('Audit chain BROKEN')
      for (const e of result.errors) {
        output.error(`  Line ${e.line}: ${e.error}`)
      }
      output.info(`${result.entries} entries checked, ${result.errors.length} error(s) found`)
      process.exit(1)
    })
}
