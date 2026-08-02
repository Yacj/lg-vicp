import type { AxiosError } from 'axios'
import type { ApiErrorPayload } from '@/types/api'
import { BusinessError, HttpRequestError } from '@/types/error'

/**
 * 统一的文件下载能力：
 * - 文件名解析（Content-Disposition → 预签名 URL 文件名）
 * - Blob 触发下载
 * - 错误响应（业务契约 / HTTP 状态）
 * - requestId 透传
 * - 下载进度回调
 */

const FALLBACK_FILENAME = 'download'

function extractRequestId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('requestId' in data)) {
    return undefined
  }
  return typeof data.requestId === 'string' ? data.requestId : undefined
}

function extractApiErrorMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('error' in data)) {
    return undefined
  }
  const error = data.error as Partial<ApiErrorPayload> | null | undefined
  if (typeof error?.message === 'string') {
    return error.message
  }
  const message = (data as { message?: unknown }).message
  if (typeof message === 'string') {
    return message
  }
  return undefined
}

function decodeContentDisposition(value: string): string | null {
  // filename*=UTF-8''<percent-encoded> 优先
  const encoded = value.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/i)
  if (encoded?.[1]) {
    try {
      const decoded = decodeURIComponent(encoded[1].trim())
      return decoded || null
    }
    catch {
      // 继续尝试普通 filename
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i)
  return plain?.[1]?.trim() || null
}

/** 从 Content-Disposition 头或 URL 中解析下载文件名。 */
export function resolveDownloadFilename(contentDisposition: string | null | undefined, url: string): string {
  if (contentDisposition) {
    const fromHeader = decodeContentDisposition(contentDisposition)
    if (fromHeader) {
      return fromHeader
    }
  }
  try {
    const parsed = new URL(url, window.location.origin)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    if (segment && segment !== '/') {
      return decodeURIComponent(segment)
    }
  }
  catch {
    // URL 解析失败时回退到默认名
  }
  return FALLBACK_FILENAME
}

export interface BlobDownloadOptions {
  filename?: string
  /** 触发下载前可对 Blob 做内容嗅探替换（如空响应兜底）。 */
  mimeType?: string
}

export interface TriggerBlobDownloadResult {
  filename: string
  sizeBytes: number
}

/** 触发浏览器下载 Blob，并返回实际文件名与大小。 */
export function triggerBlobDownload(blob: Blob, options: BlobDownloadOptions = {}): TriggerBlobDownloadResult {
  const finalBlob = options.mimeType ? new Blob([blob], { type: options.mimeType }) : blob
  const url = URL.createObjectURL(finalBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = options.filename ?? FALLBACK_FILENAME
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return { filename: link.download, sizeBytes: finalBlob.size }
}

export interface NormalizeDownloadErrorResult {
  message: string
  requestId?: string
  status?: number
}

/**
 * 统一错误响应：
 * - BusinessError / HttpRequestError 直接透传
 * - axios 错误解析响应体（统一协议含 requestId 与 error.message）
 * - 其他错误兜底文案
 */
export function normalizeDownloadError(error: unknown): NormalizeDownloadErrorResult {
  if (error instanceof BusinessError || error instanceof HttpRequestError) {
    return {
      message: error.message,
      requestId: error.requestId,
      status: error instanceof HttpRequestError ? error.status : undefined,
    }
  }
  if (typeof error === 'object' && error !== null && 'isAxiosError' in error) {
    const axiosError = error as AxiosError<unknown>
    const data = axiosError.response?.data
    const requestId = extractRequestId(data)
    const apiMessage = extractApiErrorMessage(data)
    if (axiosError.response) {
      return {
        message: apiMessage ?? `下载失败（HTTP ${axiosError.response.status}）`,
        requestId,
        status: axiosError.response.status,
      }
    }
    return {
      message: apiMessage ?? '下载失败：无服务器响应',
      requestId,
    }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: '下载失败，请稍后重试' }
}

export interface DownloadFromUrlOptions {
  /** 已知文件名时可直接传入，优先于头与 URL 解析。 */
  filename?: string
  onProgress?: (percent: number) => void
  fetchBlob: (
    url: string,
    context: { signal?: AbortSignal, onProgress?: (percent: number) => void },
  ) => Promise<{ blob: Blob, contentDisposition: string | null, contentType: string }>
  signal?: AbortSignal
}

/**
 * 从 URL 下载并触发保存。
 * 文件名优先级：显式 filename > Content-Disposition 头 > URL 路径。
 * 进度仅在响应头包含 Content-Length 时可报告（预签名 URL 通常可用）。
 */
export async function downloadFromUrl(
  url: string,
  options: DownloadFromUrlOptions,
): Promise<TriggerBlobDownloadResult> {
  const { filename, onProgress, fetchBlob, signal } = options
  const result = await fetchBlob(url, { signal, onProgress })
  const resolved = filename ?? resolveDownloadFilename(result.contentDisposition, url)
  return triggerBlobDownload(result.blob, { filename: resolved, mimeType: result.contentType || undefined })
}

/** 将任意失败转换为可展示的文案（配合 Feedback 使用）。 */
export function downloadErrorMessage(error: unknown): string {
  return normalizeDownloadError(error).message
}