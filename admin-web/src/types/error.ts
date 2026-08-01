import type { ApiErrorPayload } from './api'

export class BusinessError extends Error {
  readonly code: number
  readonly details?: unknown
  readonly requestId: string

  constructor(payload: ApiErrorPayload, requestId: string) {
    super(payload.message)
    this.name = 'BusinessError'
    this.code = payload.code
    this.details = payload.details
    this.requestId = requestId
  }
}

export class HttpRequestError extends Error {
  readonly requestId?: string
  readonly status?: number

  constructor(message: string, options: { requestId?: string, status?: number } = {}) {
    super(message)
    this.name = 'HttpRequestError'
    this.requestId = options.requestId
    this.status = options.status
  }
}
