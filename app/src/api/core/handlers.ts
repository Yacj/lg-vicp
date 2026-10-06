/*
 * @Author: weisheng
 * @Date: 2025-04-17 15:58:11
 * @LastEditTime: 2025-06-15 21:47:22
 * @LastEditors: weisheng
 * @Description: Alova response and error handlers
 * @FilePath: /wot-starter/src/api/core/handlers.ts
 */
import type { Method } from 'alova'
import router from '@/router'
import { useAuthStore } from '@/store/auth'

// Custom error class for API errors
export class ApiError extends Error {
  code: number
  data?: any

  constructor(message: string, code: number, data?: any) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

// Define a type for the expected API response structure
interface ApiResponse {
  success: boolean
  data?: unknown
  requestId?: string
  error?: {
    // 后端错误码既有数字 HTTP 语义码（fail(requestId, statusCode, message)），
    // 也有字符串业务码（如 AI_CONFIG_INVALID），原始值经 getApiErrorCode 读取。
    code: number | string
    message: string
    details?: {
      errorCode?: string
    }
  }
}

const SILENT_AUTH_ERROR_CODES = new Set(['PASSWORD_NOT_SET'])

function readResponseAuthErrorCode(data: unknown) {
  if (!data || typeof data !== 'object') {
    return undefined
  }
  const errorCode = (data as ApiResponse).error?.details?.errorCode
  return typeof errorCode === 'string' ? errorCode : undefined
}

export function getAuthErrorCode(error: unknown) {
  if (!(error instanceof ApiError)) {
    return undefined
  }
  return readResponseAuthErrorCode(error.data)
}

function shouldToastApiError(data: ApiResponse | undefined, authErrorCode?: string) {
  if (authErrorCode && SILENT_AUTH_ERROR_CODES.has(authErrorCode)) {
    return false
  }
  return data?.error?.code !== 'AI_CONFIG_INVALID'
}

/**
 * 取后端业务错误码（如 AI_CONFIG_INVALID）。
 * ApiError.code 是 Number() 转换后的 HTTP 语义码，字符串业务码只保留在 data.error.code 里。
 */
export function getApiErrorCode(error: unknown): number | string | undefined {
  if (!(error instanceof ApiError)) {
    return undefined
  }
  return (error.data as ApiResponse | undefined)?.error?.code
}

export function redirectAfterSessionExpiry() {
  const authStore = useAuthStore()
  if (!authStore.accessToken) {
    return false
  }

  authStore.clearSession()
  const globalToast = useGlobalToast()
  globalToast.error({ msg: '登录已过期，请重新登录！', duration: 500 })
  const timer = setTimeout(() => {
    clearTimeout(timer)
    router.replaceAll({ name: 'home' }).catch(() => {})
  }, 500)
  return true
}

export async function handleAlovaResponse(
  response: UniApp.RequestSuccessCallbackResult | UniApp.UploadFileSuccessCallbackResult | UniApp.DownloadSuccessData,
) {
  const globalToast = useGlobalToast()
  // Extract status code and data from UniApp response
  const { data } = response as UniNamespace.RequestSuccessCallbackResult
  const payload = data as ApiResponse
  const code = Number(payload.error?.code)
  const authErrorCode = readResponseAuthErrorCode(payload)
  // 登录阶段的 USER_DISABLED 等业务码也是 403，不能改写成会话过期。
  if ((code === 401 || code === 403) && !authErrorCode) {
    redirectAfterSessionExpiry()
    throw new ApiError('登录已过期，请重新登录！', code, data)
  }

  // Handle HTTP error status codes
  if (code >= 400) {
    console.log('[Alova Response]', data)
    const message = payload.error?.message || '请求失败'
    if (shouldToastApiError(payload, authErrorCode)) {
      globalToast.error(message)
    }
    throw new ApiError(message, code, data)
  }

  // The data is already parsed by UniApp adapter
  const json = data as ApiResponse
  if (import.meta.env.MODE === 'development') {
    console.log('[Alova Response]', json)
  }

  if (!json.success) {
    const message = json.error?.message || '请求失败'
    const failureCode = readResponseAuthErrorCode(json)
    // AI 场景配置是可降级错误，由 assistant store 立即回退到 general_chat；
    // 此处不提前提示，避免用户看到一次已被自动恢复的失败。
    if (shouldToastApiError(json, failureCode)) {
      globalToast.error(message)
    }
    throw new ApiError(message, code || 400, json)
  }

  return json
}

// Handle request errors
export function handleAlovaError(error: any, method: Method) {
  const globalToast = useGlobalToast()
  // Log error in development
  if (import.meta.env.MODE === 'development') {
    console.error('[Alova Error]', error, method)
  }

  // 处理401/403错误（如果不是在handleAlovaResponse中处理的）
  if (error instanceof ApiError && (error.code === 401 || error.code === 403) && !getAuthErrorCode(error)) {
    if (redirectAfterSessionExpiry()) {
      throw new ApiError('登录已过期，请重新登录！', error.code, error.data)
    }

    throw error
  }

  // Handle different types of errors
  if (error.name === 'NetworkError') {
    globalToast.error('网络错误，请检查您的网络连接')
  }
  else if (error.name === 'TimeoutError') {
    globalToast.error('请求超时，请重试')
  }
  else if (error instanceof ApiError) {
    if (getAuthErrorCode(error) !== 'PASSWORD_NOT_SET') {
      globalToast.error(error.message || '请求失败')
    }
  }
  else {
    globalToast.error('发生意外错误')
  }

  throw error
}
