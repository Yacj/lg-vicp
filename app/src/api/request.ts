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

export function request<TData = unknown>(
  method: MethodType,
  url: string,
  config: RequestConfig<TData> = {},
) {
  const { pathParams, data, ...methodConfig } = config
  return new Method(
    method,
    alovaInstance,
    normalizeApiPath(replacePathParams(url, pathParams)),
    methodConfig,
    data as RequestBody,
  )
}

export type { RequestConfig }
