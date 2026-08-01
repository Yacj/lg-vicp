import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loginBAdmin, logoutBAdmin } from '@/api/modules/auth'
import { BusinessError, HttpRequestError } from '@/types/error'
import { useAuthStore } from './auth'

vi.mock('@/api/modules/auth', () => ({
  loginBAdmin: vi.fn(),
  logoutBAdmin: vi.fn(),
}))

const mockedLogin = vi.mocked(loginBAdmin)
const mockedLogout = vi.mocked(logoutBAdmin)
const futureExpiration = '2099-01-01T00:00:00.000Z'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('b_ADMIN auth store', () => {
  it('persists a valid B_ADMIN token pair after login', async () => {
    mockedLogin.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: futureExpiration,
      refreshTokenId: 'refresh-id',
      user: {
        channelType: null,
        clientType: 'B_ADMIN',
        displayName: '管理员',
        id: 'user-id',
        role: 'SUPER_ADMIN',
      },
    })
    const store = useAuthStore()

    await store.login({
      captchaCode: 'ABCD',
      captchaUuid: 'captcha-id',
      identifier: 'admin',
      password: 'password',
    })

    expect(store.status).toBe('authenticated')
    expect(store.hasSession).toBe(true)
    expect(JSON.parse(localStorage.getItem('vicp_admin_auth_session') ?? '{}')).toMatchObject({
      accessToken: 'access-token',
      clientType: 'B_ADMIN',
      refreshToken: 'refresh-token',
    })
  })

  it.each([
    ['验证码错误或已过期', 400],
    ['用户名、手机号或密码错误', 400],
  ])('clears the session when login fails: %s', async (message, code) => {
    mockedLogin.mockRejectedValue(new BusinessError({ code, message }, 'request-login-failed'))
    const store = useAuthStore()

    await expect(store.login({
      captchaCode: 'ABCD',
      captchaUuid: 'captcha-id',
      identifier: 'admin',
      password: 'wrong',
    })).rejects.toMatchObject({ message, requestId: 'request-login-failed' })
    expect(store.status).toBe('anonymous')
    expect(store.hasSession).toBe(false)
  })

  it('rejects a NORMAL_USER response even if a token pair is returned', async () => {
    mockedLogin.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: futureExpiration,
      refreshTokenId: 'refresh-id',
      user: {
        channelType: null,
        clientType: 'B_ADMIN',
        displayName: '普通用户',
        id: 'user-id',
        role: 'NORMAL_USER',
      },
    })
    const store = useAuthStore()

    await expect(store.login({
      captchaCode: 'ABCD',
      captchaUuid: 'captcha-id',
      identifier: 'normal',
      password: 'password',
    })).rejects.toBeInstanceOf(HttpRequestError)
    expect(store.hasSession).toBe(false)
  })

  it('always clears local tokens when server logout fails', async () => {
    mockedLogin.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: futureExpiration,
      refreshTokenId: 'refresh-id',
      user: {
        channelType: null,
        clientType: 'B_ADMIN',
        displayName: '管理员',
        id: 'user-id',
        role: 'SUPER_ADMIN',
      },
    })
    mockedLogout.mockRejectedValue(new Error('network failed'))
    const store = useAuthStore()
    await store.login({ captchaCode: 'ABCD', captchaUuid: 'captcha-id', identifier: 'admin', password: 'password' })

    await expect(store.logout()).resolves.toBe(false)
    expect(store.hasSession).toBe(false)
    expect(localStorage.getItem('vicp_admin_auth_session')).toBeNull()
  })
})
