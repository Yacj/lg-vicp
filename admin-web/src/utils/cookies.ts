/**
 * 通用前缀，用于所有 cookie 键
 */
const COOKIE_PREFIX = import.meta.env.VITE_APP_PREFIX || 'app_'

interface CookieOptions {
  expires?: number
  path?: string
}

const Cookies = {
  /**
   * 设置一个 cookie
   * @param key - 键名，不需要包含前缀
   * @param value - 键值
   * @param options - 额外配置
   * @param options.expires - 过期时间（天数）
   * @param options.path - Cookie 的路径
   * @example
   * Cookies.set('token', 'abc123', { expires: 7, path: '/' });
   */
  set(key: string, value: string, options: CookieOptions = {}): void {
    const { expires, path = '/' } = options
    let cookieString = `${COOKIE_PREFIX}${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=${path}`

    if (expires) {
      const date = new Date()
      date.setTime(date.getTime() + expires * 24 * 60 * 60 * 1000)
      cookieString += `; expires=${date.toUTCString()}`
    }

    document.cookie = cookieString
  },
  /**
   * 获取一个 cookie 的值
   * @param key - 键名，不需要包含前缀
   * @returns 如果存在返回值，否则返回 null
   * @example
   * const token = Cookies.get('token');
   */
  get(key: string): string | null {
    const prefixedKey = `${COOKIE_PREFIX}${encodeURIComponent(key)}=`
    const cookies = document.cookie.split('; ')
    for (const cookie of cookies) {
      if (cookie.startsWith(prefixedKey)) {
        return decodeURIComponent(cookie.substring(prefixedKey.length))
      }
    }
    return null
  },
  /**
   * 删除一个 cookie
   * @param key - 键名，不需要包含前缀
   * @param options - 额外配置
   * @param options.path - Cookie 的路径
   * @example
   * Cookies.delete('token', { path: '/' });
   */
  delete(key: string, options: CookieOptions = {}): void {
    const { path = '/' } = options
    document.cookie = `${COOKIE_PREFIX}${encodeURIComponent(key)}=; path=${path}; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  },
  /**
   * 获取所有 cookies
   * @returns 包含所有以指定前缀开头的 cookies 的键值对
   * @example
   * const allCookies = Cookies.getAll();
   */
  getAll(): Record<string, string> {
    const cookies = document.cookie.split('; ')
    const result: Record<string, string> = {}
    for (const cookie of cookies) {
      if (cookie.startsWith(COOKIE_PREFIX)) {
        const [key, value] = cookie.split('=')
        result[decodeURIComponent(key.substring(COOKIE_PREFIX.length))] = decodeURIComponent(value)
      }
    }
    return result
  },
}

// 示例：修改通用前缀
// COOKIE_PREFIX = 'myapp_';

export default Cookies
