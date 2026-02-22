import net from 'node:net'
import type { IpcCommand, IpcResponse } from './protocol.js'

/**
 * Send a single IPC command to the Neuron server over Unix domain socket.
 *
 * Connects, sends the command as NDJSON, waits for the first response line,
 * then disconnects.
 *
 * @param socketPath - Path to the Unix domain socket file
 * @param command - The IPC command to send
 * @returns The parsed IPC response
 *
 * @throws When the server is not running (ENOENT or ECONNREFUSED)
 * @throws When the command times out (5 seconds)
 */
export function sendIpcCommand<T = unknown>(
  socketPath: string,
  command: IpcCommand,
): Promise<IpcResponse & { data?: T }> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false

    const socket = net.createConnection({ path: socketPath }, () => {
      socket.write(JSON.stringify(command) + '\n')
    })

    socket.setTimeout(5000, () => {
      if (!settled) {
        settled = true
        socket.destroy()
        reject(new Error('IPC command timed out — is the Neuron running?'))
      }
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString()

      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        if (line.length > 0 && !settled) {
          settled = true
          try {
            const response = JSON.parse(line) as IpcResponse & { data?: T }
            socket.destroy()
            resolve(response)
          } catch {
            socket.destroy()
            reject(new Error('Invalid JSON response from server'))
          }
        }
      }
    })

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true

      if (err.code === 'ENOENT') {
        reject(new Error('Neuron is not running (socket not found)'))
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error('Neuron is not running (connection refused)'))
      } else {
        reject(err)
      }
    })
  })
}
