import { describe, expect, it } from 'vitest'
import { BusinessError, HttpRequestError } from '@/types/error'
import { normalizeFeedbackError } from './useAppFeedback'

describe('app feedback error normalization', () => {
  it('preserves business request IDs', () => {
    const error = new BusinessError({ code: 40001, message: '参数错误' }, 'request-business')

    expect(normalizeFeedbackError(error)).toEqual({
      message: '参数错误',
      requestId: 'request-business',
    })
  })

  it('preserves HTTP request IDs', () => {
    const error = new HttpRequestError('服务暂不可用', { requestId: 'request-http', status: 503 })

    expect(normalizeFeedbackError(error)).toEqual({
      message: '服务暂不可用',
      requestId: 'request-http',
    })
  })

  it('uses a safe message for unknown values', () => {
    expect(normalizeFeedbackError(null)).toEqual({ message: '操作失败，请稍后重试' })
  })
})
