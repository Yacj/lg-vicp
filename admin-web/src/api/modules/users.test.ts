import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, httpClient } from '@/api/http/client'
import {
  createUser,
  deleteUser,
  exportUsersCsv,
  fetchUserDetail,
  fetchUsers,
  importUsers,
  resetUserPassword,
  restoreUser,
  setUserDepartments,
  setUserPosts,
  setUserRoles,
  updateUser,
  updateUserStatus,
} from './users'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  httpClient: {
    request: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)
const mockedHttpClient = vi.mocked(httpClient)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('user api contracts', () => {
  it('queries the user list with real backend filter parameters only', async () => {
    const signal = new AbortController().signal
    await fetchUsers({
      departmentId: 'dept-1',
      includeDeleted: true,
      keyword: '张',
      page: 2,
      pageSize: 20,
      roleId: 'role-1',
      status: 'ACTIVE',
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/users', {
      params: {
        departmentId: 'dept-1',
        includeDeleted: true,
        keyword: '张',
        page: 2,
        pageSize: 20,
        roleId: 'role-1',
        status: 'ACTIVE',
      },
      signal,
    })
  })

  it('creates users with identifier/password and keeps the account type split', async () => {
    await createUser({
      channelType: 'DEALER',
      displayName: '张三',
      gender: 'MALE',
      identifier: 'zhangsan',
      password: 'Vicp@12345678',
      role: 'CHANNEL_USER',
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/users', {
      channelType: 'DEALER',
      displayName: '张三',
      gender: 'MALE',
      identifier: 'zhangsan',
      password: 'Vicp@12345678',
      role: 'CHANNEL_USER',
    })
  })

  it('updates profile fields and routes assignments to their dedicated endpoints', async () => {
    await updateUser('user-1', { displayName: '张三', role: 'NORMAL_USER', channelType: null })
    await updateUserStatus('user-1', 'DISABLED')
    await setUserRoles('user-1', ['role-1'])
    await setUserDepartments('user-1', ['dept-1'])
    await setUserPosts('user-1', ['post-1'])

    expect(mockedApi.patch).toHaveBeenNthCalledWith(1, '/api/v1/platform/users/user-1', {
      displayName: '张三',
      role: 'NORMAL_USER',
      channelType: null,
    })
    expect(mockedApi.patch).toHaveBeenNthCalledWith(2, '/api/v1/platform/users/user-1/status', {
      status: 'DISABLED',
    })
    expect(mockedApi.put).toHaveBeenNthCalledWith(1, '/api/v1/platform/users/user-1/roles', {
      roleIds: ['role-1'],
    })
    expect(mockedApi.put).toHaveBeenNthCalledWith(2, '/api/v1/platform/users/user-1/departments', {
      ids: ['dept-1'],
    })
    expect(mockedApi.put).toHaveBeenNthCalledWith(3, '/api/v1/platform/users/user-1/posts', {
      ids: ['post-1'],
    })
  })

  it('reads user detail and performs delete/restore/reset-password', async () => {
    await fetchUserDetail('user-1')
    await deleteUser('user-1')
    await restoreUser('user-1')
    await resetUserPassword('user-1', 'NewPass@123456')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/users/user-1')
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/users/user-1')
    expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/api/v1/platform/users/user-1/restore')
    expect(mockedApi.post).toHaveBeenNthCalledWith(2, '/api/v1/platform/users/user-1/reset-password', {
      password: 'NewPass@123456',
    })
  })

  it('posts csv content to the import endpoint and never a file payload', async () => {
    await importUsers({ csv: 'identifier,password\nzhangsan,Vicp@12345678' })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/users/import', {
      csv: 'identifier,password\nzhangsan,Vicp@12345678',
    })
  })

  it('downloads the export csv as blob through the raw http client', async () => {
    mockedHttpClient.request.mockResolvedValueOnce({
      data: new Blob(['\uFEFF用户']),
    } as never)
    const signal = new AbortController().signal

    const blob = await exportUsersCsv(signal)

    expect(mockedHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      responseType: 'blob',
      signal,
      url: '/api/v1/platform/users/export',
    })
    expect(blob).toBeInstanceOf(Blob)
  })
})