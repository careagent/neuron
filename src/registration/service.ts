/**
 * Orchestrator coordinating AxonClient, RegistrationStateStore, and HeartbeatManager.
 *
 * Handles the full registration lifecycle: initial registration, restart
 * idempotency, provider management, heartbeat, and graceful degradation.
 */

import { dirname } from 'node:path'
import type { NeuronConfig } from '../types/config.js'
import type { ProviderRegistration } from '../types/registration.js'
import type { StorageEngine } from '../storage/interface.js'
import type { AuditLogger } from '../audit/logger.js'
import { AxonClient } from './axon-client.js'
import { RegistrationStateStore } from './state.js'
import { HeartbeatManager, writeHealthFile } from './heartbeat.js'

export class AxonRegistrationService {
  private client!: AxonClient
  private stateStore!: RegistrationStateStore
  private heartbeat!: HeartbeatManager

  constructor(
    private readonly config: NeuronConfig,
    private readonly storage: StorageEngine,
    private readonly auditLogger?: AuditLogger,
  ) {}

  /**
   * Start the registration service.
   *
   * 1. Creates AxonClient and RegistrationStateStore
   * 2. Loads existing state -- skips registration if already registered (idempotency)
   * 3. Registers with Axon if not yet registered
   * 4. Starts heartbeat loop
   *
   * If Axon is unreachable on first start, enters degraded mode without crashing.
   */
  async start(): Promise<void> {
    this.client = new AxonClient(this.config.axon.registryUrl)
    this.stateStore = new RegistrationStateStore(this.storage)

    const existingState = this.stateStore.load()
    const dataDir = dirname(this.config.storage.path)

    if (
      existingState &&
      existingState.status === 'registered' &&
      existingState.registration_id
    ) {
      // Already registered -- skip registration (idempotency on restart)
      this.client.setBearerToken(existingState.axon_bearer_token!)

      // Re-register any existing providers from state
      const providers = this.stateStore.listProviders()
      for (const provider of providers) {
        if (provider.registration_status === 'registered') {
          try {
            await this.client.registerProvider(existingState.registration_id, {
              provider_npi: provider.provider_npi,
            })
          } catch {
            // Provider re-registration failure is non-fatal on restart
          }
        }
      }
    } else {
      // First boot or not yet registered -- register with Axon
      try {
        const result = await this.client.registerNeuron({
          organization_npi: this.config.organization.npi,
          organization_name: this.config.organization.name,
          organization_type: this.config.organization.type,
          neuron_endpoint_url: this.config.axon.endpointUrl,
        })

        this.client.setBearerToken(result.bearer_token)

        this.stateStore.save({
          organization_npi: this.config.organization.npi,
          organization_name: this.config.organization.name,
          organization_type: this.config.organization.type,
          axon_registry_url: this.config.axon.registryUrl,
          neuron_endpoint_url: this.config.axon.endpointUrl,
          registration_id: result.registration_id,
          axon_bearer_token: result.bearer_token,
          status: 'registered',
          first_registered_at: new Date().toISOString(),
        })

        // Audit log -- do NOT include bearer_token (pitfall 7)
        this.auditLogger?.append({
          category: 'registration',
          action: 'registration.neuron_registered',
          details: {
            registration_id: result.registration_id,
            organization_npi: this.config.organization.npi,
          },
        })
      } catch {
        // Axon unreachable -- enter degraded mode, do not crash (NREG-06)
        // Save unregistered state so subsequent start attempts can try again
        if (!existingState) {
          this.stateStore.save({
            organization_npi: this.config.organization.npi,
            organization_name: this.config.organization.name,
            organization_type: this.config.organization.type,
            axon_registry_url: this.config.axon.registryUrl,
            neuron_endpoint_url: this.config.axon.endpointUrl,
            status: 'unregistered',
          })
        }
        writeHealthFile(dataDir, 'degraded')
        return
      }
    }

    // Start heartbeat
    this.heartbeat = new HeartbeatManager(
      this.client,
      this.stateStore,
      this.config.axon.backoffCeilingMs,
      (status) => {
        const state = this.stateStore.load()
        writeHealthFile(dataDir, status, state?.last_heartbeat_at)
      },
    )
    this.heartbeat.start()

    // Write initial healthy status
    writeHealthFile(dataDir, 'healthy')
  }

  /** Stop the heartbeat loop. */
  async stop(): Promise<void> {
    this.heartbeat?.stop()
  }

  /**
   * Register a provider with Axon and persist to state.
   */
  async addProvider(npi: string): Promise<void> {
    const state = this.stateStore.load()
    if (!state || !state.registration_id) {
      throw new Error('Cannot add provider: neuron not registered')
    }

    const result = await this.client.registerProvider(state.registration_id, {
      provider_npi: npi,
    })

    this.stateStore.saveProvider({
      provider_npi: npi,
      axon_provider_id: result.provider_id,
      registration_status: 'registered',
      first_registered_at: new Date().toISOString(),
    })

    this.auditLogger?.append({
      category: 'registration',
      action: 'registration.provider_added',
      details: {
        provider_npi: npi,
        axon_provider_id: result.provider_id,
      },
    })
  }

  /**
   * Remove a provider from Axon and delete from state.
   */
  async removeProvider(npi: string): Promise<void> {
    const state = this.stateStore.load()
    if (!state || !state.registration_id) {
      throw new Error('Cannot remove provider: neuron not registered')
    }

    await this.client.removeProvider(state.registration_id, npi)
    this.stateStore.removeProvider(npi)

    this.auditLogger?.append({
      category: 'registration',
      action: 'registration.provider_removed',
      details: { provider_npi: npi },
    })
  }

  /** List all registered providers from state. */
  listProviders(): ProviderRegistration[] {
    return this.stateStore.listProviders()
  }

  /** Get current neuron registration state and heartbeat status. */
  getStatus(): {
    neuron: ReturnType<RegistrationStateStore['load']>
    heartbeat: 'healthy' | 'degraded'
  } {
    return {
      neuron: this.stateStore.load(),
      heartbeat: this.heartbeat?.getStatus() ?? 'degraded',
    }
  }
}
