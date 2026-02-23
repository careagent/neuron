/**
 * SQLite read/write for registration state.
 *
 * Provides CRUD for the neuron_registration single-row table
 * and the provider_registrations multi-row table via the
 * StorageEngine interface.
 */

import type { StorageEngine } from '../storage/interface.js'
import type {
  NeuronRegistrationState,
  ProviderRegistration,
} from '../types/registration.js'

/** Row shape for neuron_registration table reads. */
interface NeuronRegistrationRow {
  organization_npi: string
  organization_name: string
  organization_type: string
  axon_registry_url: string
  neuron_endpoint_url: string
  registration_id: string | null
  axon_bearer_token: string | null
  status: string
  first_registered_at: string | null
  last_heartbeat_at: string | null
  last_axon_response_at: string | null
}

/** Row shape for provider_registrations table reads. */
interface ProviderRegistrationRow {
  provider_npi: string
  provider_name: string | null
  provider_types: string | null
  specialty: string | null
  axon_provider_id: string | null
  registration_status: string
  first_registered_at: string | null
  last_heartbeat_at: string | null
  last_axon_response_at: string | null
}

export class RegistrationStateStore {
  constructor(private readonly storage: StorageEngine) {}

  /**
   * Load the neuron registration state from SQLite.
   * Returns null if no registration row exists.
   */
  load(): NeuronRegistrationState | null {
    const row = this.storage.get<NeuronRegistrationRow>(
      'SELECT * FROM neuron_registration WHERE id = 1',
    )
    if (!row) return null

    const providers = this.listProviders()

    return {
      organization_npi: row.organization_npi,
      organization_name: row.organization_name,
      organization_type: row.organization_type,
      axon_registry_url: row.axon_registry_url,
      neuron_endpoint_url: row.neuron_endpoint_url,
      registration_id: row.registration_id ?? undefined,
      axon_bearer_token: row.axon_bearer_token ?? undefined,
      status: row.status as NeuronRegistrationState['status'],
      first_registered_at: row.first_registered_at ?? undefined,
      last_heartbeat_at: row.last_heartbeat_at ?? undefined,
      last_axon_response_at: row.last_axon_response_at ?? undefined,
      providers,
    }
  }

  /**
   * Save neuron registration state (without providers).
   * Uses INSERT OR REPLACE with id=1 to enforce single-row.
   */
  save(state: Omit<NeuronRegistrationState, 'providers'>): void {
    this.storage.run(
      `INSERT OR REPLACE INTO neuron_registration
        (id, organization_npi, organization_name, organization_type,
         axon_registry_url, neuron_endpoint_url, registration_id,
         axon_bearer_token, status, first_registered_at,
         last_heartbeat_at, last_axon_response_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.organization_npi,
        state.organization_name,
        state.organization_type,
        state.axon_registry_url,
        state.neuron_endpoint_url,
        state.registration_id ?? null,
        state.axon_bearer_token ?? null,
        state.status,
        state.first_registered_at ?? null,
        state.last_heartbeat_at ?? null,
        state.last_axon_response_at ?? null,
      ],
    )
  }

  /**
   * Update heartbeat timestamps on the neuron registration.
   */
  updateHeartbeat(timestamp: string): void {
    this.storage.run(
      'UPDATE neuron_registration SET last_heartbeat_at = ?, last_axon_response_at = ? WHERE id = 1',
      [timestamp, timestamp],
    )
  }

  /**
   * Update the neuron registration status.
   */
  updateStatus(status: string): void {
    this.storage.run(
      'UPDATE neuron_registration SET status = ? WHERE id = 1',
      [status],
    )
  }

  /**
   * Save (insert or replace) a provider registration.
   */
  saveProvider(provider: ProviderRegistration): void {
    this.storage.run(
      `INSERT OR REPLACE INTO provider_registrations
        (provider_npi, provider_name, provider_types, specialty,
         axon_provider_id, registration_status,
         first_registered_at, last_heartbeat_at, last_axon_response_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider.provider_npi,
        provider.provider_name ?? null,
        provider.provider_types ? JSON.stringify(provider.provider_types) : null,
        provider.specialty ?? null,
        provider.axon_provider_id ?? null,
        provider.registration_status,
        provider.first_registered_at ?? null,
        provider.last_heartbeat_at ?? null,
        provider.last_axon_response_at ?? null,
      ],
    )
  }

  /**
   * Remove a provider registration by NPI.
   */
  removeProvider(providerNpi: string): void {
    this.storage.run(
      'DELETE FROM provider_registrations WHERE provider_npi = ?',
      [providerNpi],
    )
  }

  /**
   * List all provider registrations.
   */
  listProviders(): ProviderRegistration[] {
    const rows = this.storage.all<ProviderRegistrationRow>(
      'SELECT * FROM provider_registrations',
    )
    return rows.map((row) => ({
      provider_npi: row.provider_npi,
      provider_name: row.provider_name ?? undefined,
      provider_types: row.provider_types ? JSON.parse(row.provider_types) as string[] : undefined,
      specialty: row.specialty ?? undefined,
      axon_provider_id: row.axon_provider_id ?? undefined,
      registration_status: row.registration_status as ProviderRegistration['registration_status'],
      first_registered_at: row.first_registered_at ?? undefined,
      last_heartbeat_at: row.last_heartbeat_at ?? undefined,
      last_axon_response_at: row.last_axon_response_at ?? undefined,
    }))
  }
}
