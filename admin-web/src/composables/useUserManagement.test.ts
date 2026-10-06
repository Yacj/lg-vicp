import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogPlugin } from 'tdesign-vue-next'

const apiMocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  exportUsersCsv: vi.fn(),
  fetchUserDetail: vi.fn(),
  fetchUsers: vi.fn(),
  importUsers: vi.fn(),
  resetUserPassword: vi.fn(),
  restoreUser: vi.fn(),
  setUserRoles: vi.fn(),
  updateUser: vi.fn(),
  updateUserStatus: vi.fn(),
}))

const systemMocks = vi.hoisted(() => ({
  fetchDepartmentTree: vi.fn(),
  fetchPosts: vi.fn(),
}))

const roleMocks = vi.hoisted(() => ({
  fetchRoles: vi.fn(),
}))

vi.mock('tdesign-vue-next', () => ({
  DialogPlugin: { confirm: vi.fn() },
  MessagePlugin: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  NotifyPlugin: {},
}))

vi.mock('@/api/modules/users', () => apiMocks)
vi.mock('@/api/modules/system-management', () => systemMocks)
vi.mock('@/api/modules/roles', () => roleMocks)
vi.mock('./useAppFeedback', () => ({
  useAppFeedback: () => ({
    message: vi.fn(),
    messageError: vi.fn(),
  }),
}))

const { useUserManagement } = await import('./useUserManagement')

describe('useUserManagement unified account contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.fetchUsers.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
    apiMocks.createUser.mockResolvedValue({ message: '用户创建成功', user: { id: 'admin-1' } })
    apiMocks.updateUser.mockResolvedValue({ message: '用户资料修改成功', user: { id: 'admin-1' } })
    apiMocks.updateUserStatus.mockResolvedValue({ message: '用户状态修改成功', user: { id: 'admin-1' } })
    apiMocks.deleteUser.mockResolvedValue({ message: '用户删除成功' })
    systemMocks.fetchDepartmentTree.mockResolvedValue({ items: [] })
    systemMocks.fetchPosts.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 })
    roleMocks.fetchRoles.mockResolvedValue({ items: [] })
    vi.mocked(DialogPlugin.confirm).mockReturnValue({
      destroy: vi.fn(),
      setConfirmLoading: vi.fn(),
      update: vi.fn(),
    } as never)
  })

  it('lists admin and client identities as one user row', async () => {
    apiMocks.fetchUsers.mockResolvedValueOnce({
      items: [
        {
          appAccess: [
            { app: 'ADMIN', role: 'SUPER_ADMIN', status: 'ACTIVE' },
            { app: 'CLIENT', role: 'NORMAL_USER', status: 'ACTIVE' },
          ],
          displayName: '张三',
          id: 'user-zhang',
          role: 'SUPER_ADMIN',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))
    expect(api.userList.data.value).toHaveLength(1)
    expect(api.userList.data.value[0]?.displayName).toBe('张三')
    expect(api.userList.data.value[0]?.appAccess?.map(item => item.app)).toEqual(['ADMIN', 'CLIENT'])
    expect(apiMocks.fetchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
      expect.any(AbortSignal),
    )
  })

  it('maps access-end filters to existing role query params only', async () => {
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))

    api.userList.query.accessApp = 'ADMIN'
    await api.userList.search()
    expect(apiMocks.fetchUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'SUPER_ADMIN' }),
      expect.any(AbortSignal),
    )
    expect(apiMocks.fetchUsers.mock.calls.at(-1)?.[0]).not.toHaveProperty('accessApp')
    expect(apiMocks.fetchUsers.mock.calls.at(-1)?.[0]).not.toHaveProperty('roleId')

    api.userList.query.accessApp = 'CLIENT'
    await api.userList.search()
    expect(apiMocks.fetchUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'NORMAL_USER' }),
      expect.any(AbortSignal),
    )
  })

  it('creates only SUPER_ADMIN admin access and does not open CLIENT', async () => {
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))
    api.userDrawer.openCreate()
    api.userDrawer.formData.identifier = 'admin.one'
    api.userDrawer.formData.password = 'Vicp@12345'
    api.userDrawer.formData.displayName = '平台管理员'
    api.userDrawer.formData.phone = '13800138000'
    await api.userDrawer.submit()

    const payload = apiMocks.createUser.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      displayName: '平台管理员',
      identifier: 'admin.one',
      phone: '13800138000',
      role: 'SUPER_ADMIN',
    })
    expect(payload).not.toHaveProperty('departmentIds')
    expect(payload).not.toHaveProperty('postIds')
    expect(payload).not.toHaveProperty('appAccess')
    expect(payload.role).not.toBe('NORMAL_USER')
    expect(payload.adminLoginEnabled).toBeUndefined()
  })

  it('sends optional department and post assignments when creating a super admin', async () => {
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))
    api.userDrawer.openCreate()
    api.userDrawer.formData.identifier = 'admin.one'
    api.userDrawer.formData.password = 'Vicp@12345'
    api.userDrawer.formData.displayName = '平台管理员'
    api.userDrawer.formData.phone = '13800138000'
    api.userDrawer.formData.departmentIds = ['dept-1']
    api.userDrawer.formData.postIds = ['post-1']
    await api.userDrawer.submit()

    expect(apiMocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      departmentIds: ['dept-1'],
      displayName: '平台管理员',
      postIds: ['post-1'],
      role: 'SUPER_ADMIN',
    }))
  })

  it('confirms disable with a both-end login warning', async () => {
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))
    void api.statusAction.run({
      status: 'DISABLED',
      user: {
        displayName: '张三',
        id: 'user-zhang',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      } as never,
    })
    await vi.waitFor(() => expect(DialogPlugin.confirm).toHaveBeenCalled())
    const options = vi.mocked(DialogPlugin.confirm).mock.calls[0]?.[0] as {
      body?: string
      header?: string
      onClose?: () => void
    }
    expect(options).toMatchObject({
      body: expect.stringContaining('禁用后该用户将无法登录管理后台和客户端'),
      header: '禁用账号',
    })
    options.onClose?.()
  })

  it('deletes through the user endpoint and never patches identities or app access', async () => {
    const api = useUserManagement()
    await vi.waitFor(() => expect(api.userList.status.value).toBe('ready'))
    void api.deleteAction.run({
      displayName: '张三',
      id: 'user-zhang',
      role: 'SUPER_ADMIN',
    } as never)
    await vi.waitFor(() => expect(DialogPlugin.confirm).toHaveBeenCalled())
    expect(apiMocks.deleteUser).not.toHaveBeenCalled()
    const confirm = vi.mocked(DialogPlugin.confirm).mock.calls[0]?.[0] as {
      onConfirm?: () => Promise<void>
    }
    await confirm.onConfirm?.()
    expect(apiMocks.deleteUser).toHaveBeenCalledWith('user-zhang')
    expect(apiMocks.deleteUser).toHaveBeenCalledTimes(1)
  })
})
