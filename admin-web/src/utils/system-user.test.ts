import { describe, expect, it } from 'vitest'
import {
  USER_DISABLE_BOTH_ENDS_HINT,
  accessAppFilterOptions,
  accessAppToRoleFilter,
  accessDetailRowsForUser,
  accessTagsForUser,
  canEditManagedUserProfile,
  canResetManagedUserPassword,
  cEndUserTypeOptions,
  channelTypeLabels,
  hasAdminAccess,
  isCEndUserRole,
  isChannelUserRole,
  isClientOnlyUser,
  isNormalUserRole,
  isSuperAdminRole,
  projectLoginMethods,
  userGenderLabels,
  userRoleLabels,
  userRoleOptionsFor,
  userStatusLabels,
} from './system-user'

describe('system user fixed enums', () => {
  it('covers every backend user_role enum value', () => {
    expect(Object.keys(userRoleLabels).sort()).toEqual(
      ['CHANNEL_USER', 'NORMAL_USER', 'SUPER_ADMIN'].sort(),
    )
  })

  it('covers every backend channel_type enum value', () => {
    expect(Object.keys(channelTypeLabels).sort()).toEqual(['DEALER', 'SALESPERSON'].sort())
  })

  it('covers gender and status enums', () => {
    expect(Object.keys(userGenderLabels).sort()).toEqual(['FEMALE', 'MALE', 'UNKNOWN'].sort())
    expect(Object.keys(userStatusLabels).sort()).toEqual(['ACTIVE', 'DISABLED'].sort())
  })

  it('keeps channel type semantics bound to the channel user role only', () => {
    expect(isChannelUserRole('CHANNEL_USER')).toBe(true)
    expect(isChannelUserRole('SUPER_ADMIN')).toBe(false)
    expect(isChannelUserRole('NORMAL_USER')).toBe(false)
  })

  it('keeps normal user semantics bound to the normal user role only', () => {
    expect(isNormalUserRole('NORMAL_USER')).toBe(true)
    expect(isNormalUserRole('CHANNEL_USER')).toBe(false)
    expect(isNormalUserRole('SUPER_ADMIN')).toBe(false)
  })

  it('separates C-end registered users from B-end super admins', () => {
    expect(isCEndUserRole('NORMAL_USER')).toBe(true)
    expect(isCEndUserRole('CHANNEL_USER')).toBe(true)
    expect(isCEndUserRole('SUPER_ADMIN')).toBe(false)
    expect(isSuperAdminRole('SUPER_ADMIN')).toBe(true)
    expect(cEndUserTypeOptions.map(option => option.value)).toEqual(['NORMAL_USER', 'CHANNEL_USER'])
  })

  it('hides SUPER_ADMIN from role options for non-super-admin actors', () => {
    expect(userRoleOptionsFor('SUPER_ADMIN').map(option => option.value)).toEqual([
      'SUPER_ADMIN',
      'CHANNEL_USER',
      'NORMAL_USER',
    ])
    expect(userRoleOptionsFor('CHANNEL_USER').map(option => option.value)).toEqual([
      'CHANNEL_USER',
      'NORMAL_USER',
    ])
  })
})

