import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { AsyncTaskStatus, FileRecord, FileStatus } from '@/types/file'
import { isTerminalFileStatus, projectFileTaskState, useAsyncTask } from './useAsyncTask'
import type { TaskFileState } from './useAsyncTask'

function makeFile(status: FileStatus): FileRecord {
  return {
    bucket: 'lg-vicp',
    createdAt: '2026-08-02T00:00:00.000Z',
    deletedAt: null,
    errorMessage: null,
    id: 'file-1',
    mimeType: 'application/pdf',
    objectKey: 'users/u/file-1.pdf',
    originalName: '设计图纸.pdf',
    ownerUserId: 'user-1',
    projectId: null,
    sha256: null,
    sizeBytes: 1024,
    status,
    storageProvider: 'minio',
    updatedAt: '2026-08-02T00:00:00.000Z',
    version: 1,
  }
}

function makeTask(status: AsyncTaskStatus, progress = 0): TaskFileState['task'] {
  return {
    attempts: 1,
    bullJobId: null,
    businessId: 'file-1',
    businessType: 'file',
    createdAt: '2026-08-02T00:00:00.000Z',
    errorMessage: null,
    finishedAt: null,
    id: 'task-1',
    jobType: 'parse_document',
    payload: null,
    progress,
    queueName: 'document_processing',
    result: null,
    startedAt: status === 'ACTIVE' ? '2026-08-02T00:00:01.000Z' : null,
    status,
    updatedAt: '2026-08-02T00:00:01.000Z',
  }
}

function makeState(fileStatus: FileStatus, taskStatus: AsyncTaskStatus, progress = 0): TaskFileState {
  return { file: makeFile(fileStatus), task: makeTask(taskStatus, progress) }
}

describe('isTerminalFileStatus / projectFileTaskState', () => {
  it('treats backend terminal statuses as finished', () => {
    expect(isTerminalFileStatus('READY')).toBe(true)
    expect(isTerminalFileStatus('OCR_REQUIRED')).toBe(true)
    expect(isTerminalFileStatus('FAILED')).toBe(true)
    expect(isTerminalFileStatus('DELETED')).toBe(true)
    expect(isTerminalFileStatus('UPLOADING')).toBe(false)
    expect(isTerminalFileStatus('PARSING')).toBe(false)
    expect(isTerminalFileStatus('INDEXING')).toBe(false)
  })

  it('projects processing states', () => {
    expect(projectFileTaskState(makeState('QUEUED', 'QUEUED'))).toEqual({ taskState: 'PROCESSING', displayStatus: 'QUEUED' })
    expect(projectFileTaskState(makeState('PARSING', 'ACTIVE', 40))).toEqual({ taskState: 'PROCESSING', displayStatus: 'PARSING' })
  })

  it('projects terminal states', () => {
    expect(projectFileTaskState(makeState('READY', 'COMPLETED', 100))).toEqual({ taskState: 'COMPLETED', displayStatus: 'READY' })
    expect(projectFileTaskState(makeState('OCR_REQUIRED', 'COMPLETED', 100))).toEqual({ taskState: 'OCR_REQUIRED', displayStatus: 'OCR_REQUIRED' })
  })

  it('treats file or task failure as FAILED', () => {
    expect(projectFileTaskState(makeState('FAILED', 'FAILED'))).toEqual({ taskState: 'FAILED', displayStatus: 'FAILED' })
    expect(projectFileTaskState(makeState('READY', 'FAILED'))).toEqual({ taskState: 'FAILED', displayStatus: 'FAILED' })
  })
})

