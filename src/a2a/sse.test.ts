import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSSEStream, streamTaskUpdates } from './sse.js'
import { A2AServer } from './server.js'
import { A2A_METHODS } from '@careagent/a2a-types'

function mockResponse(): {
  writeHead: ReturnType<typeof vi.fn>
  flushHeaders: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
} {
  return {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  }
}

describe('createSSEStream', () => {
  it('sets correct SSE headers', () => {
    const res = mockResponse()
    createSSEStream(res as unknown as Parameters<typeof createSSEStream>[0])

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
  })

  it('flushes headers immediately', () => {
    const res = mockResponse()
    createSSEStream(res as unknown as Parameters<typeof createSSEStream>[0])

    expect(res.flushHeaders).toHaveBeenCalled()
  })

  it('formats events correctly with event name and data', () => {
    const res = mockResponse()
    const sse = createSSEStream(res as unknown as Parameters<typeof createSSEStream>[0])

    sse.send('task', { id: 'task-1', status: 'working' })

    expect(res.write).toHaveBeenCalledWith(
      'event: task\ndata: {"id":"task-1","status":"working"}\n\n',
    )
  })

  it('handles string data without double-serializing', () => {
    const res = mockResponse()
    const sse = createSSEStream(res as unknown as Parameters<typeof createSSEStream>[0])

    sse.send('ping', 'hello')

    expect(res.write).toHaveBeenCalledWith('event: ping\ndata: hello\n\n')
  })

  it('closes the response on close()', () => {
    const res = mockResponse()
    const sse = createSSEStream(res as unknown as Parameters<typeof createSSEStream>[0])

    sse.close()

    expect(res.end).toHaveBeenCalled()
  })
})

describe('streamTaskUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends initial task state', () => {
    const server = new A2AServer()
    server.handle({
      jsonrpc: '2.0',
      id: '1',
      method: A2A_METHODS.SEND_MESSAGE,
      params: {
        id: 'task-1',
        message: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      },
    })

    const res = mockResponse()
    streamTaskUpdates(res as unknown as Parameters<typeof streamTaskUpdates>[0], 'task-1', server)

    // Should have written the initial task event
    expect(res.write).toHaveBeenCalled()
    const firstCall = res.write.mock.calls[0][0] as string
    expect(firstCall).toMatch(/^event: task\ndata:/)
    expect(firstCall).toContain('task-1')
  })

  it('sends error and closes for unknown task', () => {
    const server = new A2AServer()
    const res = mockResponse()

    streamTaskUpdates(res as unknown as Parameters<typeof streamTaskUpdates>[0], 'nonexistent', server)

    const written = res.write.mock.calls[0][0] as string
    expect(written).toMatch(/event: error/)
    expect(res.end).toHaveBeenCalled()
  })

  it('closes immediately for terminal task state', () => {
    const server = new A2AServer()
    server.handle({
      jsonrpc: '2.0',
      id: '1',
      method: A2A_METHODS.SEND_MESSAGE,
      params: {
        id: 'task-1',
        message: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      },
    })
    // Cancel the task so it's in terminal state
    server.handle({
      jsonrpc: '2.0',
      id: '2',
      method: A2A_METHODS.CANCEL_TASK,
      params: { id: 'task-1' },
    })

    const res = mockResponse()
    streamTaskUpdates(res as unknown as Parameters<typeof streamTaskUpdates>[0], 'task-1', server)

    // Should send initial state then close
    expect(res.write).toHaveBeenCalled()
    expect(res.end).toHaveBeenCalled()
  })

  it('registers cleanup on client disconnect', () => {
    const server = new A2AServer()
    server.handle({
      jsonrpc: '2.0',
      id: '1',
      method: A2A_METHODS.SEND_MESSAGE,
      params: {
        id: 'task-1',
        message: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      },
    })

    const res = mockResponse()
    streamTaskUpdates(res as unknown as Parameters<typeof streamTaskUpdates>[0], 'task-1', server)

    // Should register a 'close' listener for cleanup
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function))
  })
})
