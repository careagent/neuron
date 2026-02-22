import net from 'node:net'
import path from 'node:path'
import { unlinkSync } from 'node:fs'
import type { IpcCommand, IpcResponse } from './protocol.js'

/** Handler function invoked for each validated IPC command. */
export type IpcHandler = (command: IpcCommand) => Promise<IpcResponse>

/**
 * Start an IPC server on a Unix domain socket.
 *
 * Protocol: NDJSON — one JSON object per line, newline-delimited.
 * Each connection may send multiple commands sequentially.
 *
 * Stale socket files are removed on startup to prevent EADDRINUSE after crash.
 */
export function startIpcServer(socketPath: string, handler: IpcHandler): net.Server {
  // Clean up stale socket file (pitfall: crash leaves orphan socket)
  try {
    unlinkSync(socketPath)
  } catch {
    // Socket file doesn't exist — expected on first run
  }

  const server = net.createServer((connection) => {
    let buffer = ''

    connection.on('data', (chunk) => {
      buffer += chunk.toString()

      // Split by newline — NDJSON protocol
      const lines = buffer.split('\n')
      // Keep the last (potentially incomplete) segment in buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue

        void processLine(trimmed, connection, handler)
      }
    })

    connection.on('error', () => {
      // Client disconnected — ignore
    })
  })

  server.listen(socketPath)
  return server
}

async function processLine(
  line: string,
  connection: net.Socket,
  handler: IpcHandler,
): Promise<void> {
  let command: IpcCommand
  try {
    command = JSON.parse(line) as IpcCommand
  } catch {
    const errorResponse: IpcResponse = { ok: false, error: 'invalid json' }
    connection.write(JSON.stringify(errorResponse) + '\n')
    return
  }

  try {
    const response = await handler(command)
    connection.write(JSON.stringify(response) + '\n')
  } catch (err) {
    const errorResponse: IpcResponse = { ok: false, error: String(err) }
    connection.write(JSON.stringify(errorResponse) + '\n')
  }
}

/**
 * Derive the IPC socket path from the storage database path.
 *
 * Places `neuron.sock` in the same directory as the database file.
 * This avoids hardcoded /tmp paths and prevents multi-user collisions.
 */
export function getSocketPath(storagePath: string): string {
  return path.join(path.dirname(storagePath), 'neuron.sock')
}
