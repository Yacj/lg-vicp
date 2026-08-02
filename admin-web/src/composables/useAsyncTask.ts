import { getCurrentScope, onScopeDispose, readonly, ref, shallowRef } from 'vue'
import type { AsyncTaskRecord, FileRecord } from '@/types/file'

/**
 * 异步任务轮询状态机：
 * - 定时轮询后端任务状态（以文件状态接口为准）
 * - 到达终态（文件 READY/OCR_REQUIRED/FAILED/DELETED，任务 COMPLETED/FAILED）自动停止
 * - 页面卸载停止轮询并中止进行中的请求
 * - 浏览器切到后台自动降频
 * - 手动刷新、重试（重试动作由调用方注入，后端无独立任务接口）
 *
 * 后端不支持任务取消，故不提供取消操作。
 */

export type TaskPollingStatus = 'idle' | 'polling' | 'finished' | 'error'

export type FileTrackedState =
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'OCR_REQUIRED'
  | 'CANCELLED'

export interface TaskFileState {
  file: FileRecord
  task: AsyncTaskRecord | null
}

const TERMINAL_FILE_STATUSES = new Set(['READY', 'OCR_REQUIRED', 'FAILED', 'DELETED'])

export function isTerminalFileStatus(status: FileRecord['status']): boolean {
  return TERMINAL_FILE_STATUSES.has(status)
}

/** 将文件 + 任务投影为组件可消费的可判别联合状态。 */
export function projectFileTaskState(state: TaskFileState): {
  taskState: FileTrackedState
  displayStatus: string
} {
  if (state.task?.status === 'FAILED' || state.file.status === 'FAILED') {
    return { taskState: 'FAILED', displayStatus: 'FAILED' }
  }
  if (state.file.status === 'OCR_REQUIRED') {
    return { taskState: 'OCR_REQUIRED', displayStatus: 'OCR_REQUIRED' }
  }
  if (isTerminalFileStatus(state.file.status)) {
    return { taskState: 'COMPLETED', displayStatus: state.file.status }
  }
  return { taskState: 'PROCESSING', displayStatus: state.file.status }
}

export interface UseAsyncTaskOptions {
  /** 拉取任务状态的网络函数（文件：GET /files/:id/status）。 */
  fetchState: (signal?: AbortSignal) => Promise<TaskFileState>
  /** 轮询间隔（前台），默认 3000ms。 */
  intervalMs?: number
  /** 后台轮询间隔，默认 30000ms。 */
  backgroundIntervalMs?: number
  /** 连续失败达到该次数后停止轮询并进入 error，默认 3。 */
  maxConsecutiveErrors?: number
  /** 每次状态更新回调。 */
  onState?: (state: TaskFileState) => void
  /** 到达终态回调。 */
  onFinished?: (state: TaskFileState) => void
  /** 重试动作（由调用方按业务注入，如重新上传、重新排队生成）。 */
  retry?: () => Promise<unknown>
}

export function useAsyncTask(options: UseAsyncTaskOptions) {
  const intervalMs = options.intervalMs ?? 3000
  const backgroundIntervalMs = options.backgroundIntervalMs ?? 30000
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3

  const state = shallowRef<TaskFileState | null>(null)
  const pollingStatus = ref<TaskPollingStatus>('idle')
  const error = shallowRef<unknown>(null)
  const retrying = ref(false)
  const lastPolledAt = ref<number | null>(null)

  let timer: number | null = null
  let inFlight = false
  let consecutiveErrors = 0
  let disposed = false
  let activeController: AbortController | null = null

  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  function currentInterval(): number {
    return document.hidden ? backgroundIntervalMs : intervalMs
  }

  /** 单次拉取；返回是否已到达终态。 */
  async function pollOnce(): Promise<boolean> {
    if (inFlight || disposed) {
      return false
    }
    inFlight = true
    const controller = new AbortController()
    activeController = controller
    try {
      const next = await options.fetchState(controller.signal)
      if (disposed) {
        return false
      }
      consecutiveErrors = 0
      error.value = null
      state.value = next
      lastPolledAt.value = Date.now()
      options.onState?.(next)
      const projected = projectFileTaskState(next)
      const finished = projected.taskState !== 'PROCESSING'
      if (finished) {
        stop()
        pollingStatus.value = 'finished'
        options.onFinished?.(next)
      }
      return finished
    }
    catch (cause) {
      if (disposed || controller.signal.aborted) {
        return false
      }
      consecutiveErrors += 1
      error.value = cause
      if (consecutiveErrors >= maxConsecutiveErrors) {
        stop()
        pollingStatus.value = 'error'
        return true
      }
      return false
    }
    finally {
      inFlight = false
      if (activeController === controller) {
        activeController = null
      }
    }
  }

  async function runRound(): Promise<void> {
    if (disposed) {
      return
    }
    const reachedEnd = await pollOnce()
    if (disposed || reachedEnd) {
      return
    }
    if (pollingStatus.value === 'polling') {
      clearTimer()
      timer = window.setTimeout(() => {
        timer = null
        void runRound()
      }, currentInterval())
    }
  }

  /** 开始轮询：立即拉取一次，之后按间隔定时拉取。 */
  function start(): void {
    if (disposed || pollingStatus.value === 'polling') {
      return
    }
    pollingStatus.value = 'polling'
    error.value = null
    void runRound()
  }

  /** 停止轮询（保留已拉取的状态）。 */
  function stop(): void {
    clearTimer()
    if (pollingStatus.value === 'polling') {
      pollingStatus.value = 'idle'
    }
    activeController?.abort()
    activeController = null
  }

  /** 手动刷新：单次拉取，不改变轮询状态。 */
  async function refresh(): Promise<TaskFileState | null> {
    if (disposed) {
      return null
    }
    await pollOnce()
    return state.value
  }

  /** 执行注入的重试动作并重新开始轮询。 */
  async function retryTask(): Promise<void> {
    if (!options.retry || retrying.value) {
      return
    }
    retrying.value = true
    error.value = null
    try {
      await options.retry()
      state.value = null
      pollingStatus.value = 'idle'
      start()
    }
    finally {
      retrying.value = false
    }
  }

  function dispose(): void {
    disposed = true
    stop()
  }

  function onVisibilityChange(): void {
    if (disposed || pollingStatus.value !== 'polling') {
      return
    }
    // 重排定时器以应用前台/后台间隔
    clearTimer()
    timer = window.setTimeout(() => {
      timer = null
      void runRound()
    }, currentInterval())
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    error: readonly(error),
    lastPolledAt: readonly(lastPolledAt),
    pollingStatus: readonly(pollingStatus),
    refresh,
    retryTask,
    retrying: readonly(retrying),
    start,
    state: readonly(state),
    stop,
  }
}