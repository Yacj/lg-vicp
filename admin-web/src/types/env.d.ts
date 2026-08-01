/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_API_BASEURL: string
  readonly VITE_APP_DEBUG_TOOL?: string
  readonly VITE_APP_DISABLE_DEVTOOL?: string
  readonly VITE_APP_PREFIX: string
  readonly VITE_APP_SETTING?: string
  readonly VITE_APP_TITLE: string
  readonly VITE_BUILD_MOCK?: string
  readonly VITE_BUILD_SOURCEMAP?: string
  readonly VITE_DEV_SERVER_OPEN?: string
  readonly VITE_OPEN_DEVTOOLS?: string
  readonly VITE_OPEN_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module 'virtual:uno.css' {
  const content: unknown
  export default content
}

declare module 'virtual:svg-icons-register' {
  const content: unknown
  export default content
}