describe('useAsyncTask polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
  }

  it('fetches immediately on start and reports state', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 30))
    const onState = vi.fn()
    const { start, pollingStatus, state } = useAsyncTask({ fetchState, onState })

    start()
    await flush()

    expect(fetchState).toHaveBeenCalledTimes(1)
    expect(onState).toHaveBeenCalledTimes(1)
    expect(state.value?.task?.progress).toBe(30)
    expect(pollingStatus.value).toBe('polling')
  })

  it('polls at interval while processing', async () => {
    const fetchState = vi.fn()
      .mockResolvedValueOnce(makeState('PARSING', 'ACTIVE', 30))
      .mockResolvedValueOnce(makeState('INDEXING', 'ACTIVE', 70))
      .mockResolvedValueOnce(makeState('READY', 'COMPLETED', 100))
    const { start } = useAsyncTask({ fetchState, intervalMs: 1000 })

    start()
    await flush()
    expect(fetchState).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchState).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchState).toHaveBeenCalledTimes(3)
  })

  it('stops polling automatically at terminal state and notifies', async () => {
    const fetchState = vi.fn()
      .mockResolvedValueOnce(makeState('PARSING', 'ACTIVE', 30))
      .mockResolvedValueOnce(makeState('READY', 'COMPLETED', 100))
    const onFinished = vi.fn()
    const { start, pollingStatus } = useAsyncTask({ fetchState, intervalMs: 500, onFinished })

    start()
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    await flush()

    expect(pollingStatus.value).toBe('finished')
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(onFinished.mock.calls[0][0].file.status).toBe('READY')

    // 终态后不再轮询
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchState).toHaveBeenCalledTimes(2)
  })

  it('stops with error after consecutive failures threshold', async () => {
    const fetchState = vi.fn().mockRejectedValue(new Error('network down'))
    const { error, pollingStatus, start } = useAsyncTask({
      fetchState,
      intervalMs: 500,
      maxConsecutiveErrors: 2,
    })

    start()
    await flush()
    expect(pollingStatus.value).toBe('polling')

    await vi.advanceTimersByTimeAsync(500)
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    await flush()

    expect(pollingStatus.value).toBe('error')
    expect(error.value).toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchState).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through transient single failures', async () => {
    const fetchState = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(makeState('PARSING', 'ACTIVE', 50))
      .mockResolvedValueOnce(makeState('READY', 'COMPLETED', 100))
    const { pollingStatus, start } = useAsyncTask({ fetchState, intervalMs: 500 })

    start()
    await flush()
    expect(pollingStatus.value).toBe('polling')

    await vi.advanceTimersByTimeAsync(500)
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    await flush()

    expect(pollingStatus.value).toBe('finished')
    expect(fetchState).toHaveBeenCalledTimes(3)
  })

  it('stops polling on explicit stop', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 10))
    const { pollingStatus, start, stop } = useAsyncTask({ fetchState, intervalMs: 500 })

    start()
    await flush()
    stop()
    expect(pollingStatus.value).toBe('idle')

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchState).toHaveBeenCalledTimes(1)
  })

  it('refresh performs a single fetch without resuming polling', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 60))
    const { pollingStatus, refresh } = useAsyncTask({ fetchState, intervalMs: 500 })

    const result = await refresh()
    expect(result?.file.status).toBe('PARSING')
    expect(pollingStatus.value).toBe('idle')

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchState).toHaveBeenCalledTimes(1)
  })

  it('uses background interval when document is hidden', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 10))
    const { start } = useAsyncTask({ fetchState, intervalMs: 1000, backgroundIntervalMs: 10000 })

    start()
    await flush()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchState).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchState).toHaveBeenCalledTimes(2)
  })

  it('switches back to foreground interval when visible again', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 10))
    const { start } = useAsyncTask({ fetchState, intervalMs: 1000, backgroundIntervalMs: 10000 })

    start()
    await flush()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10500)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchState).toHaveBeenCalledTimes(3)
  })

  it('stops polling when the owning scope is disposed', async () => {
    const fetchState = vi.fn().mockResolvedValue(makeState('PARSING', 'ACTIVE', 10))
    let pollingStatus!: ReturnType<typeof useAsyncTask>['pollingStatus']
    let api!: ReturnType<typeof useAsyncTask>

    const scope = effectScope()
    scope.run(() => {
      api = useAsyncTask({ fetchState, intervalMs: 500 })
      pollingStatus = api.pollingStatus
    })

    api.start()
    await flush()
    expect(pollingStatus.value).toBe('polling')

    scope.stop()
    expect(pollingStatus.value).toBe('idle')

    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchState).toHaveBeenCalledTimes(1)
  })

  it('retryTask runs injected action and resumes polling', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const fetchState = vi.fn()
      .mockResolvedValueOnce(makeState('QUEUED', 'QUEUED'))
      .mockResolvedValueOnce(makeState('READY', 'COMPLETED', 100))
    const { pollingStatus, retryTask, retrying } = useAsyncTask({ fetchState, intervalMs: 500, retry })

    retryTask()
    await flush()

    expect(retry).toHaveBeenCalledTimes(1)
    expect(pollingStatus.value).toBe('polling')
    expect(fetchState).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(pollingStatus.value).toBe('finished')
    expect(retrying.value).toBe(false)
  })

  it('aborts in-flight request on stop', async () => {
    const captured: { signal: AbortSignal | null } = { signal: null }
    const fetchState = vi.fn((signal?: AbortSignal) => {
      captured.signal = signal ?? null
      return new Promise<TaskFileState>(() => {})
    })
    const { start, stop } = useAsyncTask({ fetchState })

    start()
    await flush()
    stop()

    expect(captured.signal?.aborted).toBe(true)
  })
})