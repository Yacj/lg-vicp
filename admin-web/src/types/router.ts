import 'vue-router'

export type MenuGroup = 'foundation' | 'system'

export interface StaticMenuItem {
  group: MenuGroup
  icon: 'home' | 'settings'
  path: string
  title: string
}

declare module 'vue-router' {
  interface RouteMeta {
    affix?: boolean
    dynamic?: boolean
    hidden?: boolean
    keepAlive?: boolean
    noTab?: boolean
    permissions?: string[]
    title?: string
  }
}
