import { describe, it, expect } from 'vitest'
import type { JsonRpcRequest } from '@careagent/a2a-types'
import { A2A_METHODS } from '@careagent/a2a-types'
import { A2AServer } from './server.js'

function sendMessageRequest(overrides?: Partial<JsonRpcRequest> & { params?: Record<string, unknown> }): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: '1',
    method: A2A_METHODS.SEND_MESSAGE,
    params: {
      id: 'task-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      },
      ...overrides?.params,
    },
    ...overrides,
  }
}

function getTaskRequest(taskId: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: '2',
    method: A2A_METHODS.GET_TASK,
    params: { id: taskId },
  }
}

function cancelTaskRequest(taskId: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: '3',
    method: A2A_METHODS.CANCEL_TASK,
    params: { id: taskId },
  }
}

describe('A2AServer', () => {
  describe('message/send', () => {
    it('creates a new task', () => {
      const server = new A2AServer()
      const response = server.handle(sendMessageRequest())

      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe('1')
      expect(response.error).toBeUndefined()

      const task = response.result as { id: string; status: { state: string }; history: unknown[] }
      expect(task.id).toBe('task-1')
      expect(task.status.state).toBe('submitted')
      expect(task.history).toHaveLength(1)
    })

    it('appends to existing task history on second send', () => {
      const server = new A2AServer()

      // Create task
      server.handle(sendMessageRequest())

      // Send second message to same task
      const response = server.handle(sendMessageRequest({
        id: '2',
        params: {
          id: 'task-1',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: 'World' }],
          },
        },
      }))

      const task = response.result as { id: string; status: { state: string }; history: unknown[] }
      expect(task.id).toBe('task-1')
      expect(task.status.state).toBe('working')
      expect(task.history).toHaveLength(2)
    })

    it('assigns a generated task ID when none provided', () => {
      const server = new A2AServer()
      const response = server.handle({
        jsonrpc: '2.0',
        id: '1',
        method: A2A_METHODS.SEND_MESSAGE,
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        },
      })

      const task = response.result as { id: string }
      expect(task.id).toBeTruthy()
      expect(task.id.length).toBeGreaterThan(0)
    })

    it('returns error when message is missing', () => {
      const server = new A2AServer()
      const response = server.handle({
        jsonrpc: '2.0',
        id: '1',
        method: A2A_METHODS.SEND_MESSAGE,
        params: { id: 'task-1' },
      })

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32602)
    })

    it('indexes tasks by session', () => {
      const server = new A2AServer()
      server.handle(sendMessageRequest({
        params: {
          id: 'task-a',
          sessionId: 'session-1',
          message: { role: 'user', parts: [{ type: 'text', text: 'A' }] },
        },
      }))
      server.handle(sendMessageRequest({
        id: '2',
        params: {
          id: 'task-b',
          sessionId: 'session-1',
          message: { role: 'user', parts: [{ type: 'text', text: 'B' }] },
        },
      }))

      const sessionTasks = server.getSessionTasks('session-1')
      expect(sessionTasks).toHaveLength(2)
      expect(sessionTasks.map((t) => t.id).sort()).toEqual(['task-a', 'task-b'])
    })
  })

  describe('tasks/get', () => {
    it('returns a task by ID', () => {
      const server = new A2AServer()
      server.handle(sendMessageRequest())

      const response = server.handle(getTaskRequest('task-1'))

      expect(response.error).toBeUndefined()
      const task = response.result as { id: string }
      expect(task.id).toBe('task-1')
    })

    it('returns error for unknown task ID', () => {
      const server = new A2AServer()
      const response = server.handle(getTaskRequest('nonexistent'))

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32001)
      expect(response.error!.message).toContain('nonexistent')
    })

    it('returns error when id param is missing', () => {
      const server = new A2AServer()
      const response = server.handle({
        jsonrpc: '2.0',
        id: '1',
        method: A2A_METHODS.GET_TASK,
        params: {},
      })

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32602)
    })
  })

  describe('tasks/cancel', () => {
    it('sets task state to canceled', () => {
      const server = new A2AServer()
      server.handle(sendMessageRequest())

      const response = server.handle(cancelTaskRequest('task-1'))

      expect(response.error).toBeUndefined()
      const task = response.result as { id: string; status: { state: string } }
      expect(task.status.state).toBe('canceled')
    })

    it('returns error for unknown task', () => {
      const server = new A2AServer()
      const response = server.handle(cancelTaskRequest('nonexistent'))

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32001)
    })
  })

  describe('unknown method', () => {
    it('returns method not found error', () => {
      const server = new A2AServer()
      const response = server.handle({
        jsonrpc: '2.0',
        id: '1',
        method: 'unknown/method',
      })

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32601)
      expect(response.error!.message).toContain('unknown/method')
    })
  })

  describe('invalid request', () => {
    it('returns invalid request error for missing jsonrpc field', () => {
      const server = new A2AServer()
      const response = server.handle({
        jsonrpc: '1.0' as '2.0',
        id: '1',
        method: A2A_METHODS.SEND_MESSAGE,
      })

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32600)
    })
  })

  describe('getSessionTasks', () => {
    it('returns empty array for unknown session', () => {
      const server = new A2AServer()
      expect(server.getSessionTasks('nonexistent')).toEqual([])
    })
  })

  describe('getTask', () => {
    it('returns undefined for unknown task', () => {
      const server = new A2AServer()
      expect(server.getTask('nonexistent')).toBeUndefined()
    })
  })
})
