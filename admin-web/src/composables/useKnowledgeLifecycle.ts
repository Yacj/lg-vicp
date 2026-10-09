import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import type {
  KnowledgePageRecognitionSummary,
  KnowledgeVersionIndex,
  KnowledgeWorkspace,
} from '@/types/knowledge'
import { computed, onMounted, onUnmounted, ref, toValue, watch } from 'vue'
import { fetchKnowledgeWorkspace, fetchVersionIndex, fetchVersionPages } from '@/api/modules/knowledge'
import { isKnowledgeFileParsingInProgress, isKnowledgePageRenderingInProgress } from '@/utils/knowledge-user'

/** 默认轮询间隔：与后端解析 / 识别 / 索引任务的回写节奏对齐。 */
const DEFAULT_INTERVAL_MS = 3000
/** 单次轮询窗口上限：任务卡死时避免无限轮询。 */
const DEFAULT_MAX_POLL_MS = 120_000

export interface UseKnowledgeLifecycleOptions {
  /** 知识文档 ID；workspace 的唯一查询键。 */
  documentId: MaybeRefOrGetter<string>
  /** 挂载后是否立即拉取一次（默认 true）。 */
  immediate?: boolean
  /** 轮询间隔，默认 3000ms。 */
  intervalMs?: number
  /** 单次轮询窗口上限，默认 120000ms，超时自动停止。 */
  maxPollMs?: number
  /**
   * 每次 workspace 成功刷新后的回调。
   * 供页面层联动章节树 / 图库 key 等派生状态，composable 本身不感知业务分支。
   */
  onWorkspace?: (workspace: KnowledgeWorkspace) => void | Promise<void>
}

export interface KnowledgeLifecycleRefreshOptions {
  /** 静默刷新：不切换 loading 骨架（轮询与后台补拉时使用）。 */
  silent?: boolean
}

export interface UseKnowledgeLifecycleReturn {
  /** 知识库工作区：页面状态 / 发布门禁 / AI 可用性的唯一事实源。 */
  workspace: Ref<KnowledgeWorkspace | null>
  /** 当前版本知识索引状态。 */
  index: Ref<KnowledgeVersionIndex | null>
  /** 后端页面列表返回的识别进度汇总（不按页面列表自行统计）。 */
  recognitionSummary: Ref<KnowledgePageRecognitionSummary | null>
  /** 当前版本 ID：由 workspace 派生，避免多处重复推导。 */
  versionId: ComputedRef<string | null>
  /** 首次 / 手动刷新 loading（静默刷新不置位）。 */
  loading: Ref<boolean>
  /** 索引读取 loading。 */
  indexLoading: Ref<boolean>
  /** 识别汇总读取 loading。 */
  recognitionLoading: Ref<boolean>
  /** 最近一次非静默刷新错误。 */
  error: Ref<unknown>
  /** 是否存在需要继续轮询的进行中任务（解析 / 页图 / 索引 / 识别）。 */
  isBusy: ComputedRef<boolean>
  /** 当前是否处于轮询窗口内。 */
  isPolling: Ref<boolean>
  /**
   * 轮询心跳：每次 refresh 成功后自增。
   * 子面板（图库 / 识别校验）watch 该值即可复用页面级唯一定时器刷新自身列表，
   * 无需再各自起 setInterval。
   */
  pollTick: Ref<number>
  /** 全量刷新：workspace → index + recognition，并同步轮询开关。 */
  refresh: (options?: KnowledgeLifecycleRefreshOptions) => Promise<void>
  /** 仅刷新知识索引。 */
  refreshIndex: (options?: KnowledgeLifecycleRefreshOptions) => Promise<void>
  /** 仅刷新识别进度汇总。 */
  refreshRecognition: (options?: KnowledgeLifecycleRefreshOptions) => Promise<void>
  /** 手动开启轮询窗口（幂等：已在轮询时不重置 120s 上限）。 */
  startPolling: () => void
  /** 停止轮询并清理定时器。 */
  stopPolling: () => void
}

/**
 * 知识库生命周期统一轮询：workspace / 知识索引 / 识别进度三处共用同一个 3s 定时器，
 * 单一 120s 上限，组件卸载自动清理。
 *
 * 设计要点：
 * - 三处状态共用一个定时器，避免每个面板各起一个 setInterval 造成请求风暴。
 * - 定时器上限只在窗口开启时设置一次，刷新不重置，保证「最多轮询 120s」是硬上限。
 * - isBusy 由三处状态推导，轮询自动跟随；无进行中任务时自动停机。
 */
