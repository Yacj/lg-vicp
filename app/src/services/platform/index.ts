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

export interface AiStreamOptions {
  conversationId: string
  content: string
  accessToken: string
  onEvent: (event: AiStreamEvent) => void
}

export interface AiStreamEvent {
  event: string
  data: Record<string, unknown>
}

function getApiOrigin() {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
}

function parseEventData(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    return { text: raw }
  }
}

function consumeSseBuffer(buffer: string, onEvent: (event: AiStreamEvent) => void) {
  const frames = buffer.split(/\r?\n\r?\n/)
  const remainder = frames.pop() || ''

  for (const frame of frames) {
    const event = frame.match(/^event:([^\r\n]*)$/m)?.[1]?.trim() || 'message'
    const data = frame.match(/^data:([^\r\n]*)$/m)?.[1]?.trim()
    if (data) {
      onEvent({ event, data: parseEventData(data) })
    }
  }

  return remainder
}

export function createAiStreamRequest(options: AiStreamOptions) {
  const url = `${getApiOrigin()}/api/v1/ai/conversations/${encodeURIComponent(options.conversationId)}/messages`
  const headers = {
    'Accept': 'text/event-stream',
    'Authorization': `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json',
  }
  let abort: (() => void) | undefined

  const promise = new Promise<void>((resolve, reject) => {
    if (getPlatformInfo().platform === 'h5' && typeof fetch === 'function') {
      const controller = new AbortController()
      abort = () => controller.abort()
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: options.content }),
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`AI stream request failed: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) {
            buffer += decoder.decode()
            consumeSseBuffer(`${buffer}\n\n`, options.onEvent)
            break
          }
          buffer = consumeSseBuffer(buffer + decoder.decode(chunk.value, { stream: true }), options.onEvent)
        }
        resolve()
      }).catch(reject)
      return
    }

    const task = uni.request({
      url,
      method: 'POST',
      data: { content: options.content },
      header: headers,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`AI request failed: ${response.statusCode}`))
          return
        }
        const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
        consumeSseBuffer(`${raw}\n\n`, options.onEvent)
        resolve()
      },
      fail: reject,
    })
    abort = () => task.abort()
  })

  return { promise, abort: () => abort?.() }
}
