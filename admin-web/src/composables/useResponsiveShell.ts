import type { LayoutMode } from '@/types/appearance'
import { useBreakpoints } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'

export type EffectiveLayout = LayoutMode | 'mobile'

export function useResponsiveShell() {
  const settingsStore = useSettingsStore()
  const route = useRoute()
  const breakpoints = useBreakpoints({
    mobile: 768,
    compact: 992,
    desktop: 1280,
  })
  const mediaQueriesSupported = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
  const mobileBreakpoint = breakpoints.smaller('mobile')
  const desktopBreakpoint = breakpoints.greaterOrEqual('desktop')
  const drawerBreakpoint = breakpoints.smaller('compact')
  const isMobile = computed(() => mediaQueriesSupported ? mobileBreakpoint.value : false)
  const isDesktop = computed(() => mediaQueriesSupported ? desktopBreakpoint.value : true)
  const usesDrawer = computed(() => mediaQueriesSupported ? drawerBreakpoint.value : false)
  const isTablet = computed(() => !isMobile.value && !isDesktop.value)
  const isCompactDesktop = computed(() => !usesDrawer.value && !isDesktop.value)
  const sidebarDrawerVisible = ref(false)

  const effectiveLayout = computed<EffectiveLayout>(() => (
    usesDrawer.value ? 'mobile' : settingsStore.settings.layoutMode
  ))
  const effectiveSidebarCollapsed = computed(() => (
    isCompactDesktop.value || settingsStore.settings.sidebarCollapsed
  ))

  function openSidebarDrawer(): void {
    sidebarDrawerVisible.value = true
  }

  function closeSidebarDrawer(): void {
    sidebarDrawerVisible.value = false
  }

  function toggleNavigation(): void {
    if (usesDrawer.value) {
      sidebarDrawerVisible.value = !sidebarDrawerVisible.value
      return
    }
    settingsStore.patchSetting('sidebarCollapsed', !settingsStore.settings.sidebarCollapsed)
  }

  watch(
    () => route.fullPath,
    () => closeSidebarDrawer(),
  )

  return {
    closeSidebarDrawer,
    effectiveLayout,
    effectiveSidebarCollapsed,
    isCompactDesktop,
    isDesktop,
    isMobile,
    isTablet,
    openSidebarDrawer,
    sidebarDrawerVisible,
    toggleNavigation,
    usesDrawer,
  }
}
