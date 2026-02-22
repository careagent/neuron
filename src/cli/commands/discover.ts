/**
 * `neuron discover` CLI command -- scan local network for Neuron services via mDNS.
 *
 * Uses bonjour-service to browse for `_careagent-neuron._tcp` services.
 * One-shot mode with configurable timeout (default 3 seconds).
 */

import type { Command } from 'commander'
import { Bonjour } from 'bonjour-service'
import { output } from '../output.js'

export function registerDiscoverCommand(program: Command): void {
  program
    .command('discover')
    .description('Scan local network for Neuron services via mDNS')
    .option('-t, --timeout <ms>', 'scan duration in milliseconds', '3000')
    .option('--type <service>', 'service type to browse', 'careagent-neuron')
    .action((options: { timeout: string; type: string }) => {
      const timeoutMs = parseInt(options.timeout, 10)
      if (isNaN(timeoutMs) || timeoutMs < 500) {
        output.error('Timeout must be at least 500ms')
        process.exit(1)
        return
      }

      output.info(`Scanning for _${options.type}._tcp services (${timeoutMs}ms)...`)

      const bonjour = new Bonjour()
      const browser = bonjour.find({ type: options.type })
      let found = 0

      browser.on('up', (service) => {
        found++
        const txt = service.txt as Record<string, string> | undefined
        output.info('')
        output.success(`${service.name}`)
        output.info(`  NPI:      ${txt?.npi ?? 'unknown'}`)
        output.info(`  Version:  ${txt?.ver ?? 'unknown'}`)
        output.info(`  Endpoint: ${txt?.ep ?? 'unknown'}`)
        output.info(`  Host:     ${service.host}:${service.port}`)
      })

      setTimeout(() => {
        browser.stop()
        bonjour.destroy()
        output.info('')
        if (found === 0) {
          output.info('No Neuron services found on the local network')
        } else {
          output.info(`Found ${found} Neuron service(s)`)
        }
      }, timeoutMs)
    })
}
