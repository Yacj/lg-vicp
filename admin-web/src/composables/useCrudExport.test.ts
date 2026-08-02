import { describe, expect, it, vi } from 'vitest'
import { useCrudExport } from './useCrudExport'

describe('crud export state', () => {
  it('tracks progress, prevents duplicate exports and supports cancellation', async () => {
    const handler = vi.fn(({ signal, onProgress }) => new Promise<string>((resolve, reject) => {
      onProgress(45.4)
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      void resolve
    }))
    const exporter = useCrudExport({ handler, reportError: false })

    const running = exporter.run()
    expect(exporter.progress.value).toBe(45)
    await expect(exporter.run()).resolves.toEqual({ status: 'busy' })

    exporter.cancel()

    await expect(running).resolves.toEqual({ status: 'cancelled' })
    expect(exporter.status.value).toBe('idle')
  })

  it('normalizes completion and preserves failures for inline rendering', async () => {
    const success = useCrudExport({
      handler: async ({ onProgress }) => {
        onProgress(180)
        return 'exported'
      },
      reportError: false,
    })

    await expect(success.run()).resolves.toEqual({ status: 'success', value: 'exported' })
    expect(success.progress.value).toBe(100)
    expect(success.status.value).toBe('success')

    const error = new Error('导出失败')
    const failed = useCrudExport({
      handler: vi.fn().mockRejectedValue(error),
      reportError: false,
    })

    await expect(failed.run()).resolves.toEqual({ status: 'error', error })
    expect(failed.error.value).toBe(error)
    expect(failed.status.value).toBe('error')
  })

  it('keeps completed export state when a post-export callback fails', async () => {
    const callbackError = new Error('后置处理失败')
    const exporter = useCrudExport({
      handler: vi.fn().mockResolvedValue('exported'),
      onSuccess: vi.fn().mockRejectedValue(callbackError),
      reportError: false,
    })

    await expect(exporter.run()).rejects.toBe(callbackError)
    expect(exporter.status.value).toBe('success')
    expect(exporter.progress.value).toBe(100)
  })
})