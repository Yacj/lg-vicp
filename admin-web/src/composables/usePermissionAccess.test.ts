import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUserStore } from '@/stores/user'
import { usePermissionAccess } from './usePermissionAccess'

beforeEach(() => {
  setActivePinia(createPinia())
  useUserStore().applyUserInfo({
    dataScopes: [],
    departments: [],
    permissions: ['system:user:list', 'system:ai:provider:*'],
    roles: ['operator'],
    user: {
      channelType: 'DEALER',
      clientType: 'B_ADMIN',
      displayName: '权限夹具',
      email: null,
      id: 'user-1',
      phone: null,
      role: 'CHANNEL_USER',
      status: 'ACTIVE',
    },
  })
})

describe('permission access for configured actions', () => {
  it('evaluates any/all requirements and filters action definitions', () => {
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
    expect(access.canAccess(actions[1])).toBe(false)
    expect(access.canAccess(actions[2])).toBe(true)
    expect(access.filterPermitted(actions).map(action => action.id)).toEqual([
      'list',
      'provider',
      'public',
    ])
  })

  it('keeps computed permission state reactive to the user store', () => {
    const store = useUserStore()
    const access = usePermissionAccess()
    const canEdit = access.permitted({ permissions: ['system:user:edit'] })

    expect(canEdit.value).toBe(false)
    store.permissions = ['system:user:edit']
    expect(canEdit.value).toBe(true)
  })
})