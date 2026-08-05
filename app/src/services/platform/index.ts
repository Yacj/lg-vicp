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
    const parsed = JSON.parse(await response.text()) as { error?: { message?: string } }
    if (parsed.error?.message) {
      message = parsed.error.message
    }
  }
  catch {
    // 非 JSON 错误体，保留默认文案
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

function responseErrorMessage(statusCode: number, data: unknown) {
  try {
    const parsed = JSON.parse(responseText(data)) as { error?: { message?: string } }
    return parsed.error?.message || `AI 请求失败（${statusCode}）`
  }
  catch {
    return `AI 请求失败（${statusCode}）`
  }
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
  const body = isSend ? JSON.stringify({ content: options.content }) : undefined
  const platform = getPlatformInfo().platform
  const mode: AiStreamMode = platform === 'app' ? 'buffered' : 'stream'
  let abort: (() => void) | undefined

  const promise = new Promise<void>((resolve, reject) => {
    if (platform === 'h5' && typeof fetch === 'function') {
      const controller = new AbortController()
      const consumer = createSseConsumer(options.onEvent)
      abort = () => controller.abort()
      fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(await readStreamError(response))
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) {
            consumer.finish(decoder.decode())
            break
          }
          consumer.push(decoder.decode(chunk.value, { stream: true }))
        }
        resolve()
      }).catch(reject)
      return
    }

    const useChunks = platform === 'mp-weixin'
    const consumer = createSseConsumer(options.onEvent)
    const decodeChunk = createUtf8ChunkDecoder()
    let receivedChunks = false

    const requestOptions = {
      url,
      method: 'POST' as const,
      data: body ? JSON.parse(body) : undefined,
      header: headers,
      responseType: useChunks ? 'arraybuffer' as const : 'text' as const,
      ...(useChunks ? { enableChunked: true } : {}),
      success(response: { statusCode: number, data: unknown }) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(responseErrorMessage(response.statusCode, response.data)))
          return
        }

        if (useChunks && receivedChunks) {
          consumer.finish(decodeChunk(undefined, true))
        }
        else {
          consumer.finish(responseText(response.data))
        }
        resolve()
      },
      fail: reject,
    }

    const task = uni.request(requestOptions as Parameters<typeof uni.request>[0]) as unknown as ChunkCapableRequestTask
    if (useChunks && task.onChunkReceived) {
      task.onChunkReceived(({ data }) => {
        receivedChunks = true
        consumer.push(decodeChunk(data))
      })
    }
    abort = () => task.abort()
  })

  return { mode, promise, abort: () => abort?.() }
}
