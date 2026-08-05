import AdapterUniapp from '@alova/adapter-uniapp'
import { createAlova } from 'alova'
import vueHook from 'alova/vue'
import { useAuthStore } from '@/store/auth'
import mockAdapter from '../mock/mockAdapter'
import { handleAlovaError, handleAlovaResponse } from './handlers'

const publicAuthPaths = [
  '/auth/client/sms/send',
  '/auth/client/login/password',
  '/auth/client/login/sms',
  '/auth/client/login/wechat',
  '/auth/refresh',
  '/auth/dev-token',
]

function isPublicAuthRequest(url: string) {
  return publicAuthPaths.some(path => url.includes(path))
}

const defaultBaseURL = 'http://localhost:3000'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const alovaInstance = createAlova({
  // 剥离尾部斜杠：避免与 /api/v1 拼接产生 //api/v1 双斜杠路径
  baseURL: (import.meta.env.VITE_API_BASE_URL || defaultBaseURL).replace(/\/+$/, ''),
  ...AdapterUniapp({
    mockRequest: mockAdapter,
  }),
  statesHook: vueHook,
  beforeRequest: (method) => {
    const authStore = useAuthStore()
    const headers = method.config.headers || {}

    // 登录和刷新接口不携带旧会话，其余请求统一携带当前会话令牌。
    if (authStore.accessToken && !isPublicAuthRequest(method.url)) {
      headers.Authorization = `Bearer ${authStore.accessToken}`
    }
    method.config.headers = headers

    // Add content type for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(method.type)) {
      method.config.headers['Content-Type'] = 'application/json'
    }

    // GET 参数统一追加时间戳，避免列表请求被平台缓存。
    if (method.type === 'GET' && isRecord(method.config.params)) {
      method.config.params._t = Date.now()
    }

    // Log request in development
    if (import.meta.env.MODE === 'development') {
      console.log(`[Alova Request] ${method.type} ${method.url}`, method.data || method.config.params)
      console.log(`[API Base URL] ${import.meta.env.VITE_API_BASE_URL}`)
      console.log(`[Environment] ${import.meta.env.VITE_ENV_NAME}`)
    }
  },

  // Response handlers
  responded: {
    // Success handler
    onSuccess: handleAlovaResponse,

    // Error handler
    onError: handleAlovaError,

    // Complete handler - runs after success or error
    onComplete: async () => {
      // Any cleanup or logging can be done here
    },
  },

  // We'll use the middleware in the hooks
  // middleware is not directly supported in createAlova options

  // Default request timeout (10 seconds)
  timeout: 60000,
  // 设置为null即可全局关闭全部请求缓存
  cacheFor: null,
})

export default alovaInstance