export function useKnowledgeLifecycle(
  options: UseKnowledgeLifecycleOptions,
): UseKnowledgeLifecycleReturn {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS

  const workspace = ref<KnowledgeWorkspace | null>(null)
  const index = ref<KnowledgeVersionIndex | null>(null)
  const recognitionSummary = ref<KnowledgePageRecognitionSummary | null>(null)
  const loading = ref(false)
  const indexLoading = ref(false)
  const recognitionLoading = ref(false)
  const error = ref<unknown>(null)
  const isPolling = ref(false)
  const pollTick = ref(0)

  const versionId = computed(() => workspace.value?.currentVersion?.id ?? null)

  const isBusy = computed(() => {
    const current = workspace.value
    if (current && (
      isKnowledgeFileParsingInProgress(current)
      || isKnowledgePageRenderingInProgress(current)
    )) {
      return true
    }
    if (index.value?.indexStatus === 'INDEXING') {
      return true
    }
    const recognition = recognitionSummary.value
    if (recognition && (recognition.processing > 0 || recognition.pending > 0)) {
      return true
    }
    return false
  })

  let timer: ReturnType<typeof setInterval> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let refreshSequence = 0
  let indexSequence = 0
  let recognitionSequence = 0
  let refreshInFlight = false

  function stopPolling(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (deadline) {
      clearTimeout(deadline)
      deadline = null
    }
    isPolling.value = false
  }

  function startPolling(): void {
    if (timer) {
      return
    }
    isPolling.value = true
    timer = setInterval(() => {
      void refresh({ silent: true })
    }, intervalMs)
    deadline = setTimeout(stopPolling, maxPollMs)
  }

  /** 轮询开关跟随 isBusy：有进行中任务则续轮询，否则停机。 */
  function syncPolling(): void {
    if (isBusy.value) {
      startPolling()
    }
    else {
      stopPolling()
    }
  }

  async function refreshIndex(opts: KnowledgeLifecycleRefreshOptions = {}): Promise<void> {
    const id = versionId.value
    const request = ++indexSequence
    if (!id) {
      index.value = null
      return
    }
    if (!opts.silent) {
      indexLoading.value = true
    }
    try {
      const next = await fetchVersionIndex(id)
      if (request === indexSequence && versionId.value === id) index.value = next
    }
    catch (cause) {
      if (!opts.silent) {
        error.value = cause
      }
    }
    finally {
      if (!opts.silent) {
        indexLoading.value = false
      }
    }
  }

  async function refreshRecognition(opts: KnowledgeLifecycleRefreshOptions = {}): Promise<void> {
    const id = versionId.value
    const request = ++recognitionSequence
    if (!id) {
      recognitionSummary.value = null
      return
    }
    if (!opts.silent) {
      recognitionLoading.value = true
    }
    try {
      // 页面列表已直接返回 pageRecognitionSummary，只取 1 条即可拿到全量汇总。
      const next = (await fetchVersionPages(id, 1, 1)).pageRecognitionSummary
      if (request === recognitionSequence && versionId.value === id) recognitionSummary.value = next
    }
    catch {
      if (!opts.silent) {
        recognitionSummary.value = null
      }
    }
    finally {
      if (!opts.silent) {
        recognitionLoading.value = false
      }
    }
  }

  async function refresh(opts: KnowledgeLifecycleRefreshOptions = {}): Promise<void> {
    if (opts.silent && refreshInFlight) return
    const request = ++refreshSequence
    const id = toValue(options.documentId)
    if (!id) {
      workspace.value = null
      index.value = null
      recognitionSummary.value = null
      return
    }
    if (!opts.silent) {
      loading.value = true
      error.value = null
    }
    refreshInFlight = true
    try {
      const next = await fetchKnowledgeWorkspace(id)
      if (request !== refreshSequence || id !== toValue(options.documentId)) return
      workspace.value = next
      await options.onWorkspace?.(next)
    }
    catch (cause) {
      if (!opts.silent && request === refreshSequence) {
        error.value = cause
      }
    }
    finally {
      if (request === refreshSequence) refreshInFlight = false
      if (!opts.silent && request === refreshSequence) {
        loading.value = false
      }
    }
    if (request !== refreshSequence || id !== toValue(options.documentId)) return
    await Promise.all([
      refreshIndex({ silent: opts.silent }),
      refreshRecognition({ silent: opts.silent }),
    ])
    if (request === refreshSequence && id === toValue(options.documentId)) {
      pollTick.value += 1
      syncPolling()
    }
  }

  watch(() => toValue(options.documentId), () => {
    stopPolling()
    refreshSequence += 1
    indexSequence += 1
    recognitionSequence += 1
    refreshInFlight = false
    workspace.value = null
    index.value = null
    recognitionSummary.value = null
    void refresh()
  })

  onMounted(() => {
    if (options.immediate !== false) {
      void refresh()
    }
  })

  onUnmounted(stopPolling)

  return {
    workspace,
    index,
    recognitionSummary,
    versionId,
    loading,
    indexLoading,
    recognitionLoading,
    error,
    isBusy,
    isPolling,
    pollTick,
    refresh,
    refreshIndex,
    refreshRecognition,
    startPolling,
    stopPolling,
  }
}
