import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import type { VNode } from 'vue'
import AppDataTable from './AppDataTable.vue'

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '名称', width: 220 },
  { colKey: 'status', title: '状态', width: 140 },
]
const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountDataTable(
  props: Record<string, unknown> = {},
  withOperations = false,
  operationRenderer?: (row: TableRowData) => VNode,
) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppDataTable, {
      columns,
      rowKey: 'id',
      ...props,
    }, withOperations
      ? {
          operations: ({ row }: { row: TableRowData }) => operationRenderer?.(row)
            ?? h('span', { class: 'operation-fixture' }, `查看 ${row.name}`),
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

  it('keeps nested rows collapsed when no expanded keys are provided', async () => {
    const container = mountDataTable({
      data: [{
        children: [{ id: 'child-1', name: '下级节点', status: 'READY' }],
        id: 'parent-1',
        name: '上级节点',
        status: 'READY',
      }],
      expandedTreeNodes: [],
      total: 1,
      tree: { childrenKey: 'children' },
    })
    await nextTick()
    await nextTick()

    expect(container.textContent).toContain('上级节点')
    expect(container.textContent).not.toContain('下级节点')
  })

  it('renders nested rows when tree data is enabled', async () => {
    const container = mountDataTable({
      data: [{
        children: [{ id: 'child-1', name: '下级节点', status: 'READY' }],
        id: 'parent-1',
        name: '上级节点',
        status: 'READY',
      }],
      expandedTreeNodes: ['parent-1'],
      total: 1,
      tree: { childrenKey: 'children' },
    })
    await nextTick()
    await nextTick()

    expect(container.textContent).toContain('上级节点')
    expect(container.textContent).toContain('下级节点')
  })

  it('does not expand a tree row when an operation is clicked', async () => {
    const onAction = vi.fn()
    const onExpandedTreeNodesChange = vi.fn()
    const container = mountDataTable({
      data: [{
        children: [{ id: 'child-1', name: '下级节点', status: 'READY' }],
        id: 'parent-1',
        name: '上级节点',
        status: 'READY',
      }],
      expandedTreeNodes: [],
      onExpandedTreeNodesChange,
      total: 1,
      tree: { childrenKey: 'children', expandTreeNodeOnClick: true },
    }, true, () => h('button', { class: 'operation-action', onClick: onAction }, '编辑'))
    await nextTick()
    await nextTick()

    container.querySelector<HTMLButtonElement>('.operation-action')?.click()
    await nextTick()

    expect(onAction).toHaveBeenCalledOnce()
    expect(onExpandedTreeNodesChange).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('下级节点')
  })

  it('fills the available body area by default and honors explicit max height', async () => {
    const adaptive = mountDataTable({
      data: [{ id: 'row-1', name: '自适应表格', status: 'READY' }],
      total: 1,
    })
    await nextTick()
    await nextTick()

    expect(adaptive.querySelector<HTMLElement>('.t-table__content')?.style.maxHeight).toBe('')

    const fixed = mountDataTable({
      data: [{ id: 'row-1', name: '固定高度表格', status: 'READY' }],
      maxHeight: 640,
      total: 1,
    })
    await nextTick()
    await nextTick()

    expect(fixed.querySelector<HTMLElement>('.t-table__content')?.style.maxHeight).toBe('640px')
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

  it('forwards controlled row selection for batch workflows', async () => {
    const onSelectionChange = vi.fn()
    const container = mountDataTable({
      data: [{ id: 'row-1', name: '协议夹具', status: 'READY' }],
      onSelectionChange,
      rowSelectionType: 'multiple',
      selectedRowKeys: [],
      total: 1,
    })
    await nextTick()
    await nextTick()

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    checkboxes.item(checkboxes.length - 1).click()
    await nextTick()

    expect(onSelectionChange).toHaveBeenCalledWith(
      ['row-1'],
      expect.objectContaining({ selectedRowData: [expect.objectContaining({ id: 'row-1' })] }),
    )
  })
})
