import http from 'node:http'
import { randomUUID } from 'node:crypto'

interface NeuronRecord {
  registration_id: string
  organization_npi: string
  organization_name: string
  organization_type: string
  neuron_endpoint_url: string
  bearer_token: string
  status: string
  providers: Map<string, { provider_id: string; provider_npi: string }>
}

/**
 * Create a standalone mock Axon HTTP server for integration testing.
 *
 * Uses in-memory state (fresh per run) for test reliability.
 * Implements happy-path-only routes matching the expected Axon API contract.
 */
export function createMockAxonServer(port: number): http.Server {
  const neurons = new Map<string, NeuronRecord>()

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }

  function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url!, `http://localhost:${port}`)
    const { pathname } = url

    try {
      // POST /v1/neurons -- register neuron
      if (req.method === 'POST' && pathname === '/v1/neurons') {
        const body = await readBody(req)
        const payload = JSON.parse(body)
        const registrationId = randomUUID()
        const bearerToken = `mock-token-${registrationId}`

        neurons.set(registrationId, {
          registration_id: registrationId,
          organization_npi: payload.organization_npi,
          organization_name: payload.organization_name,
          organization_type: payload.organization_type,
          neuron_endpoint_url: payload.neuron_endpoint_url,
          bearer_token: bearerToken,
          status: 'reachable',
          providers: new Map(),
        })

        sendJson(res, 201, {
          registration_id: registrationId,
          bearer_token: bearerToken,
          status: 'reachable',
        })
        return
      }

      // PUT /v1/neurons/:id/endpoint -- heartbeat / endpoint update
      const endpointMatch = pathname.match(/^\/v1\/neurons\/([^/]+)\/endpoint$/)
      if (req.method === 'PUT' && endpointMatch) {
        const neuron = neurons.get(endpointMatch[1])
        if (!neuron) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const body = await readBody(req)
        const payload = JSON.parse(body)
        if (payload.neuron_endpoint_url) {
          neuron.neuron_endpoint_url = payload.neuron_endpoint_url
        }
        neuron.status = 'reachable'
        sendJson(res, 200, { status: 'reachable' })
        return
      }

      // POST /v1/neurons/:id/providers -- register provider
      const providersPostMatch = pathname.match(/^\/v1\/neurons\/([^/]+)\/providers$/)
      if (req.method === 'POST' && providersPostMatch) {
        const neuron = neurons.get(providersPostMatch[1])
        if (!neuron) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const body = await readBody(req)
        const payload = JSON.parse(body)
        const providerId = randomUUID()
        neuron.providers.set(payload.provider_npi, {
          provider_id: providerId,
          provider_npi: payload.provider_npi,
        })
        sendJson(res, 201, { provider_id: providerId, status: 'registered' })
        return
      }

      // DELETE /v1/neurons/:id/providers/:npi -- remove provider
      const providerDeleteMatch = pathname.match(/^\/v1\/neurons\/([^/]+)\/providers\/([^/]+)$/)
      if (req.method === 'DELETE' && providerDeleteMatch) {
        const neuron = neurons.get(providerDeleteMatch[1])
        if (!neuron) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        neuron.providers.delete(providerDeleteMatch[2])
        res.writeHead(204)
        res.end()
        return
      }

      // GET /v1/neurons/:id -- get neuron state (useful for test assertions)
      const neuronGetMatch = pathname.match(/^\/v1\/neurons\/([^/]+)$/)
      if (req.method === 'GET' && neuronGetMatch) {
        const neuron = neurons.get(neuronGetMatch[1])
        if (!neuron) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        sendJson(res, 200, {
          registration_id: neuron.registration_id,
          organization_npi: neuron.organization_npi,
          organization_name: neuron.organization_name,
          organization_type: neuron.organization_type,
          neuron_endpoint_url: neuron.neuron_endpoint_url,
          status: neuron.status,
          providers: Array.from(neuron.providers.values()),
        })
        return
      }

      // Default: 404
      sendJson(res, 404, { error: 'not found' })
    } catch {
      sendJson(res, 500, { error: 'internal server error' })
    }
  })

  server.listen(port)
  return server
}
