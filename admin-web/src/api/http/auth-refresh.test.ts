import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from '@/types/api'
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureHttpSession, httpClient, request } from './client'

function response<T>(
  config: InternalAxiosRequestConfig,
  data: ApiResponse<T>,
  status = 200,
): AxiosResponse<ApiResponse<T>> {
  return {
    config,
    data,
    headers: {},
    status,
    statusText: String(status),
  }
}

function forbidden(config: InternalAxiosRequestConfig): Promise<never> {
  const failedResponse = response(config, {
    error: { code: 403, message: '无权访问该资源' },
    requestId: 'request-403',
    success: false,
  }, 403)
  return Promise.reject(new AxiosError('403', AxiosError.ERR_BAD_REQUEST, config, undefined, failedResponse))
}

function unauthorized(config: InternalAxiosRequestConfig): Promise<never> {
  const failedResponse = response(config, {
    error: { code: 401, message: '登录状态无效或已过期' },
    requestId: 'request-401',
    success: false,
  }, 401)
  return Promise.reject(new AxiosError('401', AxiosError.ERR_BAD_REQUEST, config, undefined, failedResponse))
}

const originalAdapter = httpClient.defaults.adapter

afterEach(() => {
  httpClient.defaults.adapter = originalAdapter
  configureHttpSession({
    getAccessToken: () => '',
    getRefreshToken: () => '',
    onSessionExpired: () => undefined,
    replaceSession: () => undefined,
  })
})

describe('hTTP auth refresh lock', () => {
  it('shares one refresh request and replays concurrent HTTP 401 requests', async () => {
    let accessToken = 'expired-access'
    let refreshToken = 'current-refresh'
    let refreshCalls = 0
    let protectedCalls = 0
    const replaceSession = vi.fn((session) => {
      accessToken = session.accessToken
      refreshToken = session.refreshToken
    })

    configureHttpSession({
      getAccessToken: () => accessToken,
      getRefreshToken: () => refreshToken,
      onSessionExpired: vi.fn(),
      replaceSession,
    })

    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh') {
        refreshCalls += 1
        await new Promise(resolve => setTimeout(resolve, 5))
        return response(config, {
          data: {
            accessToken: 'next-access',
            clientType: 'B_ADMIN',
            refreshToken: 'next-refresh',
            refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          },
          requestId: 'request-refresh',
          success: true,
        })
      }

      protectedCalls += 1
      if (config.headers.get('Authorization') === 'Bearer next-access') {
        return response(config, {
          data: 'ok',
          requestId: `request-${protectedCalls}`,
          success: true,
        })
      }
      return unauthorized(config)
    }
    httpClient.defaults.adapter = adapter

    const results = await Promise.all([
      request<string>({ url: '/protected-a' }),
      request<string>({ url: '/protected-b' }),
      request<string>({ url: '/protected-c' }),
    ])

    expect(results).toEqual(['ok', 'ok', 'ok'])
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(6)
    expect(replaceSession).toHaveBeenCalledOnce()
    expect(refreshToken).toBe('next-refresh')
  })

  it('uses the same refresh path for business 401 responses', async () => {
    let accessToken = 'expired-access'
    let refreshCalls = 0

    configureHttpSession({
      getAccessToken: () => accessToken,
      getRefreshToken: () => 'current-refresh',
      onSessionExpired: vi.fn(),
      replaceSession: (session) => {
        accessToken = session.accessToken
      },
    })

    httpClient.defaults.adapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh') {
        refreshCalls += 1
        return response(config, {
          data: {
            accessToken: 'next-access',
            clientType: 'B_ADMIN',
            refreshToken: 'next-refresh',
            refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
          },
          requestId: 'request-refresh',
          success: true,
        })
      }
      if (config.headers.get('Authorization') === 'Bearer next-access') {
        return response(config, { data: 'ok', requestId: 'request-ok', success: true })
      }
      return response(config, {
        error: { code: 401, message: '业务登录态失效' },
        requestId: 'request-business-401',
        success: false,
      })
    }

    await expect(request<string>({ url: '/business-401' })).resolves.toBe('ok')
    expect(refreshCalls).toBe(1)
  })

  it('deduplicates 403 permission synchronization and replays requests once', async () => {
    const onPermissionDenied = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    configureHttpSession({
      getAccessToken: () => 'current-access',
      getRefreshToken: () => 'current-refresh',
      onPermissionDenied,
      onSessionExpired: vi.fn(),
      replaceSession: vi.fn(),
    })

    httpClient.defaults.adapter = async (config) => {
      if (config.retryAfterPermissionSync) {
        return response(config, { data: 'ok', requestId: 'request-ok', success: true })
      }
      return forbidden(config)
    }

    await expect(Promise.all([
      request<string>({ url: '/permission-a' }),
      request<string>({ url: '/permission-b' }),
    ])).resolves.toEqual(['ok', 'ok'])
    expect(onPermissionDenied).toHaveBeenCalledOnce()
  })

  it('clears the session once when refresh fails', async () => {
    const onSessionExpired = vi.fn()
    configureHttpSession({
      getAccessToken: () => 'expired-access',
      getRefreshToken: () => 'invalid-refresh',
      onSessionExpired,
      replaceSession: vi.fn(),
    })

    let refreshCalls = 0
    httpClient.defaults.adapter = (config) => {
      if (config.url === '/api/v1/auth/refresh') {
        refreshCalls += 1
      }
      return unauthorized(config)
    }

    const results = await Promise.allSettled([
      request<string>({ url: '/protected-a' }),
      request<string>({ url: '/protected-b' }),
    ])

    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })
})
