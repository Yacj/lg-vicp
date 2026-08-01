import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from '@/types/api'
import type { RefreshTokenResult, StoredAuthSession } from '@/types/auth'
import axios from 'axios'
import { isApiResponse } from '@/types/api'
import { B_ADMIN_CLIENT } from '@/types/auth'
import { BusinessError, HttpRequestError } from '@/types/error'
import { getAppEnv } from '@/utils/env'

declare module 'axios' {
  interface AxiosRequestConfig {
    retryAfterRefresh?: boolean
    skipAuth?: boolean
    skipAuthRefresh?: boolean
  }
}

const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: '请求参数错误',
  401: '登录状态无效或已过期',
  403: '无权访问该资源',
  404: '请求资源不存在',
  408: '请求超时',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务暂不可用',
  504: '网关超时',
}

const env = getAppEnv()
const baseURL = import.meta.env.DEV && env.openProxy ? '/proxy/' : env.apiBaseUrl

export const httpClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60_000,
})

export function unwrapApiResponse<T>(response: ApiResponse<T>): T {
  if (response.success) {
    return response.data
  }
  throw new BusinessError(response.error, response.requestId)
}

function getRequestId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('requestId' in value)) {
    return undefined
  }
  return typeof value.requestId === 'string' ? value.requestId : undefined
}

function normalizeHttpError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error('未知请求错误')
  }

  const status = error.response?.status
  const requestId = getRequestId(error.response?.data)
  return new HttpRequestError(
    status ? HTTP_ERROR_MESSAGES[status] || `HTTP 错误: ${status}` : error.message || '网络请求失败',
    { requestId, status },
  )
}

export interface HttpSessionBridge {
  getAccessToken: () => string
  getRefreshToken: () => string
  onSessionExpired: () => Promise<void> | void
  replaceSession: (session: StoredAuthSession) => void
}

let sessionBridge: HttpSessionBridge = {
  getAccessToken: () => '',
  getRefreshToken: () => '',
  onSessionExpired: () => undefined,
  replaceSession: () => undefined,
}
let refreshPromise: Promise<string> | null = null

export function configureHttpSession(bridge: HttpSessionBridge): void {
  sessionBridge = bridge
}

async function refreshSession(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = sessionBridge.getRefreshToken()
      if (!refreshToken) {
        throw new HttpRequestError('刷新令牌不存在，请重新登录', { status: 401 })
      }

      const response = await httpClient.request<ApiResponse<RefreshTokenResult>>({
        data: { refreshToken },
        method: 'POST',
        skipAuth: true,
        skipAuthRefresh: true,
        url: '/api/v1/auth/refresh',
      })
      if (!isApiResponse(response.data)) {
        throw new HttpRequestError('刷新令牌响应结构不符合统一契约')
      }

      const nextSession = unwrapApiResponse(response.data as ApiResponse<RefreshTokenResult>)
      if (nextSession.clientType !== B_ADMIN_CLIENT) {
        throw new HttpRequestError('当前会话不再具备 B 端访问资格', { status: 403 })
      }

      sessionBridge.replaceSession({
        accessToken: nextSession.accessToken,
        refreshToken: nextSession.refreshToken,
        refreshTokenExpiresAt: nextSession.refreshTokenExpiresAt,
        clientType: B_ADMIN_CLIENT,
      })
      return nextSession.accessToken
    })()
      .catch(async (error) => {
        await sessionBridge.onSessionExpired()
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

async function replayAfterRefresh<T>(
  config: InternalAxiosRequestConfig,
  rejection: unknown,
): Promise<AxiosResponse<T>> {
  if (config.skipAuthRefresh) {
    return Promise.reject(rejection)
  }
  if (config.retryAfterRefresh) {
    await sessionBridge.onSessionExpired()
    return Promise.reject(rejection)
  }

  const accessToken = await refreshSession()
  config.retryAfterRefresh = true
  config.headers.set('Authorization', `Bearer ${accessToken}`)
  return httpClient.request<T>(config)
}

httpClient.interceptors.request.use((config) => {
  const accessToken = sessionBridge.getAccessToken()
  if (!config.skipAuth && accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`)
    config.headers.set('X-Client-Type', B_ADMIN_CLIENT)
  }
  return config
})

httpClient.interceptors.response.use(
  (response) => {
    if (
      isApiResponse(response.data)
      && !response.data.success
      && response.data.error.code === 401
    ) {
      return replayAfterRefresh(response.config, new BusinessError(response.data.error, response.data.requestId))
    }
    return response
  },
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
      return replayAfterRefresh(error.config, error)
    }
    return Promise.reject(error)
  },
)

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    if (config.responseType === 'blob' || config.responseType === 'arraybuffer') {
      const response = await httpClient.request<T>(config)
      return response.data
    }

    const response = await httpClient.request<ApiResponse<T>>(config)
    if (!isApiResponse(response.data)) {
      throw new HttpRequestError('服务端响应结构不符合统一契约')
    }
    return unwrapApiResponse(response.data as ApiResponse<T>)
  }
  catch (error) {
    if (error instanceof BusinessError || error instanceof HttpRequestError) {
      throw error
    }
    throw normalizeHttpError(error)
  }
}

export const api = {
  delete: <T>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'DELETE', url }),
  get: <T>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, method: 'GET', url }),
  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => request<T>({ ...config, data, method: 'PATCH', url }),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => request<T>({ ...config, data, method: 'POST', url }),
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => request<T>({ ...config, data, method: 'PUT', url }),
}
