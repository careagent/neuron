/**
 * A2A Agent Card generator for Neuron instances.
 *
 * Generates an Agent Card conforming to the A2A specification with
 * CareAgent-specific extensions, and provides an HTTP handler to serve
 * the card at the well-known discovery endpoint.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentCard } from '@careagent/a2a-types'
import type { NeuronConfig } from '../types/config.js'

export interface AgentCardOptions {
  config: NeuronConfig
  organizationName: string
  organizationNpi: string
  endpoint: string
  providers?: Array<{
    npi: string
    name: string
    specialty?: string
    provider_type?: string
  }>
}

/** Generate an A2A Agent Card for this Neuron instance. */
export function generateAgentCard(options: AgentCardOptions): AgentCard {
  const { organizationName, organizationNpi, endpoint, providers } = options

  const card: AgentCard = {
    id: `neuron-${organizationNpi}`,
    name: organizationName,
    description: `CareAgent Neuron — ${organizationName}`,
    version: '1.0.0',
    url: endpoint,
    capabilities: [
      {
        name: 'clinical-consultation',
        description: 'Broker clinical consultations between patient and provider agents',
      },
      {
        name: 'appointment-scheduling',
        description: 'Coordinate appointment scheduling through provider agents',
      },
      {
        name: 'consent-brokering',
        description: 'Manage consent handshake between patient and provider agents',
      },
    ],
    authentication: {
      scheme: 'bearer',
    },
    provider: {
      organization: organizationName,
    },
    careagent: {
      practice_npi: organizationNpi,
      organization: organizationName,
      consent_required: true,
    },
  }

  // Attach provider metadata if available
  if (providers && providers.length > 0) {
    const first = providers[0]
    if (first.specialty) {
      card.careagent!.specialty = first.specialty
    }
    if (first.provider_type) {
      card.careagent!.provider_type = first.provider_type
    }
  }

  return card
}

/**
 * Create an HTTP handler that serves the Agent Card as JSON.
 * Intended for mounting at `/.well-known/agent.json`.
 */
export function agentCardHandler(card: AgentCard): (_req: IncomingMessage, res: ServerResponse) => void {
  const body = JSON.stringify(card)

  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    })
    res.end(body)
  }
}
