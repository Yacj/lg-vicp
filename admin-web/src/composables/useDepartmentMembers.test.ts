import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  addDepartmentMember: vi.fn(),
  fetchDepartmentMembers: vi.fn(),
  fetchUsers: vi.fn(),
  removeDepartmentMember: vi.fn(),
}))

vi.mock('tdesign-vue-next', () => ({
  DialogPlugin: { confirm: vi.fn() },
  MessagePlugin: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  NotifyPlugin: {},
}))

vi.mock('@/api/modules/system-management', () => ({
  addDepartmentMember: apiMocks.addDepartmentMember,
  fetchDepartmentMembers: apiMocks.fetchDepartmentMembers,
  removeDepartmentMember: apiMocks.removeDepartmentMember,
}))
vi.mock('@/api/modules/users', () => ({
  fetchUsers: apiMocks.fetchUsers,
}))
vi.mock('./useAppFeedback', () => ({
  useAppFeedback: () => ({
    message: vi.fn(),
    messageError: vi.fn(),
  }),
}))

const { useDepartmentMembers } = await import('./useDepartmentMembers')

describe('useDepartmentMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.fetchDepartmentMembers.mockResolvedValue({
      items: [
        {
          displayName: '张三',
          isPrimary: true,
          joinedAt: '2026-01-01T00:00:00.000Z',
          phone: '13800138000',
          role: 'NORMAL_USER',
          status: 'ACTIVE',
          userId: 'user-1',
        },
      ],
    })
    apiMocks.fetchUsers.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
    apiMocks.addDepartmentMember.mockResolvedValue({
      member: { departmentId: 'dept-1', isPrimary: false, userId: 'user-2' },
      message: '部门成员已添加',
    })
  })

  it('loads members from the department members API and searches NORMAL_USER candidates', async () => {
    const api = useDepartmentMembers('dept-1')
    await vi.waitFor(() => expect(api.memberList.status.value).not.toBe('loading'), { timeout: 2000 })
    expect(apiMocks.fetchDepartmentMembers).toHaveBeenCalledWith('dept-1', expect.any(AbortSignal))
    expect(api.memberList.data.value[0]?.userId).toBe('user-1')

    api.openAdd()
    await vi.waitFor(() => expect(apiMocks.fetchUsers).toHaveBeenCalled(), { timeout: 2000 })
    expect(apiMocks.fetchUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'NORMAL_USER' }),
      expect.any(AbortSignal),
    )
  })
})
