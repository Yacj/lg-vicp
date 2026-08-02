import axios from 'axios'
import { api, httpClient } from '@/api/http/client'
import { presignedClient } from '@/api/http/presigned'
import type {
  CompleteUploadResult,
  CreateUploadIntentInput,
  DownloadUrlResult,
  FilePageQuery,
  FilePageResult,
  FileStatusResult,
  UploadFileContext,
  UploadIntent,
} from '@/types/file'
import { HttpRequestError } from '@/types/error'

const FILES_PREFIX = '/api/v1/files'

/** 创建直传凭证（上传方式由后端决定，当前为对象存储预签名 PUT）。 */
export function createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
  return api.post<UploadIntent>(`${FILES_PREFIX}/upload-intents`, input)
}

/** 确认文件上传完成，后端校验大小与 SHA-256 后进入解析队列。 */
export function completeFileUpload(fileId: string): Promise<CompleteUploadResult> {
  return api.post<CompleteUploadResult>(`${FILES_PREFIX}/${encodeURIComponent(fileId)}/complete`)
}

/** 获取文件与关联解析任务状态（轮询入口）。 */
export function fetchFileStatus(fileId: string, signal?: AbortSignal): Promise<FileStatusResult> {
  return api.get<FileStatusResult>(`${FILES_PREFIX}/${encodeURIComponent(fileId)}/status`, { signal })
}

/** 获取源文件预签名下载地址。 */
export function fetchFileDownloadUrl(fileId: string): Promise<DownloadUrlResult> {
  return api.get<DownloadUrlResult>(`${FILES_PREFIX}/${encodeURIComponent(fileId)}/download-url`)
}

/** 分页获取我的源文件列表。 */
export function fetchFiles(query: FilePageQuery, signal?: AbortSignal): Promise<FilePageResult> {
  return api.get<FilePageResult>(FILES_PREFIX, { params: query, signal })
}

/** 删除文件（软删除，存储对象由维护任务延迟清理）。 */
export function deleteFile(fileId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`${FILES_PREFIX}/${encodeURIComponent(fileId)}`)
}

function isPresignSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

function extractPresignErrorBody(data: unknown): string {
  if (typeof data === 'string') {
    // MinIO/OSS 的失败响应为 <Error>...</Error> 或含 <Message> 子标签
    const xmlMessage = /<Message>(.*?)<\/Message>/s.exec(data)
      ?? /^<Error>(.*?)<\/Error>$/s.exec(data.trim())
    if (xmlMessage?.[1]) {
      return xmlMessage[1].slice(0, 200)
    }
    return data.slice(0, 200)
  }
  if (typeof data === 'object' && data !== null) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string') {
      return message.slice(0, 200)
    }
  }
  return '对象存储返回了不可识别的错误响应'
}

/**
 * 向预签名地址执行 PUT 直传。
 * 返回对象存储的原始响应数据（MinIO 为空字符串，OSS 为 XML 文本）。
 */
export async function uploadFileToPresignedUrl(
  url: string,
  file: File,
  context: UploadFileContext,
): Promise<unknown> {
  try {
    const response = await presignedClient.put<unknown>(url, file, {
      headers: { 'Content-Type': file.type },
      signal: context.signal,
      onUploadProgress: (event) => {
        context.onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: event.total && event.total > 0
            ? Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total)))
            : 0,
        })
      },
    })
    if (!isPresignSuccessStatus(response.status)) {
      const body = extractPresignErrorBody(response.data)
      throw new HttpRequestError(`对象存储上传失败（HTTP ${response.status}）：${body}`, { status: response.status })
    }
    return response.data
  }
  catch (error) {
    if (axios.isCancel(error) || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const body = extractPresignErrorBody(error.response?.data)
      throw new HttpRequestError(
        status ? `对象存储上传失败（HTTP ${status}）：${body}` : `对象存储上传失败：${error.message}`,
        { status },
      )
    }
    throw error
  }
}

/** 下载预签名地址内容为 Blob（可跟踪进度、可取消），并携带解析文件名所需的响应头。 */
export interface UrlDownloadResult {
  blob: Blob
  contentDisposition: string | null
  contentType: string
}

/** 下载预签名地址内容为 Blob（可跟踪进度、可取消）。 */
export async function downloadUrlToBlob(
  url: string,
  context: { signal: AbortSignal, onProgress?: (percent: number) => void },
): Promise<UrlDownloadResult> {
  const response = await presignedClient.get<Blob>(url, {
    responseType: 'blob',
    signal: context.signal,
    onDownloadProgress: (event) => {
      if (context.onProgress && event.total && event.total > 0) {
        context.onProgress(Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total))))
      }
    },
  })
  if (!isPresignSuccessStatus(response.status)) {
    throw new HttpRequestError(`文件下载失败（HTTP ${response.status}）`, { status: response.status })
  }
  const contentDisposition = typeof response.headers['content-disposition'] === 'string'
    ? response.headers['content-disposition']
    : null
  const contentType = typeof response.headers['content-type'] === 'string'
    ? response.headers['content-type']
    : ''
  return { blob: response.data, contentDisposition, contentType }
}

/** 供测试与复用：通过业务客户端获取 Blob（后端导出等场景）。 */
export async function requestBlob(
  config: { url: string, signal?: AbortSignal, onProgress?: (percent: number) => void },
): Promise<Blob> {
  const response = await httpClient.request<Blob>({
    method: 'GET',
    responseType: 'blob',
    signal: config.signal,
    url: config.url,
    onDownloadProgress: (event) => {
      if (config.onProgress && event.total && event.total > 0) {
        config.onProgress(Math.min(100, Math.max(0, Math.round((event.loaded * 100) / event.total))))
      }
    },
  })
  return response.data
}