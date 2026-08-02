import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createDepartment,
  createDictionaryItem,
  createMenu,
  deleteDictionaryItem,
  deleteMenu,
  fetchDepartmentMembers,
  fetchDepartmentTree,
  fetchMenus,
  fetchPermissionResources,
  fetchPosts,
  updateDepartment,
  updateDictionary,
  updateMenu,
  updateMenuStatus,
  updatePostStatus,
} from './system-management'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('system management api contracts', () => {
  it('uses the registered department routes and preserves the create/update field split', async () => {
    const signal = new AbortController().signal
    const createInput = {
      code: 'rd',
      enabled: true,
      name: '研发部',
      parentId: null,
      sortOrder: 10,
    }
    const updateInput = {
      email: 'rd@example.com',
      leader: '负责人',
      phone: '010-12345678',
    }

    await fetchDepartmentTree(signal)
    await createDepartment(createInput)
    await updateDepartment('dept/id', updateInput)

    expect(mockedApi.get).toHaveBeenCalledWith(
      '/api/v1/platform/departments/tree',
      { signal },
    )
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/departments', createInput)
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/api/v1/platform/departments/dept%2Fid',
      updateInput,
    )
  })

  it('passes only real pagination and department member query parameters', async () => {
    const signal = new AbortController().signal

    await fetchPosts({ page: 2, pageSize: 50 }, signal)
    await fetchDepartmentMembers({
      departmentId: 'dept-1',
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
    }, signal)

    expect(mockedApi.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/posts',
      { params: { page: 2, pageSize: 50 }, signal },
    )
    expect(mockedApi.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/users',
      {
        params: {
          departmentId: 'dept-1',
          page: 1,
          pageSize: 20,
          status: 'ACTIVE',
        },
        signal,
      },
    )
  })

  it('uses dedicated status and nested dictionary item routes', async () => {
    const itemInput = {
      enabled: true,
      label: '启用',
      metadata: { color: 'green' },
      sortOrder: 1,
      value: 'enabled',
    }

    await updatePostStatus('post-1', false)
    await updateDictionary('dict-1', { enabled: false })
    await createDictionaryItem('dict-1', itemInput)
    await deleteDictionaryItem('dict-1', 'item-1')

    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/posts/post-1/status',
      { enabled: false },
    )
    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/dictionaries/dict-1',
      { enabled: false },
    )
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/dictionaries/dict-1/items',
      itemInput,
    )
    expect(mockedApi.delete).toHaveBeenCalledWith(
      '/api/v1/platform/dictionaries/dict-1/items/item-1',
    )
  })

  it('uses menu management routes without persisting unsupported fields', async () => {
    const menuInput = {
      component: 'system/menu/index',
      enabled: true,
      icon: 'settings',
      isExternal: false,
      menuType: 'MENU' as const,
      name: '菜单管理',
      parentId: 'system-root',
      permissionCode: 'system:menu:list',
      routePath: '/system/menu',
      sortOrder: 30,
      visible: true,
    }
    const signal = new AbortController().signal

    await fetchMenus(signal)
    await fetchPermissionResources(signal)
    await createMenu(menuInput)
    await updateMenu('menu-1', { ...menuInput, name: '菜单管理（编辑）' })
    await updateMenuStatus('menu-1', false)
    await deleteMenu('menu-1')

    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/api/v1/platform/menus', { signal })
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/api/v1/platform/permissions', { signal })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/menus', menuInput)
    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/menus/menu-1',
      { ...menuInput, name: '菜单管理（编辑）' },
    )
    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/menus/menu-1',
      { enabled: false },
    )
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/menus/menu-1')
  })
})