import type { AsyncStatus } from './useAsyncResource'
import { useAsyncResource } from './useAsyncResource'

export type SectionStatus = AsyncStatus

/**
 * 列表型区块，是 useAsyncResource 在 T[] 上的特化：
 * 区块之间互不影响，页面只消费 items/status，不再手写四态分支。
 */
export function useAsyncSection<T>(loader: () => Promise<T[]>) {
  const { data, status, load, refresh, reset } = useAsyncResource<T[]>(loader, [])

  return { items: data, status, load, refresh, reset }
}
