import type { VNode } from 'vue'
import TDesign, { FormItem, Input } from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AppCrudBatchBar from './AppCrudBatchBar.vue'
import AppCrudFormDialog from './AppCrudFormDialog.vue'
import AppCrudFormDrawer from './AppCrudFormDrawer.vue'
import AppImportUpload from './AppImportUpload.vue'
import AppPermissionSelector from './AppPermissionSelector.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mount(render: () => VNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render })
  app.use(TDesign)
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('crud business components', () => {
  it('renders selected state and delegates batch actions to slots', async () => {
    const onClear = vi.fn()
    const container = mount(() => h(AppCrudBatchBar, {
      onClear,
      selectedCount: 2,
    }, {
      default: ({ selectedCount }: { selectedCount: number }) => h('button', { class: 'batch-fixture' }, `处理 ${selectedCount} 项`),
    }))

    expect(container.textContent).toContain('已选择 2 项')
    expect(container.querySelector('.batch-fixture')?.textContent).toBe('处理 2 项')

    const clearButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('清空选择'))
    clearButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onClear).toHaveBeenCalledOnce()
  })

  it('validates the form before emitting the drawer submit intent', async () => {
    const onSubmit = vi.fn()
    mount(() => h(AppCrudFormDrawer, {
      columns: 2,
      formData: { name: '协议夹具' },
      mode: 'create',
      onSubmit,
      visible: true,
    }, {
      default: () => h('span', { class: 'form-fixture' }, '表单内容'),
    }))
    await nextTick()
    await nextTick()

    expect(document.body.textContent).toContain('表单内容')
    expect(document.body.querySelector('.app-crud-form-drawer__form.is-two-column')).not.toBeNull()
    const saveButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存'))
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  })

  it('validates the form before emitting the dialog submit intent', async () => {
    const onSubmit = vi.fn()
    mount(() => h(AppCrudFormDialog, {
      columns: 2,
      formData: { name: '协议夹具' },
      mode: 'create',
      onSubmit,
      visible: true,
    }, {
      default: () => h('span', { class: 'form-fixture' }, '表单内容'),
    }))
    await nextTick()
    await nextTick()

    expect(document.body.textContent).toContain('表单内容')
    expect(document.body.querySelector('.app-crud-form-dialog__form.is-two-column')).not.toBeNull()
    const saveButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存'))
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  })

  it('blocks the dialog submit when required rules fail', async () => {
    const onSubmit = vi.fn()
    mount(() => h(AppCrudFormDialog, {
      formData: { name: '' },
      mode: 'create',
      onSubmit,
      rules: { name: [{ message: '请输入名称', required: true }] },
      visible: true,
    }, {
      default: () => h('div', [
        h(FormItem, { name: 'name' }, () => h(Input, {
          modelValue: '',
          'onUpdate:modelValue': () => {},
        })),
      ]),
    }))
    await nextTick()
    await nextTick()

    const saveButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存'))
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('请输入名称')
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks the drawer submit when required rules fail', async () => {
    const onSubmit = vi.fn()
    mount(() => h(AppCrudFormDrawer, {
      formData: { name: '' },
      mode: 'create',
      onSubmit,
      rules: { name: [{ message: '请输入名称', required: true }] },
      visible: true,
    }, {
      default: () => h('div', [
        h(FormItem, { name: 'name' }, () => h(Input, {
          modelValue: '',
          'onUpdate:modelValue': () => {},
        })),
      ]),
    }))
    await nextTick()
    await nextTick()

    const saveButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存'))
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('请输入名称')
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('selects only enabled permission options', async () => {
    const onUpdate = vi.fn()
    const container = mount(() => h(AppPermissionSelector, {
      modelValue: [],
      'onUpdate:modelValue': onUpdate,
      options: [
        { label: '读取', value: 'read' },
        { disabled: true, label: '删除', value: 'remove' },
        {
          children: [{ label: '编辑', value: 'edit' }],
          label: '配置',
          value: 'config',
        },
      ],
    }))

    const selectAllButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('全选'))
    selectAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onUpdate).toHaveBeenCalledWith(['read', 'config', 'edit'])
  })

  it('delegates upload transport to the injected handler', async () => {
    const handler = vi.fn().mockResolvedValue({ imported: 1 })
    const onSuccess = vi.fn()
    const container = mount(() => h(AppImportUpload, {
      accept: '.csv',
      handler,
      onSuccess,
    }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['name\nfixture'], 'fixture.csv', { type: 'text/csv' })

    expect(input?.accept).toBe('.csv')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input?.dispatchEvent(new Event('change', { bubbles: true }))

    await vi.waitFor(() => expect(handler).toHaveBeenCalled())
    expect(handler).toHaveBeenCalledWith(file, expect.objectContaining({
      onProgress: expect.any(Function),
      signal: expect.any(AbortSignal),
    }))
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(file, { imported: 1 }))
  })
})