import type { ReportDetail, ReportTaskResult } from '@/api/types'
import { ref } from 'vue'
import { reportAccessDenied, reportDetailPresentation, reportErrorMessage } from '@/utils/aiReportTask'

interface ReportDetailApi {
  get: (id: string) => Promise<ReportDetail>
  retry: (id: string) => Promise<ReportTaskResult>
}

interface ReportDetailScheduler {
  set: (callback: () => void) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

/** 详情页本地状态；聊天页隐藏时停止其原轮询，详情不写 assistant store。 */
export function useReportDetail(context: () => { id: string, userId: string | null }, api: ReportDetailApi, scheduler: ReportDetailScheduler = {
  set: callback => setTimeout(callback, 2000),
  clear: timer => clearTimeout(timer),
}) {
  const detail = ref<ReportDetail | null>(null)
  const status = ref<'loading' | 'success' | 'error'>('loading')
  const errorMessage = ref('')
  const refreshing = ref(false)
  const retrying = ref(false)
  let active = false
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let ownerUserId: string | null = null

  function clearTimer() {
    if (timer !== null)
      scheduler.clear(timer)
    timer = null
  }

  function current(sequence: number, id: string, userId: string | null) {
    const now = context()
    return active && revision === sequence && now.id === id && now.userId === userId
  }

  function schedule(sequence: number, id: string, userId: string | null) {
    clearTimer()
    if (current(sequence, id, userId) && detail.value && reportDetailPresentation(detail.value).shouldPoll)
      timer = scheduler.set(() => { void refresh() })
  }

  async function fetchDetail() {
    if (!active || refreshing.value)
      return
    clearTimer()
    const { id, userId } = context()
    const sequence = revision
    if (!id || !userId) {
      detail.value = null
      status.value = 'error'
      errorMessage.value = !userId ? '请登录后查看报告' : '缺少报告编号，请返回报告列表'
      return
    }
    refreshing.value = true
    if (!detail.value)
      status.value = 'loading'
    try {
      const response = await api.get(id)
      if (!current(sequence, id, userId))
        return
      if (response.report.id !== id)
        throw new Error('报告详情与当前报告不一致')
      detail.value = response
      status.value = 'success'
      errorMessage.value = ''
    }
    catch (error) {
      if (!current(sequence, id, userId))
        return
      errorMessage.value = reportErrorMessage(error)
      if (reportAccessDenied(error))
        detail.value = null
      status.value = detail.value ? 'success' : 'error'
    }
    finally {
      if (current(sequence, id, userId)) {
        refreshing.value = false
        schedule(sequence, id, userId)
      }
    }
  }

  async function refresh() {
    if (!retrying.value)
      await fetchDetail()
  }

  function stop() {
    active = false
    revision++
    clearTimer()
    refreshing.value = false
    retrying.value = false
  }

  async function start() {
    stop()
    active = true
    if (detail.value?.report.id !== context().id || !context().userId || ownerUserId !== context().userId)
      detail.value = null
    ownerUserId = context().userId
    await refresh()
  }

  function reset() {
    stop()
    detail.value = null
    ownerUserId = null
    errorMessage.value = ''
    status.value = 'loading'
  }

  async function retry() {
    if (!active || !detail.value || detail.value.report.status !== 'FAILED' || retrying.value || refreshing.value)
      return false
    const { id, userId } = context()
    if (!userId)
      return false
    const sequence = revision
    retrying.value = true
    errorMessage.value = ''
    try {
      const result = await api.retry(id)
      if (!current(sequence, id, userId))
        return false
      if (result.reportId !== id)
        throw new Error('重试任务与当前报告不一致')
      detail.value = { ...detail.value, report: { ...detail.value.report, status: result.status ?? 'QUEUED', errorMessage: null }, task: null }
      await fetchDetail()
      return true
    }
    catch (error) {
      if (current(sequence, id, userId)) {
        errorMessage.value = reportErrorMessage(error)
        if (reportAccessDenied(error)) {
          detail.value = null
          status.value = 'error'
        }
      }
      return false
    }
    finally {
      if (current(sequence, id, userId))
        retrying.value = false
    }
  }

  return { detail, status, errorMessage, refreshing, retrying, start, stop, reset, refresh, retry }
}
