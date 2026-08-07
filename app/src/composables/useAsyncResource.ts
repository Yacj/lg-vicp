export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * 页面「独立加载资源」的最小状态机：
 * idle → loading → success | error（error 由外部触发 load 重试）。
 *
 * revision 用于丢弃过期响应：详情页在 onShow 反复刷新时，
 * 先发出的慢请求不会覆盖后发出的结果。
 */
export function useAsyncResource<T>(loader: () => Promise<T>, initial: T) {
  const data = shallowRef<T>(initial)
  const status = ref<AsyncStatus>('idle')
  let revision = 0

  async function run(nextStatus: AsyncStatus | null) {
    const current = ++revision
    const previousStatus = status.value
    if (nextStatus) {
      status.value = nextStatus
    }

    try {
      const result = await loader()
      if (current !== revision) {
        return
      }
      data.value = result
      status.value = 'success'
    }
    catch {
      if (current !== revision) {
        return
      }
      status.value = nextStatus === null ? previousStatus : 'error'
    }
  }

  /** 首屏或重试：进入 loading，页面展示骨架/加载态 */
  const load = () => run('loading')

  /** 静默刷新：保留当前内容，失败也不打断用户（返场、轮询场景） */
  const refresh = () => run(null)

  function reset() {
    revision += 1
    data.value = initial
    status.value = 'idle'
  }

  return { data, status, load, refresh, reset }
}
