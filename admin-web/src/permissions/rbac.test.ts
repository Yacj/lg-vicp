import { describe, expect, it } from 'vitest'
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  permissionMatches,
} from './rbac'

describe('rBAC permission DSL', () => {
  const granted = ['system:user:list', 'system:ai:provider:*']

  it('supports exact and explicit suffix wildcard permissions', () => {
    expect(permissionMatches('system:user:list', 'system:user:list')).toBe(true)
    expect(permissionMatches('system:ai:provider:*', 'system:ai:provider:edit')).toBe(true)
    expect(permissionMatches('system:user:list', 'system:user:edit')).toBe(false)
  })

  it('evaluates page and button permission collections', () => {
    expect(hasPermission(granted, 'system:user:list')).toBe(true)
    expect(hasAnyPermission(granted, ['system:user:edit', 'system:user:list'])).toBe(true)
    expect(hasAllPermissions(granted, ['system:user:list', 'system:ai:provider:edit'])).toBe(true)
    expect(hasAllPermissions(granted, ['system:user:list', 'system:role:list'])).toBe(false)
  })

  it('treats SUPER_ADMIN as a permission bypass, not channelType', () => {
    expect(hasPermission([], 'system:user:remove', true)).toBe(true)
    expect(hasPermission([], 'system:user:remove', false)).toBe(false)
  })
})
