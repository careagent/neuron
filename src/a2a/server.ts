/**
 * A2A JSON-RPC 2.0 Server for Neuron.
 *
 * Implements the core A2A methods: message/send, tasks/get, tasks/cancel,
 * and message/stream. Tasks are stored in-memory keyed by task ID.
 */

import { randomUUID } from 'node:crypto'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  Task,
  Message,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
} from '@careagent/a2a-types'
import { A2A_METHODS } from '@careagent/a2a-types'
import type { AuditLogger } from '../audit/logger.js'
import type { NeuronProtocolServer } from '../routing/server.js'

/** JSON-RPC 2.0 error codes */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
} as const

export interface A2AServerDeps {
  auditLogger?: AuditLogger
  protocolServer?: NeuronProtocolServer
}

export class A2AServer {
  private readonly tasks: Map<string, Task> = new Map()
  private readonly sessionIndex: Map<string, Set<string>> = new Map()
  private readonly deps: A2AServerDeps

  constructor(deps: A2AServerDeps = {}) {
    this.deps = deps
  }

  /** Handle a JSON-RPC 2.0 request and return a response. */
  handle(request: JsonRpcRequest): JsonRpcResponse {
    // Validate basic JSON-RPC structure
    if (request.jsonrpc !== '2.0' || !request.method || request.id === undefined) {
      return this.errorResponse(
        request.id ?? null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid JSON-RPC 2.0 request',
      )
    }

    switch (request.method) {
      case A2A_METHODS.SEND_MESSAGE:
        return this.handleSendMessage(request)

      case A2A_METHODS.GET_TASK:
        return this.handleGetTask(request)

      case A2A_METHODS.CANCEL_TASK:
        return this.handleCancelTask(request)

      case A2A_METHODS.SEND_STREAMING_MESSAGE:
        // Return the initial acknowledgement — caller is responsible for SSE setup
        return this.handleSendMessage(request)

      default:
        return this.errorResponse(
          request.id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Unknown method: ${request.method}`,
        )
    }
  }

  /** Get a task by ID. Returns undefined if not found. */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  /** Get all tasks for a given session. */
  getSessionTasks(sessionId: string): Task[] {
    const taskIds = this.sessionIndex.get(sessionId)
    if (!taskIds) return []

    const tasks: Task[] = []
    for (const id of taskIds) {
      const task = this.tasks.get(id)
      if (task) tasks.push(task)
    }
    return tasks
  }

  // --- Private method handlers ---

  private handleSendMessage(request: JsonRpcRequest): JsonRpcResponse {
    const params = request.params as unknown as SendMessageParams | undefined

    if (!params || !params.message) {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        'Missing required params: message',
      )
    }

    const taskId = params.id || randomUUID()
    const existingTask = this.tasks.get(taskId)

    if (existingTask) {
      // Append message to existing task history
      if (!existingTask.history) {
        existingTask.history = []
      }
      existingTask.history.push(params.message)
      existingTask.status = {
        state: 'working',
        message: params.message,
        timestamp: new Date().toISOString(),
      }

      this.auditLog('message_appended', { task_id: taskId })
      return this.successResponse(request.id, existingTask)
    }

    // Create new task
    const task: Task = {
      id: taskId,
      sessionId: params.sessionId,
      status: {
        state: 'submitted',
        message: params.message,
        timestamp: new Date().toISOString(),
      },
      history: [params.message],
      metadata: params.metadata,
    }

    this.tasks.set(taskId, task)

    // Index by session
    if (params.sessionId) {
      let sessionTasks = this.sessionIndex.get(params.sessionId)
      if (!sessionTasks) {
        sessionTasks = new Set()
        this.sessionIndex.set(params.sessionId, sessionTasks)
      }
      sessionTasks.add(taskId)
    }

    this.auditLog('task_created', { task_id: taskId, session_id: params.sessionId })
    return this.successResponse(request.id, task)
  }

  private handleGetTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = request.params as unknown as GetTaskParams | undefined

    if (!params || !params.id) {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        'Missing required params: id',
      )
    }

    const task = this.tasks.get(params.id)
    if (!task) {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.TASK_NOT_FOUND,
        `Task not found: ${params.id}`,
      )
    }

    return this.successResponse(request.id, task)
  }

  private handleCancelTask(request: JsonRpcRequest): JsonRpcResponse {
    const params = request.params as unknown as CancelTaskParams | undefined

    if (!params || !params.id) {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        'Missing required params: id',
      )
    }

    const task = this.tasks.get(params.id)
    if (!task) {
      return this.errorResponse(
        request.id,
        JSON_RPC_ERRORS.TASK_NOT_FOUND,
        `Task not found: ${params.id}`,
      )
    }

    task.status = {
      state: 'canceled',
      timestamp: new Date().toISOString(),
    }

    this.auditLog('task_canceled', { task_id: params.id })
    return this.successResponse(request.id, task)
  }

  // --- Helpers ---

  private successResponse(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
  }

  private errorResponse(
    id: string | number | null,
    code: number,
    message: string,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }
  }

  private auditLog(action: string, details?: Record<string, unknown>): void {
    if (this.deps.auditLogger) {
      this.deps.auditLogger.append({
        category: 'connection',
        action,
        details,
      })
    }
  }
}
