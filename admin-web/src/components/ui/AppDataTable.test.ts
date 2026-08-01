import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AppDataTable from './AppDataTable.vue'

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '名称', width: 220 },
  { colKey: 'status', title: '状态', width: 140 },
]
const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountDataTable(props: Record<string, unknown> = {}, withOperations = false) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppDataTable, {
      columns,
      rowKey: 'id',
      ...props,
    }, withOperations
      ? {
          operations: ({ row }: { row: TableRowData }) => h('span', { class: 'operation-fixture' }, `查看 ${row.name}`),
        }
      : undefined),
  })
  app.use(createPinia())
  app.use(TDesign)
  app.mount(container)
  mountedApps.push(app)
  return container
}

beforeEach(() => {
  Object.defineProperty(document, 'fullScreen', { configurable: true, value: false })
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('app data table', () => {
  it('unifies loading, empty and total states', () => {
    const loading = mountDataTable({ status: 'loading', total: 0 })
    expect(loading.querySelector('.t-loading')).not.toBeNull()

    const empty = mountDataTable({ data: [], total: 0 })
    expect(empty.textContent).toContain('暂无数据')
    expect(empty.textContent).toContain('共 0 条')
  })

  it('unifies error retry and toolbar refresh', async () => {
    const onRetry = vi.fn()
    const error = mountDataTable({ onRetry, status: 'error' })
    const retryButton = [...error.querySelectorAll('button')]
      .find(button => button.textContent?.includes('重试'))
    retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const onRefresh = vi.fn()
    const table = mountDataTable({ onRefresh })
    table.querySelector('[aria-label="刷新表格"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('adds the fixed operation column and opens column settings', async () => {
    const container = mountDataTable({
      data: [{ id: 'row-1', name: '协议夹具', status: 'READY' }],
      total: 1,
    }, true)
    await nextTick()
    await nextTick()

    expect(container.textContent).toContain('操作')
    expect(container.querySelector('.operation-fixture')?.textContent).toBe('查看 协议夹具')

    container.querySelector('[aria-label="设置显示列"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(document.body.textContent).toContain('列配置')
  })

  it('emits controlled pagination and delegates fullscreen to browser capability', async () => {
    const onPageChange = vi.fn()
    const container = mountDataTable({ onPageChange, pageSize: 20, total: 41 })
    const nextButton = container.querySelector('.t-pagination__btn-next')
      ?? [...container.querySelectorAll('button')].find(button => button.title?.includes('下一页'))
    nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    container.querySelector('[aria-label="全屏表格"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    await new Promise(resolve => window.setTimeout(resolve, 0))

    expect(onPageChange).toHaveBeenCalled()
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled()
  })
})