#!/usr/bin/env node
import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerStartCommand } from './commands/start.js'
import { registerStopCommand } from './commands/stop.js'
import { registerStatusCommand } from './commands/status.js'
import { registerProviderCommand } from './commands/provider.js'
import { registerDiscoverCommand } from './commands/discover.js'

const program = new Command()

program
  .name('neuron')
  .description('CareAgent organizational boundary server')
  .version('0.1.0')

registerInitCommand(program)
registerStartCommand(program)
registerStopCommand(program)
registerStatusCommand(program)
registerProviderCommand(program)
registerDiscoverCommand(program)

export { program }

program.parse()
