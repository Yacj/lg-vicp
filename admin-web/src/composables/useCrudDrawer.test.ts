import { describe, expect, it, vi } from 'vitest'
import { useCrudDrawer } from './useCrudDrawer'

interface Entity {
  id: string
  name: string
}

interface EntityForm extends Record<string, unknown> {
  name: string
}

describe('crud drawer state', () => {
  it('maps create, edit and view modes without leaking entity shape into the component', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved' })
    const drawer = useCrudDrawer<EntityForm, Entity, { id: string }>({
      createForm: () => ({ name: '' }),
      editForm: entity => ({ name: entity.name }),
      submit: save,
    })

    drawer.openCreate()
    drawer.formData.name = '新增项'
    const result = await drawer.submit()

    expect(result).toEqual({ ok: true, value: { id: 'saved' } })
    expect(save).toHaveBeenCalledWith({
      data: { name: '新增项' },
      entity: null,
      mode: 'create',
    })
    expect(drawer.visible.value).toBe(false)

    const entity = { id: 'entity-1', name: '已有项' }
    drawer.openEdit(entity)
    expect(drawer.formData).toMatchObject({ name: '已有项' })
    expect(drawer.entity.value).toStrictEqual(entity)

    drawer.openView(entity)
    await expect(drawer.submit()).resolves.toEqual({ ok: false, reason: 'readonly' })
    expect(drawer.isReadonly.value).toBe(true)
  })

  it('keeps failed data visible and allows retry', async () => {
    const error = new Error('保存失败')
    const onError = vi.fn()
    const save = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('saved')
    const drawer = useCrudDrawer<EntityForm, Entity, string>({
      createForm: () => ({ name: '' }),
      editForm: entity => ({ name: entity.name }),
      onError,
      submit: save,
    })

    drawer.openCreate()
    drawer.formData.name = '待重试'
    await expect(drawer.submit()).resolves.toEqual({ ok: false, reason: 'error', error })

    expect(drawer.visible.value).toBe(true)
    expect(drawer.formData.name).toBe('待重试')
    expect(drawer.status.value).toBe('error')
    expect(onError).toHaveBeenCalledWith(error)

    await expect(drawer.submit()).resolves.toEqual({ ok: true, value: 'saved' })
    expect(drawer.visible.value).toBe(false)
  })

  it('does not turn a successful save into a failed save when refresh fails', async () => {
    const refreshError = new Error('刷新失败')
    const drawer = useCrudDrawer<EntityForm, Entity, string>({
      createForm: () => ({ name: '' }),
      editForm: entity => ({ name: entity.name }),
      onSuccess: vi.fn().mockRejectedValue(refreshError),
      submit: vi.fn().mockResolvedValue('saved'),
    })

    drawer.openCreate()

    await expect(drawer.submit()).rejects.toBe(refreshError)
    expect(drawer.status.value).toBe('success')
    expect(drawer.visible.value).toBe(false)
  })
})