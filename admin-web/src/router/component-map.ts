import type { Component } from 'vue'

export const componentMap = {
  'Home': () => import('@/views/home/index.vue'),
  'home/index': () => import('@/views/home/index.vue'),
} as const satisfies Record<string, Component>

export type DynamicComponentKey = keyof typeof componentMap

export function resolveDynamicComponent(key: string): Component | null {
  return key in componentMap
    ? componentMap[key as DynamicComponentKey]
    : null
}
