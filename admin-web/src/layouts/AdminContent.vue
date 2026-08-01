<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { routeToTab, useTabsStore } from '@/stores/tabs'

const route = useRoute()
const tabsStore = useTabsStore()
const refreshingRouteName = ref<string | null>(null)
const componentKeys = new Map<string, number>()

watch(
  () => route.fullPath,
  () => {
    const tab = routeToTab(route)
    if (tab) {
      tabsStore.open(tab)
    }
  },
  { immediate: true },
)

watch(
  () => tabsStore.refreshVersion,
  async () => {
    const path = tabsStore.refreshingPath
    if (!path || path !== route.fullPath || typeof route.name !== 'string') {
      return
    }

    const routeName = route.name
    refreshingRouteName.value = routeName
    componentKeys.set(routeName, (componentKeys.get(routeName) ?? 0) + 1)
    await nextTick()
    tabsStore.completeRefresh(path)
    refreshingRouteName.value = null
  },
)

function componentKey(routeName: string, fullPath: string): string {
  return `${routeName}:${fullPath}:${componentKeys.get(routeName) ?? 0}`
}
</script>

<template>
  <main class="admin-layout__content">
    <RouterView v-slot="{ Component, route: currentRoute }">
      <KeepAlive :include="tabsStore.cachedRouteNames">
        <component
          :is="Component"
          v-if="currentRoute.meta.keepAlive && refreshingRouteName !== currentRoute.name"
          :key="componentKey(String(currentRoute.name), currentRoute.fullPath)"
        />
      </KeepAlive>
      <component
        :is="Component"
        v-if="!currentRoute.meta.keepAlive"
        :key="currentRoute.fullPath"
      />
    </RouterView>
  </main>
</template>
