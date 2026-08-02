import { readonly, ref, shallowRef } from 'vue'
import type { CrudExportHandler, CrudMutationStatus } from '@/types/crud'
import { useAppFeedback } from './useAppFeedback'

export type CrudExportResult<TResult>
  = | { status: 'busy' | 'cancelled' }
    | { status: 'error', error: unknown }
    | { status: 'success', value: TResult }

export interface UseCrudExportOptions<TResult> {
  handler: CrudExportHandler<TResult>
  successMessage?: string | false
  reportError?: boolean
  onSuccess?: (result: TResult) => void | Promise<void>
}

function normalizeProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function useCrudExport<TResult = unknown>(options: UseCrudExportOptions<TResult>) {
  const status = ref<CrudMutationStatus>('idle')
  const progress = ref(0)
  const error = shallowRef<unknown>(null)
  const feedback = useAppFeedback()
  let controller: AbortController | null = null

  async function run(): Promise<CrudExportResult<TResult>> {
    if (status.value === 'submitting') {
      return { status: 'busy' }
    }

    const activeController = new AbortController()
    controller = activeController
    status.value = 'submitting'
    progress.value = 0
    error.value = null

    let value: TResult
    try {
      value = await options.handler({
        signal: activeController.signal,
        onProgress: nextProgress => progress.value = normalizeProgress(nextProgress),
      })
    }
    catch (cause) {
      if (activeController.signal.aborted) {
        status.value = 'idle'
        return { status: 'cancelled' }
      }
      error.value = cause
      status.value = 'error'
      if (options.reportError !== false) {
        await feedback.messageError(cause)
      }
      return { status: 'error', error: cause }
    }
    finally {
      if (controller === activeController) {
        controller = null
      }
    }

    if (activeController.signal.aborted) {
      status.value = 'idle'
      return { status: 'cancelled' }
    }

    progress.value = 100
    status.value = 'success'
    if (options.successMessage) {
      await feedback.message('success', options.successMessage)
    }
    await options.onSuccess?.(value)
    return { status: 'success', value }
  }

  function cancel(): void {
    controller?.abort()
  }

  function reset(): void {
    if (status.value === 'submitting') {
      return
    }
    status.value = 'idle'
    progress.value = 0
    error.value = null
  }

  return {
    cancel,
    error: readonly(error),
    progress: readonly(progress),
    reset,
    run,
    status: readonly(status),
  }
}