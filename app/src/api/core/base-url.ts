const fallbackBaseURL = 'http://localhost:3000'

/** 浏览器 H5 开发走 Vite 同源代理；小程序/App 与生产仍用绝对地址。 */
export function resolveApiBaseURL(): string {
  if (import.meta.env.DEV && import.meta.env.UNI_PLATFORM === 'h5') {
    return ''
  }
  return (import.meta.env.VITE_API_BASE_URL || fallbackBaseURL).replace(/\/+$/, '')
}
