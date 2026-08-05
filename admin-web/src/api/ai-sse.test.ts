import type { AiDebugSseEvent } from '@/types/ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDebugSseParser,
  parseDebugSseFrame,
  parseDebugSseFrameText,
  postAiDebugChat,
} from './ai-sse'

const JSON_EVENT = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

describe('ai debug sse frame parsing', () => {
  it('parses an event:/data: frame text', () => {
    expect(parseDebugSseFrameText('event: delta\ndata: {"text":"你好"}')).toEqual({
      event: 'delta',
      data: '{"text":"你好"}',
    })
  })

  it('returns null for frames without data lines', () => {
    expect(parseDebugSseFrameText('event: heartbeat')).toBeNull()
  })

  it('maps known frames to typed events and ignores unknown events', () => {
    expect(parseDebugSseFrame({ event: 'done', data: '{"finishReason":"COMPLETED"}' })).toEqual({
      type: 'done',
      data: { finishReason: 'COMPLETED' },
    })
    expect(parseDebugSseFrame({ event: 'unknown', data: '{}' })).toBeNull()
    expect(parseDebugSseFrame({ event: 'delta', data: 'not-json' })).toBeNull()
  })
})

describe('ai debug sse stream parser', () => {
  it('buffers partial frames across chunks and emits only complete events', () => {
    const parser = createDebugSseParser()
    const emitted: AiDebugSseEvent[] = []

    // 第一个 chunk 只带半个帧（无结束空行）
    emitted.push(...parser('event: delta\ndata: {"text":"你'))
    expect(emitted).toEqual([])

    // 第二个 chunk 补完帧内容与空行
    emitted.push(...parser('好"}\n\n'))
    expect(emitted).toEqual([{ type: 'delta', data: { text: '你好' } }])
  })

  it('emits message -> delta -> done in order', () => {
    const parser = createDebugSseParser()
    const chunk = [
      JSON_EVENT('message', { messageId: 'm1', requestId: 'req-1' }),
      JSON_EVENT('delta', { text: 'A' }),
      JSON_EVENT('delta', { text: 'B' }),
      JSON_EVENT('done', {
        messageId: 'm1',
        finishReason: 'COMPLETED',
        usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 },
        model: { id: 'model-1' },
        latencyMs: 300,
      }),
    ].join('')

    expect(parser(chunk).map(event => event.type)).toEqual(['message', 'delta', 'delta', 'done'])
  })

  it('emits stopped and error events and skips malformed data', () => {
    const parser = createDebugSseParser()
    const chunk = [
      'event: stopped\ndata: {"messageId":"m1","partialContent":"部分","content":"部分"}\n\n',
      'event: error\ndata: {"code":"AI_UPSTREAM","message":"上游失败","requestId":"req-1","retryable":true}\n\n',
      'event: progress\ndata: broken-json\n\n',
      'event: progress\ndata: {"stage":"analyzing","message":"分析中"}\n\n',
    ].join('')

    expect(parser(chunk)).toEqual([
      { type: 'stopped', data: { messageId: 'm1', partialContent: '部分', content: '部分' } },
      {
        type: 'error',
        data: { code: 'AI_UPSTREAM', message: '上游失败', requestId: 'req-1', retryable: true },
      },
      { type: 'progress', data: { stage: 'analyzing', message: '分析中' } },
    ])
  })
})

describe('postAiDebugChat streaming', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function readableStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
  }

  it('streams events from a fetch response body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(readableStream([
        JSON_EVENT('message', { messageId: 'm1', requestId: 'req-1' }),
        JSON_EVENT('delta', { text: '结果' }),
        JSON_EVENT('done', { messageId: 'm1', finishReason: 'COMPLETED', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 }, model: { id: 'model-1' }, latencyMs: 10 }),
      ]), { status: 200 }),
    )
    const events: AiDebugSseEvent[] = []
    const onEvent = (event: AiDebugSseEvent) => {
      events.push(event)
    }

    await postAiDebugChat({ scene: 'general_chat', messages: [{ role: 'user', content: 'hi' }] }, { onEvent })

    expect(events.map(event => event.type)).toEqual(['message', 'delta', 'done'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/platform/ai/debug/chat'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    )
  })

  it('throws HttpRequestError with requestId on non-200 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { code: 403 }, requestId: 'req-403' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      postAiDebugChat({ scene: 'general_chat', messages: [{ role: 'user', content: 'hi' }] }, { onEvent: () => {} }),
    ).rejects.toMatchObject({ message: expect.stringContaining('403'), requestId: 'req-403' })
  })

  it('propagates abort signal to fetch', async () => {
    const controller = new AbortController()
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(readableStream([]), { status: 200 }))

    await postAiDebugChat(
      { scene: 'general_chat', messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: () => {}, signal: controller.signal },
    )

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('settles after a terminal event even if the connection stays open', async () => {
    // 后端发送 done 后不关闭连接（keep-alive），前端应在终结事件后主动结束读取
    const encoder = new TextEncoder()
    const openStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON_EVENT('message', { messageId: 'm1', requestId: 'req-1' })))
        controller.enqueue(encoder.encode(JSON_EVENT('done', {
          messageId: 'm1',
          finishReason: 'COMPLETED',
          usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 },
          model: { id: 'model-1' },
          latencyMs: 10,
        })))
        // 故意不调用 controller.close()，模拟服务端挂起连接
      },
    })
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(openStream, { status: 200 }))
    const events: AiDebugSseEvent[] = []
    const onEvent = (event: AiDebugSseEvent) => {
      events.push(event)
    }

    await postAiDebugChat({ scene: 'general_chat', messages: [{ role: 'user', content: 'hi' }] }, { onEvent })

    expect(events.map(event => event.type)).toEqual(['message', 'done'])
  })
})
