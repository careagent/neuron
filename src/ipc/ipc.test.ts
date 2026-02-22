import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { mkdtempSync, unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { startIpcServer, sendIpcCommand, getSocketPath } from './index.js'
import type { IpcCommand, IpcResponse, IpcHandler } from './index.js'

function tempSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'neuron-ipc-test-'))
  return join(dir, `test-${randomBytes(4).toString('hex')}.sock`)
}

describe('IPC', () => {
  let server: net.Server | undefined
  let socketPath: string | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve())
      })
      server = undefined
    }
    if (socketPath) {
      try {
        unlinkSync(socketPath)
      } catch {
        // Already cleaned up
      }
      // Clean up temp directory
      try {
        rmSync(join(socketPath, '..'), { recursive: true, force: true })
      } catch {
        // Ignore
      }
      socketPath = undefined
    }
  })

  describe('round-trip', () => {
    it('should send a command and receive a response', async () => {
      socketPath = tempSocketPath()
      const handler: IpcHandler = async (cmd) => {
        return { ok: true, data: { echo: cmd.type } }
      }

      server = startIpcServer(socketPath, handler)
      await new Promise<void>((resolve) => {
        server!.on('listening', resolve)
      })

      const response = await sendIpcCommand<{ echo: string }>(socketPath, { type: 'status' })

      expect(response.ok).toBe(true)
      expect(response.data).toEqual({ echo: 'status' })
    })
  })

  describe('client errors', () => {
    it('should reject with "not running" when socket does not exist', async () => {
      const missingSocket = join(tmpdir(), `nonexistent-${randomBytes(4).toString('hex')}.sock`)

      await expect(
        sendIpcCommand(missingSocket, { type: 'status' }),
      ).rejects.toThrow('Neuron is not running (socket not found)')
    })
  })

  describe('invalid JSON handling', () => {
    it('should respond with error for garbage data', async () => {
      socketPath = tempSocketPath()
      const handler: IpcHandler = async () => {
        return { ok: true }
      }

      server = startIpcServer(socketPath, handler)
      await new Promise<void>((resolve) => {
        server!.on('listening', resolve)
      })

      const response = await new Promise<IpcResponse>((resolve, reject) => {
        let buffer = ''
        const socket = net.createConnection({ path: socketPath! }, () => {
          socket.write('not valid json\n')
        })

        socket.on('data', (chunk) => {
          buffer += chunk.toString()
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim()
            socket.destroy()
            resolve(JSON.parse(line) as IpcResponse)
          }
        })

        socket.on('error', reject)
        socket.setTimeout(5000, () => {
          socket.destroy()
          reject(new Error('Timed out waiting for invalid JSON response'))
        })
      })

      expect(response.ok).toBe(false)
      expect(response.error).toBe('invalid json')
    })
  })

  describe('multiple sequential commands', () => {
    it('should handle multiple commands on the same server', async () => {
      socketPath = tempSocketPath()
      const handler: IpcHandler = async (cmd) => {
        if (cmd.type === 'provider.add') {
          return { ok: true, data: { added: (cmd as IpcCommand & { npi: string }).npi } }
        }
        if (cmd.type === 'provider.list') {
          return { ok: true, data: { providers: [] } }
        }
        return { ok: true }
      }

      server = startIpcServer(socketPath, handler)
      await new Promise<void>((resolve) => {
        server!.on('listening', resolve)
      })

      const addResponse = await sendIpcCommand<{ added: string }>(socketPath, {
        type: 'provider.add',
        npi: '1234567893',
      })
      expect(addResponse.ok).toBe(true)
      expect(addResponse.data).toEqual({ added: '1234567893' })

      const listResponse = await sendIpcCommand<{ providers: unknown[] }>(socketPath, {
        type: 'provider.list',
      })
      expect(listResponse.ok).toBe(true)
      expect(listResponse.data).toEqual({ providers: [] })
    })
  })

  describe('getSocketPath', () => {
    it('should derive socket path from storage path', () => {
      const result = getSocketPath('./data/neuron.db')
      expect(result).toBe('data/neuron.sock')
    })

    it('should handle absolute paths', () => {
      const result = getSocketPath('/var/lib/neuron/neuron.db')
      expect(result).toBe('/var/lib/neuron/neuron.sock')
    })

    it('should handle nested directories', () => {
      const result = getSocketPath('/home/user/.neuron/data/store.db')
      expect(result).toBe('/home/user/.neuron/data/neuron.sock')
    })
  })
})
