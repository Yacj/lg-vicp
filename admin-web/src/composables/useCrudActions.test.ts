import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirmAndRun: vi.fn(),
  message: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./useAppConfirm', () => ({
  confirmAndRun: mocks.confirmAndRun,
}))

vi.mock('./useAppFeedback', () => ({
  useAppFeedback: () => ({ message: mocks.message }),
}))

const { useCrudBatchAction, useCrudDelete } = await import('./useCrudActions')

describe('confirmed crud actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs deletion only after confirmation and reports success', async () => {
    const remove = vi.fn().mockResolvedValue('removed')
    mocks.confirmAndRun.mockImplementation(async (
      _options: unknown,
      action: () => Promise<unknown>,
    ) => ({
      confirmed: true,
      value: await action(),
    }))
    const deletion = useCrudDelete<{ id: string, name: string }, string>({
      action: remove,
      confirm: item => ({ title: '删除', content: `删除 ${item.name}` }),
      successMessage: '删除成功',
    })
    const item = { id: 'item-1', name: '协议夹具' }

    await expect(deletion.run(item)).resolves.toEqual({ status: 'success', value: 'removed' })
    expect(remove).toHaveBeenCalledWith(item)
    expect(mocks.message).toHaveBeenCalledWith('success', '删除成功')
  })

  it('keeps batch cancellation side-effect free', async () => {
    const action = vi.fn()
    mocks.confirmAndRun.mockResolvedValue({ confirmed: false })
    const batch = useCrudBatchAction({
      action,
      confirm: keys => ({ title: '批量操作', content: `共 ${keys.length} 项` }),
    })

    await expect(batch.run(['a', 'b'])).resolves.toEqual({ status: 'cancelled' })
    expect(action).not.toHaveBeenCalled()
    expect(batch.running.value).toBe(false)
  })
})