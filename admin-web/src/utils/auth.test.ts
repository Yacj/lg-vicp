import { beforeEach, describe, expect, it } from 'vitest'
import { canEnterBAdmin, clearAuthSession, readAuthSession, writeAuthSession } from './auth'

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

describe('B 端进入条件', () => {
  it('only allows SUPER_ADMIN with B_ADMIN client type', () => {
    expect(canEnterBAdmin({ clientType: 'B_ADMIN', role: 'SUPER_ADMIN' })).toBe(true)
    expect(canEnterBAdmin({ clientType: 'B_ADMIN', role: 'NORMAL_USER' })).toBe(false)
    expect(canEnterBAdmin({ clientType: 'B_ADMIN', role: 'CHANNEL_USER' })).toBe(false)
    expect(canEnterBAdmin({ clientType: 'C_APP', role: 'SUPER_ADMIN' })).toBe(false)
  })
})
