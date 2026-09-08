import { redirectAfterSessionExpiry } from '@/api/core/handlers'

export type ClientPlatform = 'h5' | 'mp-weixin' | 'app' | 'other'

export interface PlatformInfo {
  platform: ClientPlatform
  safeAreaBottom: number
  statusBarHeight: number
  version: string
}

function normalizePlatform(value?: string): ClientPlatform {
  if (value === 'web') {
    return 'h5'
  }
  if (value === 'mp-weixin') {
    return 'mp-weixin'
  }
  if (value === 'app') {
    return 'app'
  }
  return 'other'
}

export function getPlatformInfo(): PlatformInfo {
  const systemInfo = uni.getSystemInfoSync()
  const safeAreaBottom = systemInfo.safeAreaInsets?.bottom || 0

  return {
    platform: normalizePlatform(systemInfo.uniPlatform),
    safeAreaBottom,
    statusBarHeight: systemInfo.statusBarHeight || 0,
    version: systemInfo.appVersion || '',
  }
}

export function getAppVersion() {
  try {
    return getPlatformInfo().version || import.meta.env.VITE_APP_VERSION || '1.0.0'
  }
  catch {
    return import.meta.env.VITE_APP_VERSION || '1.0.0'
  }
}

export function isWechatMiniProgram() {
  return getPlatformInfo().platform === 'mp-weixin'
}

export function isApp() {
  return getPlatformInfo().platform === 'app'
}

export type AiStreamKind = 'send' | 'regenerate'

export interface AiStreamOptions {
  kind: AiStreamKind
  /** kind = 'send' 时必填 */
  conversationId?: string
  /** kind = 'regenerate' 时必填 */
  messageId?: string
  /** kind = 'send' 时必填 */
  content?: string
  accessToken: string
  onEvent: (event: AiStreamEvent) => void
}

export interface AiStreamEvent {
  event: string
  data: Record<string, unknown>
}

function getApiOrigin() {
  // 剥离尾部斜杠：VITE_API_BASE_URL 可能以 / 结尾，直接拼接会产生 //api/v1 导致 404
  return (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function parseEventData(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    return { text: raw }
  }
}

/** 后端 SSE 接口出错时返回 JSON 包络而非 SSE 帧，提取其中的业务错误文案 */
async function readStreamError(response: { status: number, text: () => Promise<string> }) {
  let message = `AI 请求失败（${response.status}）`
  try {
    const body = await response.text()
    // 打印完整错误包络（status / error.code / requestId），便于排查受限内容等 4xx
    console.error('[ai-stream] HTTP 错误', { status: response.status, body })
    const businessError = createStreamBusinessError(body, message)
    if (businessError) {
      return businessError.message
    }
  }
  catch {
    console.error('[ai-stream] HTTP 错误', { status: response.status })
  }
  return message
}

function consumeSseBuffer(buffer: string, onEvent: (event: AiStreamEvent) => void) {
  const frames = buffer.split(/\r?\n\r?\n/)
  const remainder = frames.pop() || ''

  for (const frame of frames) {
    const lines = frame.split(/\r?\n/)
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message'
      }
      else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length) {
      onEvent({ event, data: parseEventData(dataLines.join('\n')) })
    }
  }

  return remainder
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left)
  merged.set(right, left.length)
  return merged
}

function completeUtf8Length(bytes: Uint8Array) {
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index]
    const size = first < 0x80 ? 1 : first < 0xE0 ? 2 : first < 0xF0 ? 3 : 4
    if (index + size > bytes.length) {
      break
    }
    index += size
  }
  return index
}

function decodeUtf8Bytes(bytes: Uint8Array) {
  let result = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]
    if (first < 0x80) {
      result += String.fromCharCode(first)
      index += 1
      continue
    }
    if (first < 0xE0) {
      result += String.fromCharCode(((first & 0x1F) << 6) | (bytes[index + 1] & 0x3F))
      index += 2
      continue
    }
    if (first < 0xF0) {
      result += String.fromCharCode(((first & 0x0F) << 12) | ((bytes[index + 1] & 0x3F) << 6) | (bytes[index + 2] & 0x3F))
      index += 3
      continue
    }
    const codePoint = ((first & 0x07) << 18) | ((bytes[index + 1] & 0x3F) << 12) | ((bytes[index + 2] & 0x3F) << 6) | (bytes[index + 3] & 0x3F)
    result += String.fromCodePoint(codePoint)
    index += 4
  }
  return result
}

