import { describe, it, expect, vi } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { AgentCardSchema } from '@careagent/a2a-types'
import type { AgentCard } from '@careagent/a2a-types'
import { generateAgentCard, agentCardHandler } from './agent-card.js'
import type { AgentCardOptions } from './agent-card.js'
import type { NeuronConfig } from '../types/config.js'

/** Minimal NeuronConfig for tests */
function makeConfig(): NeuronConfig {
  return {
    organization: { npi: '1234567893', name: 'Test Clinic', type: 'clinic' },
    server: { port: 3000, host: '0.0.0.0' },
    websocket: {
      path: '/ws/handshake',
      maxConcurrentHandshakes: 10,
      authTimeoutMs: 10000,
      queueTimeoutMs: 30000,
      maxPayloadBytes: 65536,
    },
    storage: { path: './data/neuron.db' },
    audit: { path: './data/audit.jsonl', enabled: true },
    localNetwork: { enabled: false, serviceType: 'careagent-neuron', protocolVersion: 'v1.0' },
    heartbeat: { intervalMs: 60000 },
    axon: { registryUrl: 'http://localhost:9999', endpointUrl: 'http://localhost:3000', backoffCeilingMs: 300000 },
    api: { rateLimit: { maxRequests: 100, windowMs: 60000 }, cors: { allowedOrigins: [] } },
  }
}

function makeOptions(overrides?: Partial<AgentCardOptions>): AgentCardOptions {
  return {
    config: makeConfig(),
    organizationName: 'Southeastern Spine Institute',
    organizationNpi: '1134943459',
    endpoint: 'http://46.202.178.111:3000',
    ...overrides,
  }
}

describe('generateAgentCard', () => {
  it('generates a valid Agent Card matching AgentCardSchema', () => {
    const card = generateAgentCard(makeOptions())
    // Value.Check may not support 'uri' format validation, so we filter out format errors
    const errors = [...Value.Errors(AgentCardSchema, card)].filter(
      (e) => !e.message.includes('Unknown format'),
    )
    expect(errors).toEqual([])
    // Verify the card is structurally assignable to AgentCard
    const _typeCheck: AgentCard = card
    expect(_typeCheck).toBeDefined()
  })

  it('sets correct id from organization NPI', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.id).toBe('neuron-1134943459')
  })

  it('sets name to organization name', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.name).toBe('Southeastern Spine Institute')
  })

  it('sets description with organization name', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.description).toBe('CareAgent Neuron — Southeastern Spine Institute')
  })

  it('includes correct capabilities', () => {
    const card = generateAgentCard(makeOptions())
    const capNames = card.capabilities.map((c) => c.name)
    expect(capNames).toContain('clinical-consultation')
    expect(capNames).toContain('appointment-scheduling')
    expect(capNames).toContain('consent-brokering')
    expect(card.capabilities).toHaveLength(3)
  })

  it('includes CareAgent metadata with consent_required', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.careagent).toBeDefined()
    expect(card.careagent!.practice_npi).toBe('1134943459')
    expect(card.careagent!.organization).toBe('Southeastern Spine Institute')
    expect(card.careagent!.consent_required).toBe(true)
  })

  it('sets authentication scheme to bearer', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.authentication).toEqual({ scheme: 'bearer' })
  })

  it('sets provider organization', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.provider).toEqual({ organization: 'Southeastern Spine Institute' })
  })

  it('includes provider specialty when providers are specified', () => {
    const card = generateAgentCard(makeOptions({
      providers: [
        { npi: '1275609489', name: 'Dr. Anderson', specialty: 'neurosurgery', provider_type: 'MD' },
      ],
    }))
    expect(card.careagent!.specialty).toBe('neurosurgery')
    expect(card.careagent!.provider_type).toBe('MD')
  })

  it('omits provider specialty when no providers', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.careagent!.specialty).toBeUndefined()
    expect(card.careagent!.provider_type).toBeUndefined()
  })

  it('sets version to 1.0.0', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.version).toBe('1.0.0')
  })

  it('sets url to endpoint', () => {
    const card = generateAgentCard(makeOptions())
    expect(card.url).toBe('http://46.202.178.111:3000')
  })
})

describe('agentCardHandler', () => {
  function mockRes(): {
    res: {
      writeHead: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }
  } {
    return {
      res: {
        writeHead: vi.fn(),
        end: vi.fn(),
      },
    }
  }

  it('serves correct JSON with application/json Content-Type', () => {
    const card = generateAgentCard(makeOptions())
    const handler = agentCardHandler(card)
    const { res } = mockRes()

    handler(null as unknown as Parameters<typeof handler>[0], res as unknown as Parameters<typeof handler>[1])

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    })
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(card))
  })

  it('returns parseable JSON matching the original card', () => {
    const card = generateAgentCard(makeOptions())
    const handler = agentCardHandler(card)
    const { res } = mockRes()

    handler(null as unknown as Parameters<typeof handler>[0], res as unknown as Parameters<typeof handler>[1])

    const body = res.end.mock.calls[0][0] as string
    const parsed = JSON.parse(body)
    expect(parsed.id).toBe(card.id)
    expect(parsed.name).toBe(card.name)
    expect(parsed.url).toBe(card.url)
  })
})
