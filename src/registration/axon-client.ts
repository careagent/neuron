/**
 * Thin HTTP wrapper for the Axon registry API.
 *
 * Stateless aside from the base URL and bearer token. Throws AxonError
 * on non-2xx responses. Does NOT retry on 4xx errors -- only network
 * errors and 5xx warrant retry (handled by heartbeat layer, not client).
 */

/** Typed error thrown on non-ok Axon API responses. */
export class AxonError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'AxonError'
    this.statusCode = statusCode
  }
}

export interface RegisterNeuronPayload {
  organization_npi: string
  organization_name: string
  organization_type: string
  neuron_endpoint_url: string
}

export interface RegisterNeuronResponse {
  registration_id: string
  bearer_token: string
  status: string
}

export interface RegisterProviderPayload {
  provider_npi: string
  provider_name: string
  provider_types: string[]
  specialty?: string
}

export interface RegisterProviderResponse {
  provider_id: string
  status: string
}

export interface RegistrySearchResult {
  npi: string
  entity_type: string
  name: string
  credential_status: string
  provider_types?: string[]
  specialty?: string
  affiliations?: Array<{
    organization_npi: string
    organization_name: string
    neuron_endpoint?: string
  }>
  registered_at: string
  last_updated: string
}

export interface RegistrySearchResponse {
  results: RegistrySearchResult[]
}

export class AxonClient {
  private bearerToken?: string

  constructor(
    private readonly registryUrl: string,
    bearerToken?: string,
  ) {
    this.bearerToken = bearerToken
  }

  /** Update the bearer token (e.g. after initial registration). */
  setBearerToken(token: string): void {
    this.bearerToken = token
  }

  /**
   * Register a neuron with the Axon registry.
   * POST /v1/neurons
   */
  async registerNeuron(payload: RegisterNeuronPayload): Promise<RegisterNeuronResponse> {
    const res = await fetch(`${this.registryUrl}/v1/neurons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new AxonError(`registerNeuron failed: ${res.status}`, res.status)
    }
    return (await res.json()) as RegisterNeuronResponse
  }

  /**
   * Update the neuron's endpoint URL (heartbeat).
   * PUT /v1/neurons/:registrationId/endpoint
   */
  async updateEndpoint(
    registrationId: string,
    payload: { neuron_endpoint_url: string },
  ): Promise<void> {
    const res = await fetch(
      `${this.registryUrl}/v1/neurons/${registrationId}/endpoint`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        },
        body: JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      throw new AxonError(`updateEndpoint failed: ${res.status}`, res.status)
    }
  }

  /**
   * Register a provider through the neuron's registration.
   * POST /v1/neurons/:registrationId/providers
   */
  async registerProvider(
    registrationId: string,
    payload: RegisterProviderPayload,
  ): Promise<RegisterProviderResponse> {
    const res = await fetch(
      `${this.registryUrl}/v1/neurons/${registrationId}/providers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        },
        body: JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      throw new AxonError(`registerProvider failed: ${res.status}`, res.status)
    }
    return (await res.json()) as RegisterProviderResponse
  }

  /**
   * Remove a provider from the neuron's registration.
   * DELETE /v1/neurons/:registrationId/providers/:providerNpi
   */
  async removeProvider(registrationId: string, providerNpi: string): Promise<void> {
    const res = await fetch(
      `${this.registryUrl}/v1/neurons/${registrationId}/providers/${providerNpi}`,
      {
        method: 'DELETE',
        headers: {
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        },
      },
    )
    if (!res.ok) {
      throw new AxonError(`removeProvider failed: ${res.status}`, res.status)
    }
  }

  /**
   * Lookup a registry entry by NPI.
   * GET /v1/registry/:npi
   */
  async lookupByNpi(npi: string): Promise<RegistrySearchResult> {
    const res = await fetch(`${this.registryUrl}/v1/registry/${npi}`)
    if (!res.ok) {
      throw new AxonError(`lookupByNpi failed: ${res.status}`, res.status)
    }
    return (await res.json()) as RegistrySearchResult
  }

  /**
   * Search the registry with optional filters.
   * GET /v1/registry/search
   */
  async search(params?: Record<string, string>): Promise<RegistrySearchResponse> {
    const url = new URL(`${this.registryUrl}/v1/registry/search`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }
    const res = await fetch(url.toString())
    if (!res.ok) {
      throw new AxonError(`search failed: ${res.status}`, res.status)
    }
    return (await res.json()) as RegistrySearchResponse
  }
}
