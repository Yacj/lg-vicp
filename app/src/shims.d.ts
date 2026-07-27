export {}

declare function definePage(options: Record<string, unknown>): void

declare module 'vue' {
  type Hooks = App.AppInstance & Page.PageInstance
  interface ComponentCustomOptions extends Hooks {}
}
