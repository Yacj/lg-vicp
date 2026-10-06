import { readonly, ref, shallowRef } from 'vue'
import { fetchReportTypes } from '@/api/modules/reports'
import type { PublicReportType } from '@/types/report'
import { normalizeFeedbackError } from './useAppFeedback'

export type ReportTypesStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 系统预置报告类型：GET /api/v1/reports/types。
 * 普通业务只消费 code/name/description/requiresProject/enabled。
 */
export function useReportTypes() {
  const types = shallowRef<PublicReportType[]>([])
  const status = ref<ReportTypesStatus>('idle')
  const error = shallowRef<unknown>(null)

  const errorDescription = () => (error.value
    ? normalizeFeedbackError(error.value).message
    : '请检查网络连接后重试')

  async function load(signal?: AbortSignal): Promise<PublicReportType[]> {
    status.value = 'loading'
    error.value = null
    try {
      const result = await fetchReportTypes(signal)
      types.value = result.items.filter(item => item.enabled)
      status.value = 'ready'
      return types.value
    }
    catch (cause) {
      error.value = cause
      status.value = 'error'
      types.value = []
      return []
    }
  }

  return {
    error: readonly(error),
    errorDescription,
    load,
    status: readonly(status),
    types: readonly(types),
  }
}
