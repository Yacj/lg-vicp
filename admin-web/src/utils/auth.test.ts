import { beforeEach, describe, expect, it } from 'vitest'
import { clearAuthSession, readAuthSession, writeAuthSession } from './auth'

const validSession = {
  accessToken: 'access-token',
  clientType: 'B_ADMIN' as const,
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
}

describe('管理后台会话存储', () => {
  beforeEach(() => {
    clearAuthSession()
  })

  it('拒绝非法的刷新令牌过期时间', () => {
    writeAuthSession({ ...validSession, refreshTokenExpiresAt: 'invalid-date' })
    expect(readAuthSession()).toBeNull()
    expect(localStorage.getItem('vicp_admin_auth_session')).toBeNull()
  })

  it('读取未过期的管理后台会话', () => {
    writeAuthSession(validSession)
    expect(readAuthSession()).toEqual(validSession)
  })
})
