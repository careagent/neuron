/**
 * HTTP utility functions matching Axon's sendJson/readBody pattern.
 *
 * Source: /Users/medomatic/Documents/Projects/axon/src/mock/server.ts
 * Replicated in Neuron for REST API consistency.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Send a JSON response with the given status code.
 * Sets Content-Type to application/json and ends the response.
 */
export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Read the full request body as a string.
 * Collects chunks and resolves when the request ends.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
