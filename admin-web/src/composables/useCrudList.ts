import type { PageInfo, SelectOptions, TableRowData } from 'tdesign-vue-next'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  shallowRef,
  toRaw,
} from 'vue'
import type { CrudKey, CrudListFetcher, CrudListStatus } from '@/types/crud'

export interface UseCrudListOptions<
  TItem extends TableRowData,
  TQuery extends Record<string, unknown>,
> {
  createQuery: () => TQuery
  fetcher: CrudListFetcher<TItem, TQuery>
  rowKey: keyof TItem | ((item: TItem) => CrudKey)
  immediate?: boolean
  initialPage?: number
  pageSize?: number
  reserveSelection?: boolean
  onError?: (error: unknown) => void
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function useCrudList<
  TItem extends TableRowData,
  TQuery extends Record<string, unknown>,
>(options: UseCrudListOptions<TItem, TQuery>) {
  const query = reactive(options.createQuery()) as TQuery
  const data = shallowRef<TItem[]>([])
  const current = ref(positiveInteger(options.initialPage ?? 1, 1))
  const pageSize = ref(positiveInteger(options.pageSize ?? 20, 20))
  const total = ref(0)
  const status = ref<CrudListStatus>('idle')
  const error = shallowRef<unknown>(null)
  const selectedRowKeys = ref<CrudKey[]>([])
  const selectedRowMap = shallowRef(new Map<CrudKey, TItem>())

  let requestSequence = 0
  let activeController: AbortController | null = null

  const isLoading = computed(() => status.value === 'loading')
  const rows = computed<TItem[]>(() => data.value)
  const hasSelection = computed(() => selectedRowKeys.value.length > 0)
  const selectedRows = computed(() => selectedRowKeys.value
    .map(key => selectedRowMap.value.get(key))
    .filter((item): item is TItem => item !== undefined))
  const tableStatus = computed<'ready' | 'loading' | 'error'>(() => {
    if (status.value === 'loading') {
      return 'loading'
    }
    return status.value === 'error' ? 'error' : 'ready'
  })

  function resolveRowKey(item: TItem): CrudKey {
    const value = typeof options.rowKey === 'function'
      ? options.rowKey(item)
      : item[options.rowKey]
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError('CRUD 列表的 rowKey 必须解析为 string 或 number')
    }
    return value
  }

  function syncSelectionWithPage(items: TItem[]): void {
    const nextMap = new Map(selectedRowMap.value)
    items.forEach((item) => {
      const key = resolveRowKey(item)
      if (selectedRowKeys.value.includes(key)) {
        nextMap.set(key, item)
      }
    })

    if (!options.reserveSelection) {
      const pageKeys = new Set(items.map(resolveRowKey))
      selectedRowKeys.value = selectedRowKeys.value.filter(key => pageKeys.has(key))
    }

    const selectedKeys = new Set(selectedRowKeys.value)
    selectedRowMap.value = new Map(
      [...nextMap].filter(([key]) => selectedKeys.has(key)),
    )
  }

  async function load(): Promise<void> {
    activeController?.abort()
    const controller = new AbortController()
    const sequence = ++requestSequence
    activeController = controller
    status.value = 'loading'
    error.value = null

    try {
      const result = await options.fetcher({
        query: { ...toRaw(query) } as Readonly<TQuery>,
        page: current.value,
        pageSize: pageSize.value,
        signal: controller.signal,
      })
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }

      data.value = result.items
      current.value = positiveInteger(result.page, current.value)
      pageSize.value = positiveInteger(result.pageSize, pageSize.value)
      total.value = Math.max(0, result.total)
      syncSelectionWithPage(result.items)
      status.value = 'ready'
    }
    catch (cause) {
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      error.value = cause
      status.value = 'error'
      options.onError?.(cause)
    }
    finally {
      if (sequence === requestSequence) {
        activeController = null
      }
    }
  }

  async function search(): Promise<void> {
    current.value = 1
    await load()
  }

  async function reset(): Promise<void> {
    Object.keys(query).forEach(key => delete query[key])
    Object.assign(query, options.createQuery())
    current.value = 1
    clearSelection()
    await load()
  }

  async function changePage(pageInfo: Pick<PageInfo, 'current' | 'pageSize'>): Promise<void> {
    current.value = positiveInteger(pageInfo.current, current.value)
    pageSize.value = positiveInteger(pageInfo.pageSize, pageSize.value)
    await load()
  }

  function changeSelection(
    keys: CrudKey[],
    selection?: Pick<SelectOptions<TItem>, 'selectedRowData'>,
  ): void {
    const normalizedKeys = [...new Set(keys)]
    const nextMap = new Map(selectedRowMap.value)
    selection?.selectedRowData.forEach(item => nextMap.set(resolveRowKey(item), item))
    const selectedKeys = new Set(normalizedKeys)

    selectedRowKeys.value = normalizedKeys
    selectedRowMap.value = new Map(
      [...nextMap].filter(([key]) => selectedKeys.has(key)),
    )
  }

  function clearSelection(): void {
    selectedRowKeys.value = []
    selectedRowMap.value = new Map()
  }

  function setQuery(patch: Partial<TQuery>): void {
    Object.assign(query, patch)
  }

  function cancel(): void {
    if (!activeController) {
      return
    }
    requestSequence += 1
    activeController.abort()
    activeController = null
    status.value = data.value.length > 0 ? 'ready' : 'idle'
  }

  if (getCurrentScope()) {
    onScopeDispose(cancel)
  }
  if (options.immediate) {
    void load()
  }

  return {
    cancel,
    changePage,
    changeSelection,
    clearSelection,
    current: readonly(current),
    data: rows,
    error: readonly(error),
    hasSelection,
    isLoading,
    load,
    pageSize: readonly(pageSize),
    query,
    refresh: load,
    reset,
    retry: load,
    search,
    selectedRowKeys: readonly(selectedRowKeys),
    selectedRows,
    setQuery,
    status: readonly(status),
    tableStatus,
    total: readonly(total),
  }
}