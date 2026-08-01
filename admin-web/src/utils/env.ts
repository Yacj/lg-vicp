export type EnvSource = Record<string, boolean | string | undefined>

export interface AppEnv {
  apiBaseUrl: string
  appTitle: string
  buildMock: boolean
  buildSourcemap: boolean
  devServerOpen: boolean
  openDevtools: boolean
  openProxy: boolean
  storagePrefix: string
}

function requireText(source: EnvSource, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env: ${key}`)
  }
  return value.trim()
}

function parseBoolean(source: EnvSource, key: string, fallback = false): boolean {
  const value = source[key]
  if (value === undefined || value === '') {
    return fallback
  }
  if (value === true || value === 'true') {
    return true
  }
  if (value === false || value === 'false') {
    return false
  }
  throw new Error(`Invalid boolean env: ${key}`)
}

function validateApiBaseUrl(value: string): string {
  if (value.startsWith('/')) {
    return value
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    return value
  }
  catch {
    throw new Error('VITE_APP_API_BASEURL must be an absolute HTTP URL or a root-relative path')
  }
}

export function parseEnv(source: EnvSource): AppEnv {
  const buildMock = parseBoolean(source, 'VITE_BUILD_MOCK')
  if (buildMock) {
    throw new Error('VITE_BUILD_MOCK must remain false: formal business data cannot use Mock')
  }

  return {
    apiBaseUrl: validateApiBaseUrl(requireText(source, 'VITE_APP_API_BASEURL')),
    appTitle: requireText(source, 'VITE_APP_TITLE'),
    buildMock,
    buildSourcemap: parseBoolean(source, 'VITE_BUILD_SOURCEMAP'),
    devServerOpen: parseBoolean(source, 'VITE_DEV_SERVER_OPEN'),
    openDevtools: parseBoolean(source, 'VITE_OPEN_DEVTOOLS'),
    openProxy: parseBoolean(source, 'VITE_OPEN_PROXY'),
    storagePrefix: requireText(source, 'VITE_APP_PREFIX'),
  }
}

export function getAppEnv(): AppEnv {
  return parseEnv(import.meta.env)
}

export function validateEnv(): void {
  getAppEnv()
}

export function isDev(): boolean {
  return import.meta.env.MODE === 'development'
}
