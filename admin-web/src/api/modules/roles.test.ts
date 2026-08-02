import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createRole,
  deleteRole,
  fetchRoleUsers,
  fetchRoles,
  fetchUserDetail,
  fetchUsers,
  setRoleDepartments,
  setRolePermissions,
  setUserRoles,
  updateRole,
  updateRoleStatus,
} from './roles'

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

describe('role api contracts', () => {
  it('uses the registered role routes and preserves the create/update field split', async () => {
    const signal = new AbortController().signal
    const createInput = {
      code: 'project_viewer',
      dataScope: 'SELF' as const,
      description: '查看项目',
      enabled: true,
      name: '项目查看者',
    }
    const updateInput = {
      dataScope: 'PROJECT_OWNER' as const,
      enabled: false,
      name: '项目查看者（停用）',
    }

    await fetchRoles(signal)
    await createRole(createInput)
    await updateRole('role-1', updateInput)
    await updateRoleStatus('role-1', true)
    await deleteRole('role-1')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/roles', { signal })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/roles', createInput)
    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/roles/role-1',
      updateInput,
    )
    expect(mockedApi.patch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/roles/role-1/status',
      { enabled: true },
    )
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/roles/role-1')
  })

  it('posts permission ids and department ids to their dedicated routes', async () => {
    await setRolePermissions('role-1', ['perm-1', 'perm-2'])
    await setRoleDepartments('role-1', ['dept-1'])

    expect(mockedApi.put).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/roles/role-1/permissions',
      { permissionIds: ['perm-1', 'perm-2'] },
    )
    expect(mockedApi.put).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/roles/role-1/departments',
      { ids: ['dept-1'] },
    )
  })

  it('reads role users with pagination and searches platform users with role filter', async () => {
    const signal = new AbortController().signal

    await fetchRoleUsers('role-1', { keyword: '张', page: 2, pageSize: 50 }, signal)
    await fetchUsers({ keyword: '张', page: 1, pageSize: 20 }, signal)

    expect(mockedApi.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/platform/roles/role-1/users',
      { params: { keyword: '张', page: 2, pageSize: 50 }, signal },
    )
    expect(mockedApi.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/platform/users',
      { params: { keyword: '张', page: 1, pageSize: 20 }, signal },
    )
  })

  it('reads user detail and assigns roles per user', async () => {
    await fetchUserDetail('user-1')
    await setUserRoles('user-1', ['role-1', 'role-2'])

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/users/user-1')
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/users/user-1/roles', {
      roleIds: ['role-1', 'role-2'],
    })
  })
})