function createUtf8ChunkDecoder() {
  const nativeDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null
  let pending = new Uint8Array()

  return (buffer?: ArrayBuffer, final = false) => {
    const chunk = buffer ? new Uint8Array(buffer) : new Uint8Array()
    if (nativeDecoder) {
      return nativeDecoder.decode(chunk, { stream: !final })
    }

    const merged = concatBytes(pending, chunk)
    const completeLength = final ? merged.length : completeUtf8Length(merged)
    pending = merged.slice(completeLength)
    return decodeUtf8Bytes(merged.slice(0, completeLength))
  }
}

function createSseConsumer(onEvent: (event: AiStreamEvent) => void) {
  let buffer = ''
  return {
    push(chunk: string) {
      buffer = consumeSseBuffer(buffer + chunk, onEvent)
    },
    finish(chunk = '') {
      buffer = consumeSseBuffer(`${buffer}${chunk}\n\n`, onEvent)
    },
  }
}

function responseText(data: unknown) {
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return createUtf8ChunkDecoder()(data, true)
  }
  return JSON.stringify(data ?? '')
}

/**
 * JSON 业务错误包络（success:false / error 字段）→ 业务错误；非错误 JSON 返回 null。
 * 数字 HTTP 语义码 401/403 与普通请求（api/core/handlers）同口径：清除会话并跳转登录，文案统一为"登录已过期"；
 * 字符串业务码（如 AI_CONVERSATION_FORBIDDEN）是会话级权限问题，仅展示文案，不退出登录。
 */
function createStreamBusinessError(body: string, fallbackMessage = 'AI 请求失败') {
  try {
    const parsed = JSON.parse(body) as { success?: boolean, error?: { code?: number | string, message?: string } }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed.success === false || parsed.error)) {
      let message = parsed.error?.message || fallbackMessage
      const numericCode = Number(parsed.error?.code)
      if ((numericCode === 401 || numericCode === 403) && redirectAfterSessionExpiry()) {
        message = '登录已过期，请重新登录！'
      }
      return new Error(message)
    }
  }
  catch {
    // 非 JSON（SSE 文本等），不是业务错误包络
  }
  return null
}

/**
 * uni.request 响应正文路由：按首个非空字符嗅探。
 * '{' 开头视为 JSON 错误包络（整段缓冲，finish 时判错），否则按 SSE 帧实时消费。
 * 微信 enableChunked 下 success.data 恒为空、statusCode 部分基础库不可靠，
 * 4xx 的错误包络只会从 onChunkReceived 以 chunk 形式到达，必须在流层识别。
 */
function createChunkRouter(consumer: ReturnType<typeof createSseConsumer>) {
  let route: 'pending' | 'sse' | 'json' = 'pending'
  let buffer = ''

  const push = (text: string) => {
    if (route === 'sse') {
      consumer.push(text)
      return
    }
    buffer += text
    if (route === 'pending' && buffer.trim()) {
      route = buffer.trimStart().startsWith('{') ? 'json' : 'sse'
      if (route === 'sse') {
        consumer.push(buffer)
        buffer = ''
      }
    }
  }

  /** 收尾：JSON 包络返回业务错误（无则 null）；SSE 正常冲刷缓冲 */
  const finish = (tail = '') => {
    push(tail)
    if (route === 'sse') {
      consumer.finish('')
      return null
    }
    return createStreamBusinessError(buffer)
  }

  return { push, finish, get route() { return route } }
}

export type AiStreamMode = 'stream' | 'buffered'

interface ChunkCapableRequestTask {
  abort: () => void
  onChunkReceived?: (listener: (result: { data: ArrayBuffer }) => void) => void
}

