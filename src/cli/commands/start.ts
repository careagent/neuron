import { mkdirSync, unlinkSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import type { Command } from 'commander'
import { loadConfig, ConfigError } from '../../config/index.js'
import { SqliteStorage } from '../../storage/index.js'
import { AuditLogger } from '../../audit/index.js'
import { startIpcServer, getSocketPath, type IpcHandler } from '../../ipc/index.js'
import { AxonRegistrationService } from '../../registration/index.js'
import { RelationshipStore, TerminationHandler, ConsentHandshakeHandler } from '../../relationships/index.js'
import { NeuronProtocolServer, createConnectionHandler } from '../../routing/index.js'
import { DiscoveryService } from '../../discovery/index.js'
import { ApiKeyStore, TokenBucketRateLimiter, createApiRouter } from '../../api/index.js'
import type { IpcCommand, IpcResponse } from '../../ipc/index.js'
import { output } from '../output.js'

/**
 * Get the first non-internal IPv4 address for mDNS endpoint construction.
 * Falls back to 127.0.0.1 if no suitable address is found.
 */
function getLocalAddress(): string {
  const interfaces = networkInterfaces()
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (!addr.internal && addr.family === 'IPv4') {
        return addr.address
      }
    }
  }
  return '127.0.0.1'
}

/**
 * Register the `start` command on the Commander program.
 *
 * Loads configuration, initializes storage, starts audit logging,
 * starts IPC server, registers with Axon, and starts heartbeat.
 */
