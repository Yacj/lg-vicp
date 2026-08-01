import { MessagePlugin, NotifyPlugin } from 'tdesign-vue-next'
import { BusinessError, HttpRequestError } from '@/types/error'

export type FeedbackTheme = 'error' | 'info' | 'success' | 'warning'

export interface FeedbackError {
  message: string
  requestId?: string
}

export function normalizeFeedbackError(error: unknown): FeedbackError {
  if (error instanceof BusinessError || error instanceof HttpRequestError) {
    return {
      message: error.message,
      requestId: error.requestId,
    }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: '操作失败，请稍后重试' }
}

function withRequestId(error: FeedbackError): string {
  return error.requestId
    ? `${error.message}`
    : error.message
}

export function useAppFeedback() {
  return {
    message(theme: FeedbackTheme, content: string) {
      return MessagePlugin[theme]({ content, duration: 3000, placement: 'top' })
    },
    messageError(error: unknown) {
      return MessagePlugin.error({
        content: withRequestId(normalizeFeedbackError(error)),
        duration: 5000,
        placement: 'top',
      })
    },
    notify(theme: FeedbackTheme, title: string, content: string) {
      return NotifyPlugin[theme]({
        title,
        content,
        duration: 0,
        placement: 'top-right',
      })
    },
    notifyError(error: unknown, title = '操作失败') {
      return NotifyPlugin.error({
        title,
        content: withRequestId(normalizeFeedbackError(error)),
        duration: 0,
        placement: 'top-right',
      })
    },
  }
}
