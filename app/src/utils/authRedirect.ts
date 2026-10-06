const AUTH_REDIRECT_STORAGE_KEY = 'auth:login-redirect'
const AUTH_REDIRECT_TTL_MS = 30 * 60 * 1000
const AUTH_PAGE_PATHS = new Set(['/pages/login', '/pages/register/index', '/pages/password/index'])
// 与 src/constants/navigation.ts 的 TABBAR_ITEMS.pagePath 保持同步
const TABBAR_PATHS = new Set([
  '/pages/index/index',
  '/pages/projects/index',
  '/pages/assistant/index',
  '/pages/profile/index',
])

export interface AuthRedirectRoute {
  query?: Record<string, unknown>
  params?: Record<string, unknown>
}

export interface AuthRedirectRouter {
  replace: (to: { path: string, query?: Record<string, string> }) => Promise<unknown>
  replaceAll: (to: { name?: string, path?: string, query?: Record<string, string> }) => Promise<unknown>
}

export interface AuthRedirectTarget {
  path: string
  query: Record<string, string>
}

interface StoredLoginRedirect {
  path: string
  at: number
}

/**
 * @wot-ui/router 的 named 导航会忽略 query，把 params 编进 URL query。
 * 页面 onLoad 后 params 会被清空，只能从 route.query 读回。
 */
export function buildAuthPageLocation(name: 'login' | 'register', redirect?: string) {
  const value = sanitizeRedirect(redirect || '')
  if (!value) {
    return { name }
  }
  return { name, params: { redirect: value } }
}

export function getLoginRedirect(route: AuthRedirectRoute): string {
  return sanitizeRedirect(pickRedirectValue(route.query?.redirect))
    || sanitizeRedirect(pickRedirectValue(route.params?.redirect))
    || sanitizeRedirect(readStoredLoginRedirect())
    || ''
}

export function rememberLoginRedirect(redirect?: string) {
  const value = sanitizeRedirect(redirect || '')
  if (!value) {
    clearLoginRedirect()
    return
  }

  writeStoredLoginRedirect({ path: value, at: Date.now() })
}

export function clearLoginRedirect() {
  if (!canUseStorage()) {
    return
  }
  try {
    uni.removeStorageSync(AUTH_REDIRECT_STORAGE_KEY)
  }
  catch {
    // 存储不可用时忽略，避免打断登录跳转。
  }
}

export function parseRedirectTarget(raw: string): AuthRedirectTarget | null {
  const value = sanitizeRedirect(raw)
  if (!value) {
    return null
  }

  const queryIndex = value.indexOf('?')
  const path = queryIndex === -1 ? value : value.slice(0, queryIndex)
  const query = queryIndex === -1 ? {} : parseQueryString(value.slice(queryIndex + 1))
  if (!isInternalAppPath(path) || isAuthPagePath(path)) {
    return null
  }

  return { path, query }
}

export function isTabBarPath(path: string) {
  return TABBAR_PATHS.has(normalizeAppPath(path.split('?')[0] || ''))
}

export async function applyAuthRedirect(router: AuthRedirectRouter, rawRedirect?: string) {
  const target = parseRedirectTarget(rawRedirect || '')
  clearLoginRedirect()

  try {
    if (!target) {
      await goHome(router)
      return
    }

    if (isTabBarPath(target.path)) {
      await router.replaceAll({ path: target.path })
      return
    }

    try {
      await router.replace({ path: target.path, query: target.query })
    }
    catch {
      await router.replaceAll({ path: target.path, query: target.query })
    }
  }
  catch {
    await goHome(router)
  }
}

export function sanitizeRedirect(raw: string) {
  const decoded = decodeRedirectValue(raw.trim())
  if (!decoded) {
    return ''
  }

  const [pathPart, queryPart] = splitRedirect(decoded)
  const path = normalizeAppPath(pathPart)
  if (!isInternalAppPath(path) || isAuthPagePath(path)) {
    return ''
  }

  return queryPart ? `${path}?${queryPart}` : path
}

function goHome(router: AuthRedirectRouter) {
  return router.replaceAll({ name: 'home' }).catch(() => {})
}

function isAuthPagePath(path: string) {
  return AUTH_PAGE_PATHS.has(normalizeAppPath(path.split('?')[0] || ''))
}

function isInternalAppPath(path: string) {
  return path.startsWith('/pages/') && !path.includes('..')
}

function normalizeAppPath(path: string) {
  let value = path.trim()
  if (!value) {
    return ''
  }
  if (!value.startsWith('/')) {
    value = `/${value}`
  }
  return value.replace(/\/{2,}/g, '/')
}

function splitRedirect(value: string) {
  const withoutHash = value.split('#')[0] || ''
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex === -1) {
    return [withoutHash, ''] as const
  }
  return [withoutHash.slice(0, queryIndex), withoutHash.slice(queryIndex + 1)] as const
}

function decodeRedirectValue(value: string) {
  let current = value
  for (let i = 0; i < 2; i += 1) {
    if (!current.includes('%')) {
      break
    }
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) {
        break
      }
      current = decoded
    }
    catch {
      break
    }
  }
  return current
}

function pickRedirectValue(value: unknown) {
  if (typeof value === 'string' && value) {
    return decodeRedirectValue(value)
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) {
    return decodeRedirectValue(value[0])
  }
  return ''
}

function parseQueryString(query: string) {
  const result: Record<string, string> = {}
  if (!query) {
    return result
  }

  for (const pair of query.split('&')) {
    if (!pair) {
      continue
    }
    const eqIndex = pair.indexOf('=')
    const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex)
    const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1)
    try {
      const key = decodeURIComponent(rawKey)
      if (key) {
        result[key] = decodeURIComponent(rawValue)
      }
    }
    catch {
      if (rawKey) {
        result[rawKey] = rawValue
      }
    }
  }
  return result
}

function canUseStorage() {
  return typeof uni !== 'undefined'
    && typeof uni.getStorageSync === 'function'
    && typeof uni.setStorageSync === 'function'
    && typeof uni.removeStorageSync === 'function'
}

function readStoredLoginRedirect() {
  if (!canUseStorage()) {
    return ''
  }

  try {
    const raw = uni.getStorageSync(AUTH_REDIRECT_STORAGE_KEY)
    const stored = parseStoredLoginRedirect(raw)
    if (!stored) {
      return ''
    }
    if (Date.now() - stored.at > AUTH_REDIRECT_TTL_MS) {
      clearLoginRedirect()
      return ''
    }
    return stored.path
  }
  catch {
    return ''
  }
}

function writeStoredLoginRedirect(value: StoredLoginRedirect) {
  if (!canUseStorage()) {
    return
  }
  try {
    uni.setStorageSync(AUTH_REDIRECT_STORAGE_KEY, value)
  }
  catch {
    // 存储不可用时仍可通过 URL query 回跳。
  }
}

function parseStoredLoginRedirect(raw: unknown): StoredLoginRedirect | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const stored = raw as Partial<StoredLoginRedirect>
  if (typeof stored.path !== 'string' || typeof stored.at !== 'number') {
    return null
  }
  return { path: stored.path, at: stored.at }
}
