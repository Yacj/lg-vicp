import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AppTableActions from './AppTableActions.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountActions(actions: InstanceType<typeof AppTableActions>['$props']['actions'], maxVisible = 2) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppTableActions, { actions, maxVisible }),
  })
  app.use(TDesign)
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('app table actions', () => {
  it('runs visible actions and ignores disabled actions', async () => {
    const edit = vi.fn()
    const remove = vi.fn()
    const container = mountActions([
      { handler: edit, key: 'edit', label: '编辑' },
      { disabled: true, handler: remove, key: 'remove', label: '删除', theme: 'danger' },
    ])

    const buttons = [...container.querySelectorAll('button')]
    buttons.find(button => button.textContent?.includes('编辑'))?.click()
    buttons.find(button => button.textContent?.includes('删除'))?.click()
    await nextTick()

    expect(edit).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
  })

  it('collapses excess actions into the more menu', async () => {
    const view = vi.fn()
    const container = mountActions([
      { handler: view, key: 'view', label: '查看' },
      { handler: vi.fn(), key: 'remove', label: '删除', theme: 'danger' },
    ], 1)

    expect(container.textContent).toContain('查看')
    expect(container.textContent).not.toContain('删除')

    const moreButton = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
    expect(moreButton).not.toBeNull()
  })
})