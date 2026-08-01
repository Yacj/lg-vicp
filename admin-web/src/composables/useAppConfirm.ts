import type { DialogInstance } from 'tdesign-vue-next'
import { DialogPlugin } from 'tdesign-vue-next'
import { useAppFeedback } from './useAppFeedback'

export interface ConfirmActionOptions {
  title: string
  content: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export type ConfirmActionResult<T>
  = | { confirmed: false }
    | { confirmed: true, value: T }

export function confirmAndRun<T>(
  options: ConfirmActionOptions,
  action: () => Promise<T>,
): Promise<ConfirmActionResult<T>> {
  const feedback = useAppFeedback()

  return new Promise((resolve) => {
    let submitting = false
    let settled = false
    let dialog: DialogInstance

    const finish = (result: ConfirmActionResult<T>): void => {
      if (settled) {
        return
      }
      settled = true
      dialog.destroy()
      resolve(result)
    }

    dialog = DialogPlugin.confirm({
      header: options.title,
      body: options.content,
      theme: options.danger ? 'danger' : 'warning',
      confirmBtn: {
        content: options.confirmText ?? '确认',
        theme: options.danger ? 'danger' : 'primary',
      },
      cancelBtn: options.cancelText ?? '取消',
      closeOnOverlayClick: false,
      destroyOnClose: true,
      preventScrollThrough: true,
      onClose: () => {
        if (!submitting) {
          finish({ confirmed: false })
        }
      },
      onConfirm: async () => {
        if (submitting) {
          return
        }

        submitting = true
        dialog.setConfirmLoading(true)
        dialog.update({ closeOnEscKeydown: false })

        try {
          const value = await action()
          finish({ confirmed: true, value })
        }
        catch (error) {
          submitting = false
          dialog.setConfirmLoading(false)
          dialog.update({ closeOnEscKeydown: true })
          await feedback.messageError(error)
        }
      },
    })
  })
}
