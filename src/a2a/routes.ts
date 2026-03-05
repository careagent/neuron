/**
 * A2A route handlers for integration into the Neuron HTTP server.
 *
 * These handlers manage the A2A JSON-RPC endpoint, Agent Card discovery,
 * and SSE streaming. They are designed to be called from the main router
 * or directly from an HTTP server request handler.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentCard } from '@careagent/a2a-types'
import { sendJson, readBody } from '../api/http-utils.js'
import type { A2AServer } from './server.js'
import { streamTaskUpdates } from './sse.js'

/**
 * Handle POST /a2a — JSON-RPC 2.0 endpoint.
 *
 * Reads the request body, parses it as JSON-RPC, delegates to the A2A server,
 * and writes the response.
 */
export function handleA2ARequest(
  req: IncomingMessage,
  res: ServerResponse,
  server: A2AServer,
): void {
  readBody(req).then(
    (body) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        return
      }

      const request = parsed as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }

      // Basic structural validation
      if (!request.jsonrpc || !request.method || request.id === undefined) {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
        })
        return
      }

      const response = server.handle(request as Parameters<A2AServer['handle']>[0])
      sendJson(res, 200, response)
    },
    () => {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
    },
  )
}

/**
 * Handle GET /.well-known/agent.json — Agent Card discovery.
 *
 * Serves the pre-generated Agent Card as JSON with appropriate caching headers.
 */
export function handleAgentCard(res: ServerResponse, card: AgentCard): void {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  })
  res.end(JSON.stringify(card))
}

/**
 * Handle POST /a2a/stream — SSE streaming endpoint.
 *
 * Reads the JSON-RPC request body, processes the initial message via the
 * A2A server, then streams task updates via SSE until the task reaches
 * a terminal state or the client disconnects.
 */
export function handleA2AStream(
  req: IncomingMessage,
  res: ServerResponse,
  server: A2AServer,
): void {
  readBody(req).then(
    (body) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        return
      }

      const request = parsed as Parameters<A2AServer['handle']>[0]

      // Process the initial message to create/update the task
      const response = server.handle(request)

      // If there was an error, return it as regular JSON
      if (response.error) {
        sendJson(res, 200, response)
        return
      }

      // Extract task ID from result and begin streaming
      const task = response.result as { id?: string } | undefined
      if (!task?.id) {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: 'Internal error: no task ID in result' },
        })
        return
      }

      streamTaskUpdates(res, task.id, server)
    },
    () => {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })
    },
  )
}
