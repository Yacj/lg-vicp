export interface ApiErrorPayload {
  code: number
  message: string
  details?: unknown
}

export interface ApiSuccess<T> {
  success: true
  data: T
  requestId: string
}

export interface ApiFailure {
  success: false
  error: ApiErrorPayload
  requestId: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export interface PageQuery {
  page: number
  pageSize: number
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.success !== 'boolean' || typeof value.requestId !== 'string') {
    return false
  }

  if (value.success) {
    return 'data' in value
  }

  return isRecord(value.error)
    && typeof value.error.code === 'number'
    && typeof value.error.message === 'string'
}

export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccess<T> {
  return response.success
}
