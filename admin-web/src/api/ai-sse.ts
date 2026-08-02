import type { AiDebugRequestBody, AiDebugSseEvent } from '@/types/ai'
import { getHttpAccessToken, httpBaseURL } from '@/api/http/client'
import { B_ADMIN_CLIENT } from '@/types/auth'
import { HttpRequestError } from '@/types/error'

const DEBUG_CHAT_URL = '/api/v1/platform/ai/debug/chat'
const KNOWN_SSE_EVENTS = new Set(['message', 'progress', 'delta', 'done', 'stopped', 'error'])

/** 拼接基础地址与接口路径，避免 baseURL 尾斜杠导致的双斜杠（与 axios combineURLs 行为一致）。 */
function joinApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** 单个 SSE 帧（event 行 + data 行）。 */
export interface DebugSseFrame {
  event: string
  data: string
}

/** 解析单个帧文本（event:/data: 行，无空行分隔符）。 */
export function parseDebugSseFrameText(frameText: string): DebugSseFrame | null {
  let event = ''
  const dataLines: string[] = []
  for (const line of frameText.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    }
    else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  if (dataLines.length === 0) {
    return null
  }
  return { event, data: dataLines.join('\n') }
}

/** 将 SSE 帧转为事件；未知事件或非法 JSON 返回 null。 */
export function parseDebugSseFrame(frame: DebugSseFrame): AiDebugSseEvent | null {
  if (!KNOWN_SSE_EVENTS.has(frame.event)) {
    return null
  }
  try {
    return { type: frame.event as AiDebugSseEvent['type'], data: JSON.parse(frame.data) }
  }
  catch {
    return null
  }
}

/**
 * 创建有状态的 SSE 流解析器：按 `\n\n` 切分完整帧，跨 chunk 自动缓冲残帧。
 * 每个返回的事件对应一次 onEvent 回调。
 */
export function createDebugSseParser(): (chunk: string) => AiDebugSseEvent[] {
  let buffer = ''
  return (chunk: string): AiDebugSseEvent[] => {
    buffer += chunk
    const events: AiDebugSseEvent[] = []
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const frameText = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      const frame = parseDebugSseFrameText(frameText)
      const event = frame ? parseDebugSseFrame(frame) : null
      if (event) {
        events.push(event)
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
    return events
  }
}

export interface AiDebugChatStreamOptions {
  signal?: AbortSignal
  /** 每个 SSE 事件回调（message/progress/delta/done/stopped/error）。 */
  onEvent: (event: AiDebugSseEvent) => void
}

/**
 * 发起调试对话（SSE 流式）。
 * 不经过 axios JSON envelope 解包；用户停止时调用方应同时 abort signal 与 stopAiDebugChat。
 * 非 200 响应统一抛 HttpRequestError（含 requestId）。
 */
export async function postAiDebugChat(body: AiDebugRequestBody, options: AiDebugChatStreamOptions): Promise<void> {
  const token = getHttpAccessToken()
  const response = await fetch(joinApiUrl(httpBaseURL, DEBUG_CHAT_URL), {
    method: 'POST',
    headers: {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      ...(token
        ? {
            'Authorization': `Bearer ${token}`,
            'X-Client-Type': B_ADMIN_CLIENT,
          }
        : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    let requestId: string | undefined
    try {
      const payload = await response.json() as { requestId?: string }
      requestId = payload.requestId
    }
    catch {
      // 非 JSON 错误体时仅保留状态码
    }
    throw new HttpRequestError(`调试请求失败（HTTP ${response.status}）`, { requestId, status: response.status })
  }

  if (!response.body) {
    throw new HttpRequestError('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createDebugSseParser()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const text = decoder.decode(value, { stream: true })
      for (const event of parser(text)) {
        options.onEvent(event)
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}
