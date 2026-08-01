import type { DialogInstance, DialogOptions } from 'tdesign-vue-next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  messageError: vi.fn().mockResolvedValue({ close: vi.fn() }),
  options: undefined as DialogOptions | undefined,
  instance: {
    destroy: vi.fn(),
    hide: vi.fn(),
    setConfirmLoading: vi.fn(),
    show: vi.fn(),
    update: vi.fn(),
  } as DialogInstance,
}))

vi.mock('tdesign-vue-next', () => ({
  DialogPlugin: { confirm: mocks.confirm },
  MessagePlugin: { error: mocks.messageError },
  NotifyPlugin: {},
}))

const { confirmAndRun } = await import('./useAppConfirm')

describe('app confirm flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.options = undefined
    mocks.confirm.mockImplementation((options: DialogOptions) => {
      mocks.options = options
      return mocks.instance
    })
  })

  it('locks the dialog while the confirmed action runs', async () => {
    const action = vi.fn().mockResolvedValue('saved')
    const result = confirmAndRun({ title: '保存', content: '确认保存吗？' }, action)

    mocks.options?.onConfirm?.({ e: new MouseEvent('click') })

    await expect(result).resolves.toEqual({ confirmed: true, value: 'saved' })
    expect(mocks.instance.setConfirmLoading).toHaveBeenCalledWith(true)
    expect(mocks.instance.update).toHaveBeenCalledWith({ closeOnEscKeydown: false })
    expect(mocks.instance.destroy).toHaveBeenCalledOnce()
  })

  it('resolves cancellation without running the action', async () => {
    const action = vi.fn().mockResolvedValue('unused')
    const result = confirmAndRun({ title: '离开', content: '确认离开吗？' }, action)

    mocks.options?.onClose?.({ trigger: 'cancel', e: new MouseEvent('click') })

    await expect(result).resolves.toEqual({ confirmed: false })
    expect(action).not.toHaveBeenCalled()
  })

  it('unlocks and reports errors so users can retry', async () => {
    const error = new Error('保存失败')
    const action = vi.fn().mockRejectedValue(error)
    const result = confirmAndRun({ title: '保存', content: '确认保存吗？' }, action)

    mocks.options?.onConfirm?.({ e: new MouseEvent('click') })
    await vi.waitFor(() => expect(mocks.messageError).toHaveBeenCalled())

    expect(mocks.instance.setConfirmLoading).toHaveBeenLastCalledWith(false)
    expect(mocks.instance.update).toHaveBeenLastCalledWith({ closeOnEscKeydown: true })
    mocks.options?.onClose?.({ trigger: 'cancel', e: new MouseEvent('click') })
    await expect(result).resolves.toEqual({ confirmed: false })
  })
})