export function createAiStreamRequest(options: AiStreamOptions) {
  const isSend = options.kind === 'send'
  const endpoint = isSend
    ? `/ai/conversations/${encodeURIComponent(options.conversationId || '')}/messages`
    : `/ai/messages/${encodeURIComponent(options.messageId || '')}/regenerate`
  const url = `${getApiOrigin()}/api/v1${endpoint}`
  const headers = {
    'Accept': 'text/event-stream',
    'Authorization': `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json',
  }
  // 声明了 application/json 就必须有 body，空 body 会被后端 400 拒绝；regenerate 无参数时发 {}
  const body = JSON.stringify(isSend ? { content: options.content } : {})
  const platform = getPlatformInfo().platform
  const mode: AiStreamMode = platform === 'app' ? 'buffered' : 'stream'
  let abort: (() => void) | undefined

  // 受理信号：HTTP 2xx（SSE 流建立）即受理；4xx/5xx（如内容受限）拒绝。
  // 与 promise（整段流结束）分离，调用方据此判断"接口是否真正接受了请求"。
  let resolveAccept!: () => void
  let rejectAccept!: (error: Error) => void
  const accepted = new Promise<void>((resolve, reject) => {
    resolveAccept = resolve
    rejectAccept = reject
  })

  const promise = new Promise<void>((resolve, reject) => {
    if (platform === 'h5' && typeof fetch === 'function') {
      const controller = new AbortController()
      const consumer = createSseConsumer(options.onEvent)
      abort = () => controller.abort()
      console.log('[ai-stream] 发起请求', { url, method: 'POST', mode })
      fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      }).then(async (response) => {
        const contentType = response.headers.get('content-type') || ''
        console.log('[ai-stream] 响应', { status: response.status, ok: response.ok, contentType })

        if (!response.ok || !response.body) {
          const error = new Error(await readStreamError(response))
          console.error('[ai-stream] 非 2xx，拒绝发送', error.message)
          rejectAccept(error)
          throw error
        }

        // HTTP 2xx 但返回 JSON 业务错误包络（success:false / error），同样拒绝发送
        if (contentType.includes('application/json')) {
          const body = await response.text()
          const error = createStreamBusinessError(body)
          if (error) {
            console.error('[ai-stream] 业务错误包络，拒绝发送', { body })
            rejectAccept(error)
            throw error
          }
          console.log('[ai-stream] 2xx JSON 非错误包络，按空流结束')
          resolveAccept()
          consumer.finish(body)
          resolve()
          return
        }

        resolveAccept()
        console.log('[ai-stream] 已受理，开始读取 SSE 流')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let frameCount = 0
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) {
            consumer.finish(decoder.decode())
            break
          }
          const text = decoder.decode(chunk.value, { stream: true })
          if (frameCount === 0) {
            console.log('[ai-stream] 首帧片段', text.slice(0, 200))
          }
          consumer.push(text)
          frameCount += 1
        }
        console.log('[ai-stream] SSE 流正常结束', { frameCount })
        resolve()
      }).catch((error) => {
        console.error('[ai-stream] promise 拒绝', error)
        reject(error)
      })
      return
    }

    const useChunks = platform === 'mp-weixin'
    const consumer = createSseConsumer(options.onEvent)
    const router = createChunkRouter(consumer)
    const decodeChunk = createUtf8ChunkDecoder()
    let receivedChunks = false

    const requestOptions = {
      url,
      method: 'POST' as const,
      data: JSON.parse(body) as Record<string, unknown>,
      header: headers,
      responseType: useChunks ? 'arraybuffer' as const : 'text' as const,
      ...(useChunks ? { enableChunked: true } : {}),
      success(response: { statusCode: number, data: unknown }) {
        console.log('[ai-stream] 响应', { statusCode: response.statusCode, receivedChunks })
        // chunk 模式正文来自 onChunkReceived（success.data 恒为空）；buffered/降级模式正文在 success.data
        const tail = useChunks && receivedChunks
          ? decodeChunk(undefined, true)
          : responseText(response.data)
        const businessError = router.finish(tail)
        const httpError = response.statusCode < 200 || response.statusCode >= 300

        if (businessError || httpError) {
          const error = businessError ?? new Error(`AI 请求失败（${response.statusCode}）`)
          console.error('[ai-stream] 请求被拒绝', { statusCode: response.statusCode, message: error.message })
          rejectAccept(error)
          reject(error)
          return
        }

        resolveAccept()
        console.log('[ai-stream] 响应消费完成')
        resolve()
      },
      fail: (error: unknown) => {
        console.error('[ai-stream] 请求失败（网络层）', error)
        rejectAccept(error instanceof Error ? error : new Error('AI 请求失败'))
        reject(error)
      },
    }

    const task = uni.request(requestOptions as Parameters<typeof uni.request>[0]) as unknown as ChunkCapableRequestTask
    if (useChunks && task.onChunkReceived) {
      task.onChunkReceived(({ data }) => {
        receivedChunks = true
        router.push(decodeChunk(data))
        // 首个 chunk 被判定为 SSE 帧即视为受理，与 H5 的 2xx 受理时机对齐
        if (router.route === 'sse') {
          resolveAccept()
        }
      })
    }
    abort = () => task.abort()
  })

  // fetch 网络异常等路径可能不经过 rejectAccept，兜底让 accepted 跟随 promise 结算，避免调用方 await 悬空
  promise.catch(error => rejectAccept(error instanceof Error ? error : new Error('AI 请求失败')))

  return { mode, accepted, promise, abort: () => abort?.() }
}
