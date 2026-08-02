import type { TableRowData } from 'tdesign-vue-next'
import { describe, expect, it, vi } from 'vitest'
import { useCrudList } from './useCrudList'

interface ListItem extends TableRowData {
  id: string
  name: string
}

interface ListQuery extends Record<string, unknown> {
  keyword: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('crud list state', () => {
  it('loads again when a list owner is recreated', async () => {
    const fetcher = vi.fn(async () => ({
      items: [{ id: 'fixture-item', name: '协议夹具' }],
      page: 1,
      pageSize: 20,
      total: 1,
    }))
    const createList = () => useCrudList<ListItem, ListQuery>({
      createQuery: () => ({ keyword: '' }),
      fetcher,
      immediate: true,
      rowKey: 'id',
    })

    const first = createList()
    await vi.waitFor(() => expect(first.status.value).toBe('ready'))
    const second = createList()
    await vi.waitFor(() => expect(second.status.value).toBe('ready'))

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(second.data.value).toEqual([{ id: 'fixture-item', name: '协议夹具' }])
  })

  it('keeps query, pagination and reset in one request boundary', async () => {
    const fetcher = vi.fn(async ({ page, pageSize }: { page: number, pageSize: number }) => ({
      items: [{ id: `item-${page}`, name: '协议夹具' }],
      page,
      pageSize,
      total: 42,
    }))
    const list = useCrudList<ListItem, ListQuery>({
      createQuery: () => ({ keyword: '' }),
      fetcher,
      rowKey: 'id',
    })

    list.query.keyword = 'beam'
    await list.changePage({ current: 3, pageSize: 50 })

    expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 3,
      pageSize: 50,
      query: { keyword: 'beam' },
    }))
    expect(list.current.value).toBe(3)
    expect(list.total.value).toBe(42)

    await list.reset()

    expect(list.query.keyword).toBe('')
    expect(list.current.value).toBe(1)
    expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      query: { keyword: '' },
    }))
  })

  it('lets only the latest request update table state', async () => {
    const first = deferred<{ items: ListItem[], page: number, pageSize: number, total: number }>()
    const second = deferred<{ items: ListItem[], page: number, pageSize: number, total: number }>()
    const fetcher = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const list = useCrudList<ListItem, ListQuery>({
      createQuery: () => ({ keyword: '' }),
      fetcher,
      rowKey: 'id',
    })

    const firstLoad = list.load()
    const secondLoad = list.load()
    second.resolve({
      items: [{ id: 'latest', name: '最新结果' }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    await secondLoad
    first.resolve({
      items: [{ id: 'stale', name: '过期结果' }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    await firstLoad

    expect(list.data.value).toEqual([{ id: 'latest', name: '最新结果' }])
    expect(fetcher.mock.calls[0]?.[0].signal.aborted).toBe(true)
    expect(list.status.value).toBe('ready')
  })

  it('owns cross-page selection and exposes recoverable errors', async () => {
    const item = { id: 'selected', name: '已选择项' }
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ items: [item], page: 1, pageSize: 20, total: 2 })
      .mockResolvedValueOnce({ items: [], page: 2, pageSize: 20, total: 2 })
      .mockRejectedValueOnce(new Error('network failed'))
    const list = useCrudList<ListItem, ListQuery>({
      createQuery: () => ({ keyword: '' }),
      fetcher,
      reserveSelection: true,
      rowKey: 'id',
    })

    await list.load()
    list.changeSelection(['selected'], { selectedRowData: [item] })
    await list.changePage({ current: 2, pageSize: 20 })

    expect(list.selectedRowKeys.value).toEqual(['selected'])
    expect(list.selectedRows.value).toEqual([item])

    await list.retry()

    expect(list.tableStatus.value).toBe('error')
    expect(list.error.value).toEqual(new Error('network failed'))
    list.clearSelection()
    expect(list.hasSelection.value).toBe(false)
  })
})