export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Neuron server')
    .option('-c, --config <path>', 'configuration file path', 'neuron.config.json')
    .action(async (options: { config: string }) => {
      // 1. Load and validate configuration
      let config
      try {
        config = loadConfig(options.config)
      } catch (err) {
        if (err instanceof ConfigError) {
          output.error(err.message)
          process.exit(1)
          return
        }
        throw err
      }

      output.info('Configuration loaded')

      // 2. Ensure data directory exists
      mkdirSync(dirname(config.storage.path), { recursive: true })

      // 3. Initialize storage
      const storage = new SqliteStorage(config.storage.path)
      storage.initialize()
      output.info(`Storage initialized: ${config.storage.path}`)

      // 4. Start audit logging if enabled
      let auditLogger: AuditLogger | undefined
      if (config.audit.enabled) {
        mkdirSync(dirname(config.audit.path), { recursive: true })
        auditLogger = new AuditLogger(config.audit.path)
        auditLogger.append({
          category: 'admin',
          action: 'neuron_start',
          details: { npi: config.organization.npi },
        })
        output.info(`Audit logging active: ${config.audit.path}`)
      }

      // 5. Start IPC server
      const socketPath = getSocketPath(config.storage.path)

      // Registration service must be declared before IPC handler (handler references it)
      // but started after IPC server is listening.
      const registrationService = new AxonRegistrationService(
        config,
        storage,
        auditLogger,
      )

      // Relationship services for termination via IPC
      const relationshipStore = new RelationshipStore(storage)
      const terminationHandler = new TerminationHandler(storage, relationshipStore, auditLogger)

      const ipcHandler: IpcHandler = async (command: IpcCommand): Promise<IpcResponse> => {
        try {
          switch (command.type) {
            case 'provider.add': {
              await registrationService.addProvider(command.npi)
              return { ok: true, data: { npi: command.npi } }
            }
            case 'provider.remove': {
              await registrationService.removeProvider(command.npi)
              return { ok: true }
            }
            case 'provider.list': {
              const providers = registrationService.listProviders()
              return {
                ok: true,
                data: providers.map((p) => ({
                  npi: p.provider_npi,
                  status: p.registration_status,
                  last_heartbeat: p.last_heartbeat_at ?? 'Never',
                })),
              }
            }
            case 'status': {
              const status = registrationService.getStatus()
              return { ok: true, data: status }
            }
            case 'relationship.terminate': {
              try {
                terminationHandler.terminate(command.relationship_id, command.provider_npi, command.reason)
                return { ok: true, data: { terminated: true, relationship_id: command.relationship_id } }
              } catch (err) {
                return { ok: false, error: (err as Error).message }
              }
            }
            case 'shutdown': {
              auditLogger?.append({
                category: 'admin',
                action: 'neuron_stop',
              })
              // Schedule shutdown after response flushes over the socket
              setTimeout(() => void shutdown(), 100)
              return { ok: true, data: { message: 'Shutting down' } }
            }
            default:
              return { ok: false, error: 'Unknown command' }
          }
        } catch (err) {
          return { ok: false, error: String(err) }
        }
      }

      const ipcServer = startIpcServer(socketPath, ipcHandler)
      output.info(`IPC server listening: ${socketPath}`)

      // 6. Start WebSocket protocol server
      const handshakeHandler = new ConsentHandshakeHandler(
        relationshipStore,
        config.organization.npi,
        auditLogger,
      )

      const protocolServer = new NeuronProtocolServer(
        config,
        handshakeHandler,
        relationshipStore,
        auditLogger,
      )

      const connectionHandler = createConnectionHandler({
        config,
        handshakeHandler,
        relationshipStore,
        sessionManager: protocolServer.getSessionManager(),
        organizationNpi: config.organization.npi,
        neuronEndpointUrl: config.axon.endpointUrl,
        auditLogger,
        onSessionEnd: () => protocolServer.notifySessionEnd(),
      })

      protocolServer.setConnectionHandler(connectionHandler)
      await protocolServer.start(config.server.port)
      output.info(`WebSocket server listening on port ${config.server.port} at ${config.websocket.path}`)

      // 6a. Wire REST API router to HTTP server
      const apiKeyStore = new ApiKeyStore(storage)
      const rateLimiter = new TokenBucketRateLimiter(
        config.api.rateLimit.maxRequests,
        config.api.rateLimit.maxRequests, // refill = max (full refill each window)
        config.api.rateLimit.windowMs,
      )

      const apiRouter = createApiRouter({
        config,
        storage,
        apiKeyStore,
        rateLimiter,
        relationshipStore,
        registrationService,
        protocolServer,
      })

      // Attach to existing HTTP server (from NeuronProtocolServer)
      // HTTP 'request' events are for regular HTTP requests
      // HTTP 'upgrade' events are handled by WebSocket (already wired in protocolServer.start)
      const httpServer = protocolServer.server!
      httpServer.on('request', apiRouter)

      output.info(`REST API active on port ${config.server.port} (/v1/*)`)

      // 6b. Start local network discovery (if enabled)
      let discoveryService: DiscoveryService | null = null
      if (config.localNetwork.enabled) {
        const host = config.server.host === '0.0.0.0' ? getLocalAddress() : config.server.host
        const endpointUrl = `ws://${host}:${config.server.port}${config.websocket.path}`
        discoveryService = new DiscoveryService({
          enabled: true,
          serviceType: config.localNetwork.serviceType,
          protocolVersion: config.localNetwork.protocolVersion,
          organizationNpi: config.organization.npi,
          serverPort: config.server.port,
          endpointUrl,
        })
        await discoveryService.start()

        // Log advertising interfaces (info-level per user decision)
        const interfaces = networkInterfaces()
        for (const [name, addrs] of Object.entries(interfaces)) {
          if (!addrs) continue
          for (const addr of addrs) {
            if (!addr.internal && addr.family === 'IPv4') {
              output.info(`Advertising on ${name}: ${addr.address}`)
            }
          }
        }
        output.info(`Local discovery active: _${config.localNetwork.serviceType}._tcp`)
      } else {
        output.info('Local network discovery disabled')
      }

      // 7. Start Axon registration
      try {
        await registrationService.start()
        const status = registrationService.getStatus()
        if (status.neuron?.registration_id) {
          output.success(`Registered with Axon (ID: ${status.neuron.registration_id})`)
        } else {
          output.warn('Axon unreachable — running in degraded mode, will retry')
        }
      } catch {
        output.warn('Axon unreachable — running in degraded mode, will retry')
      }

      // 8. Report ready
      output.success(`Neuron started for ${config.organization.name} (NPI: ${config.organization.npi})`)

      // 9. Keep alive
      const keepAlive = setInterval(() => {}, config.heartbeat.intervalMs)

      // 10. Clean shutdown on signals
      const shutdown = async () => {
        clearInterval(keepAlive)

        // Stop local discovery first (sends goodbye packets)
        if (discoveryService) {
          try {
            await discoveryService.stop()
          } catch {
            // Ignore stop errors during shutdown
          }
        }

        // Stop WebSocket server (closes all active handshake connections)
        try {
          await protocolServer.stop()
        } catch {
          // Ignore stop errors during shutdown
        }

        // Stop registration service (stops heartbeat)
        try {
          await registrationService.stop()
        } catch {
          // Ignore stop errors during shutdown
        }

        // Close IPC server
        ipcServer.close()

        // Remove socket file
        try {
          unlinkSync(socketPath)
        } catch {
          // Socket may already be cleaned up
        }

        // Close storage
        try {
          storage.close()
        } catch {
          // Ignore close errors during shutdown
        }

        output.info('Neuron stopped')
        process.exit(0)
      }

      process.on('SIGINT', () => void shutdown())
      process.on('SIGTERM', () => void shutdown())
    })
}
