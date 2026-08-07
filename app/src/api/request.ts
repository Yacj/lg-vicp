import type { MethodType, RequestBody } from 'alova'
import { Method } from 'alova'
import alovaInstance from './core/instance'

type PathParams = Record<string, string | number>
interface RequestConfig<TData = unknown> {
  data?: TData
  params?: Record<string, unknown>
  pathParams?: PathParams
  headers?: Record<string, string>
}

const API_PREFIX = '/api/v1'

function replacePathParams(url: string, pathParams: PathParams = {}) {
  return url.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(String(pathParams[key] ?? '')))
}

function normalizeApiPath(url: string) {
  if (url.startsWith(`${API_PREFIX}/`) || url === API_PREFIX || url.startsWith('/health')) {
    return url
  }
  return `${API_PREFIX}${url.startsWith('/') ? url : `/${url}`}`
}

/** 写方法统一带 JSON 头（instance.ts / uni.request 默认），空 body 会被后端 400 拒绝，兜底为 {} */
const BODY_METHODS = new Set<MethodType>(['POST', 'PUT', 'PATCH', 'DELETE'])

export function request<TData = unknown>(
  method: MethodType,
  url: string,
  config: RequestConfig<TData> = {},
) {
  const { pathParams, data, ...methodConfig } = config
  const body = data ?? (BODY_METHODS.has(method) ? {} : undefined)
  return new Method(
    method,
    alovaInstance,
    normalizeApiPath(replacePathParams(url, pathParams)),
    methodConfig,
    body as RequestBody,
  )
}

export type { RequestConfig }
