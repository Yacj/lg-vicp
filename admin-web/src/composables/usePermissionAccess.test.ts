import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUserStore } from '@/stores/user'
import { usePermissionAccess } from './usePermissionAccess'

beforeEach(() => {
  setActivePinia(createPinia())
  useUserStore().applyUserInfo({
    dataScopes: [],
    departments: [],
    permissions: ['system:user:list', 'system:ai:provider:list', 'system:ai:provider:edit'],
    roles: ['operator'],
    user: {
      adminLoginEnabled: true,
      channelType: null,
      clientType: 'B_ADMIN',
      displayName: '权限夹具',
      email: null,
      id: 'user-1',
      phone: null,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  })
})

describe('permission access for configured actions', () => {
  it('lets super admin bypass configured action permissions', () => {
    const access = usePermissionAccess()
    const actions = [
      { id: 'list', permissions: ['system:user:list'] },
      { id: 'edit', permissions: ['system:user:edit'] },
      {
        id: 'provider',
        permissionMatch: 'all' as const,
        permissions: ['system:ai:provider:list', 'system:ai:provider:edit'],
      },
      { id: 'public' },
    ]

    expect(access.canAccess(actions[0])).toBe(true)
    expect(access.canAccess(actions[1])).toBe(true)
    expect(access.canAccess(actions[2])).toBe(true)
    expect(access.filterPermitted(actions).map(action => action.id)).toEqual([
      'list',
      'edit',
      'provider',
      'public',
    ])
  })

  it('rejects non-super-admin profiles from entering the admin store', () => {
    const store = useUserStore()
    expect(() => store.applyUserInfo({
      dataScopes: [],
      departments: [],
      permissions: ['system:user:list'],
      roles: ['operator'],
      user: {
        adminLoginEnabled: true,
        channelType: 'DEALER',
        clientType: 'B_ADMIN',
        displayName: '渠道用户',
        email: null,
        id: 'user-2',
        phone: null,
        role: 'CHANNEL_USER',
        status: 'ACTIVE',
      },
    })).toThrow(/仅超级管理员/)
  })

  it('keeps computed permission state reactive to the user store', () => {
    const store = useUserStore()
    const access = usePermissionAccess()
    const canEdit = access.permitted({ permissions: ['system:user:edit'] })

    expect(canEdit.value).toBe(true)
    store.permissions = ['system:user:edit']
    expect(canEdit.value).toBe(true)
  })
})