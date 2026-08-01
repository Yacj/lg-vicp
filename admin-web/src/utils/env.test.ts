import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const validEnv = {
  VITE_APP_API_BASEURL: '/',
  VITE_APP_PREFIX: 'vicp_',
  VITE_APP_TITLE: 'VICP Admin',
  VITE_BUILD_MOCK: 'false',
  VITE_BUILD_SOURCEMAP: 'false',
  VITE_DEV_SERVER_OPEN: 'false',
  VITE_OPEN_DEVTOOLS: 'false',
  VITE_OPEN_PROXY: 'false',
}

describe('environment validation', () => {
  it('parses the required environment contract', () => {
    expect(parseEnv(validEnv)).toMatchObject({
      apiBaseUrl: '/',
      appTitle: 'VICP Admin',
      buildMock: false,
      storagePrefix: 'vicp_',
    })
  })

  it('rejects missing required values', () => {
    expect(() => parseEnv({ ...validEnv, VITE_APP_TITLE: '' }))
      .toThrow('Missing required env: VITE_APP_TITLE')
  })

  it('rejects invalid booleans and enabled Mock', () => {
    expect(() => parseEnv({ ...validEnv, VITE_OPEN_PROXY: 'yes' }))
      .toThrow('Invalid boolean env: VITE_OPEN_PROXY')
    expect(() => parseEnv({ ...validEnv, VITE_BUILD_MOCK: 'true' }))
      .toThrow('VITE_BUILD_MOCK must remain false')
  })
})
