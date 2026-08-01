import type { ApiResponse } from '@/types/api'
import { describe, expect, it } from 'vitest'
import { isApiResponse } from '@/types/api'
import { BusinessError } from '@/types/error'
import { unwrapApiResponse } from './client'

describe('aPI response contract', () => {
  it('unwraps a successful response', () => {
    const response: ApiResponse<{ ready: boolean }> = {
      data: { ready: true },
      requestId: 'request-success',
      success: true,
    }

    expect(unwrapApiResponse(response)).toEqual({ ready: true })
    expect(isApiResponse(response)).toBe(true)
  })

  it('throws BusinessError with requestId for a failure response', () => {
    const response: ApiResponse<never> = {
      error: { code: 403, message: '无权访问' },
      requestId: 'request-failure',
      success: false,
    }

    try {
      unwrapApiResponse(response)
      throw new Error('expected BusinessError')
    }
    catch (error) {
      expect(error).toBeInstanceOf(BusinessError)
      expect(error).toMatchObject({ code: 403, requestId: 'request-failure' })
    }
  })

  it('rejects non-contract payloads', () => {
    expect(isApiResponse({ code: 200, data: {} })).toBe(false)
  })
})