describe('one user with multi-end access', () => {
  const adminOnly = {
    appAccess: [{ app: 'ADMIN' as const, role: 'SUPER_ADMIN' as const, status: 'ACTIVE' as const }],
    role: 'SUPER_ADMIN' as const,
  }
  const clientOnly = {
    appAccess: [{ app: 'CLIENT' as const, role: 'NORMAL_USER' as const, status: 'ACTIVE' as const }],
    role: 'NORMAL_USER' as const,
  }
  const dualAccess = {
    appAccess: [
      { app: 'ADMIN' as const, role: 'SUPER_ADMIN' as const, status: 'ACTIVE' as const },
      { app: 'CLIENT' as const, role: 'NORMAL_USER' as const, status: 'ACTIVE' as const },
    ],
    role: 'SUPER_ADMIN' as const,
  }

  it('filters access end through existing role query only', () => {
    expect(accessAppFilterOptions.map(option => option.value)).toEqual(['all', 'ADMIN', 'CLIENT'])
    expect(accessAppToRoleFilter('all')).toBeUndefined()
    expect(accessAppToRoleFilter('ADMIN')).toBe('SUPER_ADMIN')
    expect(accessAppToRoleFilter('CLIENT')).toBe('NORMAL_USER')
  })

  it('shows admin and client tags on the same user after C-end auto-provision', () => {
    expect(accessTagsForUser(adminOnly).map(tag => tag.label)).toEqual(['管理后台'])
    expect(accessTagsForUser(clientOnly).map(tag => tag.label)).toEqual(['客户端'])
    expect(accessTagsForUser(dualAccess).map(tag => tag.label)).toEqual(['管理后台', '客户端'])
  })

  it('falls back to users.role when appAccess is missing', () => {
    expect(accessTagsForUser({ role: 'SUPER_ADMIN' }).map(tag => tag.app)).toEqual(['ADMIN'])
    expect(accessTagsForUser({ role: 'NORMAL_USER' }).map(tag => tag.app)).toEqual(['CLIENT'])
  })

  it('describes admin as super admin and client as normal user without login-method account types', () => {
    const rows = accessDetailRowsForUser(dualAccess)
    expect(rows).toEqual([
      {
        app: 'ADMIN',
        label: '管理后台',
        opened: true,
        roleLabel: '超级管理员',
        statusLabel: '已开通',
      },
      {
        app: 'CLIENT',
        label: '客户端',
        opened: true,
        roleLabel: '普通用户',
        statusLabel: '已开通',
      },
    ])
    expect(accessDetailRowsForUser(adminOnly)[1]).toMatchObject({
      app: 'CLIENT',
      opened: false,
      statusLabel: '未开通',
    })
    expect(JSON.stringify(rows)).not.toContain('微信用户')
    expect(JSON.stringify(rows)).not.toContain('手机号用户')
  })

  it('allows profile edit and password reset only when ADMIN access exists', () => {
    expect(hasAdminAccess(adminOnly)).toBe(true)
    expect(hasAdminAccess(dualAccess)).toBe(true)
    expect(hasAdminAccess(clientOnly)).toBe(false)
    expect(isClientOnlyUser(clientOnly)).toBe(true)
    expect(isClientOnlyUser(dualAccess)).toBe(false)
    expect(canEditManagedUserProfile(adminOnly)).toBe(true)
    expect(canEditManagedUserProfile(dualAccess)).toBe(true)
    expect(canEditManagedUserProfile(clientOnly)).toBe(false)
    expect(canResetManagedUserPassword(clientOnly)).toBe(false)
    expect(canResetManagedUserPassword(adminOnly)).toBe(true)
  })

  it('keeps login methods separate from access tags', () => {
    const methods = projectLoginMethods({
      identities: [
        { hasPassword: true, identifier: '13800138000', type: 'PHONE' },
        { hasPassword: false, identifier: 'openid-1', type: 'WECHAT_OPENID' },
      ],
      loginIdentifier: '13800138000',
      phone: '13800138000',
      role: 'SUPER_ADMIN',
    })
    expect(methods.map(item => item.label)).toEqual(['手机号', '微信小程序', '密码'])
    expect(methods.find(item => item.key === 'phone')).toMatchObject({ bound: true, value: '13800138000' })
    expect(methods.find(item => item.key === 'wechat')).toMatchObject({ bound: true, value: '已绑定' })
    expect(methods.find(item => item.key === 'password')).toMatchObject({ bound: true, value: '已设置' })
  })

  it('does not invent wechat binding when identities are absent', () => {
    const methods = projectLoginMethods({
      loginIdentifier: 'admin.one',
      phone: '13800138000',
      role: 'SUPER_ADMIN',
    })
    expect(methods.find(item => item.key === 'phone')?.value).toBe('13800138000')
    expect(methods.find(item => item.key === 'wechat')).toMatchObject({ bound: null, value: '—' })
    expect(methods.find(item => item.key === 'password')).toMatchObject({ bound: true, value: '已设置' })
  })

  it('states disable affects both admin and client login', () => {
    expect(USER_DISABLE_BOTH_ENDS_HINT).toBe('禁用后该用户将无法登录管理后台和客户端。')
  })
})
