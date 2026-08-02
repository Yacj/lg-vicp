import { readonly, ref } from 'vue'
import type { ConfirmActionOptions } from './useAppConfirm'
import { confirmAndRun } from './useAppConfirm'
import { useAppFeedback } from './useAppFeedback'

export type ConfirmedCrudActionResult<TResult>
  = | { status: 'busy' }
    | { status: 'cancelled' }
    | { status: 'success', value: TResult }

export interface UseConfirmedCrudActionOptions<TPayload, TResult> {
  action: (payload: TPayload) => Promise<TResult>
  confirm: (payload: TPayload) => ConfirmActionOptions
  successMessage?: string | false | ((payload: TPayload, result: TResult) => string)
  onSuccess?: (result: TResult, payload: TPayload) => void | Promise<void>
}

export function useConfirmedCrudAction<TPayload, TResult = unknown>(
  options: UseConfirmedCrudActionOptions<TPayload, TResult>,
) {
  const running = ref(false)
  const feedback = useAppFeedback()

  async function run(payload: TPayload): Promise<ConfirmedCrudActionResult<TResult>> {
    if (running.value) {
      return { status: 'busy' }
    }

    running.value = true
    try {
      const result = await confirmAndRun(
        options.confirm(payload),
        () => options.action(payload),
      )
      if (!result.confirmed) {
        return { status: 'cancelled' }
      }

      const successMessage = typeof options.successMessage === 'function'
        ? options.successMessage(payload, result.value)
        : options.successMessage
      if (successMessage) {
        await feedback.message('success', successMessage)
      }
      await options.onSuccess?.(result.value, payload)
      return { status: 'success', value: result.value }
    }
    finally {
      running.value = false
    }
  }

  return {
    run,
    running: readonly(running),
  }
}

export type UseCrudDeleteOptions<TItem, TResult>
  = UseConfirmedCrudActionOptions<TItem, TResult>

export function useCrudDelete<TItem, TResult = unknown>(
  options: UseCrudDeleteOptions<TItem, TResult>,
) {
  return useConfirmedCrudAction(options)
}

export type UseCrudBatchActionOptions<TResult>
  = UseConfirmedCrudActionOptions<readonly (string | number)[], TResult>

export function useCrudBatchAction<TResult = unknown>(
  options: UseCrudBatchActionOptions<TResult>,
) {
  return useConfirmedCrudAction(options)
}