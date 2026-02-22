import { createMockAxonServer } from './server.js'

const portFlag = process.argv.indexOf('--port')
const port = portFlag !== -1 ? Number(process.argv[portFlag + 1]) : 9999

if (Number.isNaN(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${process.argv[portFlag + 1]}`)
  process.exit(1)
}

const server = createMockAxonServer(port)

server.on('listening', () => {
  console.log(`mock-axon ready on port ${port}`)
})

function shutdown() {
  server.close(() => {
    process.exit(0)
  })
  // Force exit after 3 seconds if graceful shutdown hangs
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
