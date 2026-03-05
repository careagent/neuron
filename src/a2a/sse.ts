/**
 * SSE (Server-Sent Events) streaming support for A2A task updates.
 *
 * Provides utilities to set up an SSE stream on a ServerResponse
 * and send formatted events to the client.
 */

import type { ServerResponse } from 'node:http'
import type { A2AServer } from './server.js'

export interface SSEWriter {
  /** Send an SSE event with the given event name and data payload. */
  send(event: string, data: unknown): void
  /** Close the SSE stream. */
  close(): void
}

/**
 * Set up SSE headers on a ServerResponse and return a writer.
 *
 * Sets the required headers for SSE (Content-Type, Cache-Control, Connection)
 * and writes the initial 200 status. Returns an SSEWriter for sending events.
 */
export function createSSEStream(res: ServerResponse): SSEWriter {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  // Flush headers immediately
  res.flushHeaders()

  return {
    send(event: string, data: unknown): void {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data)
      res.write(`event: ${event}\ndata: ${serialized}\n\n`)
    },
    close(): void {
      res.end()
    },
  }
}

/**
 * Stream task updates for a given task via SSE.
 *
 * Sends the current task state immediately, then polls for state changes
 * at a fixed interval. Closes when the task reaches a terminal state
 * (completed, canceled, failed) or the client disconnects.
 */
export function streamTaskUpdates(
  res: ServerResponse,
  taskId: string,
  server: A2AServer,
): void {
  const sse = createSSEStream(res)
  const POLL_INTERVAL_MS = 1000
  const TERMINAL_STATES = new Set(['completed', 'canceled', 'failed'])

  // Send initial state
  const task = server.getTask(taskId)
  if (!task) {
    sse.send('error', { code: -32001, message: `Task not found: ${taskId}` })
    sse.close()
    return
  }

  sse.send('task', task)

  // If already terminal, close immediately
  if (TERMINAL_STATES.has(task.status.state)) {
    sse.close()
    return
  }

  let lastState = task.status.state

  const interval = setInterval(() => {
    const current = server.getTask(taskId)
    if (!current) {
      sse.send('error', { code: -32001, message: `Task disappeared: ${taskId}` })
      clearInterval(interval)
      sse.close()
      return
    }

    // Only send updates when state changes
    if (current.status.state !== lastState) {
      lastState = current.status.state
      sse.send('task', current)

      if (TERMINAL_STATES.has(current.status.state)) {
        clearInterval(interval)
        sse.close()
      }
    }
  }, POLL_INTERVAL_MS)

  // Clean up on client disconnect
  res.on('close', () => {
    clearInterval(interval)
  })
}
