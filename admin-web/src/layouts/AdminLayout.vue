<script setup lang="ts">
import { computed } from 'vue'
import {
  AppBreadcrumb,
  AppDualSidebar,
  AppHeader,
  AppLogo,
  AppMobileNavigation,
  AppNavigationToggle,
  AppSidebar,
  AppTabs,
  AppTopNavigation,
} from '@/components/ui'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import { useShellNavigation } from '@/composables/useShellNavigation'
import { useSettingsStore } from '@/stores/settings'
import AdminContent from './AdminContent.vue'

defineOptions({ name: 'AdminLayout' })

const navigation = useShellNavigation()
const shell = useResponsiveShell()
const settingsStore = useSettingsStore()
const effectiveLayout = computed(() => shell.effectiveLayout.value)
const showContextSidebar = computed(() => navigation.contextMenus.value.length > 0)

function activatePrimaryMenu(item: Parameters<typeof navigation.activateMenu>[0]): void {
  navigation.activateMenu(item)
}
</script>

<template>
  <div
    v-if="effectiveLayout === 'mobile'"
    class="admin-layout admin-layout--mobile"
  >
    <AppHeader
      class="admin-layout__header"
      compact
      :navigation-collapsed="false"
      show-navigation-toggle
      @toggle-navigation="shell.toggleNavigation"
    >
      <template #brand>
        <AppLogo compact />
      </template>
      <template #breadcrumb>
        <span class="admin-layout__mobile-title">{{ navigation.currentModuleTitle.value || '工作台' }}</span>
      </template>
    </AppHeader>
    <AppTabs class="admin-layout__tabs" />
    <AdminContent />
    <AppMobileNavigation
      v-model:visible="shell.sidebarDrawerVisible.value"
      :menus="navigation.fullMenus.value"
      @navigate="navigation.navigate"
    />
  </div>

  <div
    v-else-if="effectiveLayout === 'side'"
    class="admin-layout admin-layout--side"
    :class="{ 'is-collapsed': shell.effectiveSidebarCollapsed.value }"
  >
    <AppSidebar
      class="admin-layout__sidebar"
      :collapsed="shell.effectiveSidebarCollapsed.value"
      :menus="navigation.fullMenus.value"
      @navigate="navigation.navigate"
    />
    <section class="admin-layout__workspace">
      <AppHeader
        class="admin-layout__header"
        :navigation-collapsed="shell.effectiveSidebarCollapsed.value"
        show-navigation-toggle
        @toggle-navigation="shell.toggleNavigation"
      >
        <template #breadcrumb>
          <AppBreadcrumb :items="navigation.breadcrumbItems.value" />
        </template>
      </AppHeader>
      <AppTabs class="admin-layout__tabs" />
      <AdminContent />
    </section>
  </div>

  <div
    v-else-if="effectiveLayout === 'top'"
    class="admin-layout admin-layout--top"
  >
    <AppHeader class="admin-layout__header">
      <template #brand>
        <AppLogo compact />
      </template>
      <template #navigation>
        <AppTopNavigation
          :active-id="navigation.activePrimaryMenu.value?.id"
          :menus="navigation.primaryMenus.value"
          @activate="activatePrimaryMenu"
          @navigate="navigation.navigate"
        />
      </template>
    </AppHeader>
    <AppBreadcrumb class="admin-layout__breadcrumb-bar" :items="navigation.breadcrumbItems.value" />
    <AppTabs class="admin-layout__tabs" />
    <AdminContent />
  </div>

  <div
    v-else-if="effectiveLayout === 'mixed'"
    class="admin-layout admin-layout--mixed"
    :class="{ 'is-collapsed': shell.effectiveSidebarCollapsed.value, 'has-context-menu': showContextSidebar }"
  >
    <AppHeader class="admin-layout__header" :navigation-collapsed="shell.effectiveSidebarCollapsed.value">
      <template #brand>
        <AppLogo compact />
      </template>
      <template #navigation>
        <AppNavigationToggle
          v-if="showContextSidebar"
          :collapsed="shell.effectiveSidebarCollapsed.value"
          @click="shell.toggleNavigation"
        />
        <AppTopNavigation
          :active-id="navigation.activePrimaryMenu.value?.id"
          :menus="navigation.primaryMenus.value"
          @activate="activatePrimaryMenu"
          @navigate="navigation.navigate"
        />
      </template>
    </AppHeader>
    <AppSidebar
      v-if="showContextSidebar"
      class="admin-layout__sidebar"
      :collapsed="shell.effectiveSidebarCollapsed.value"
      :menus="navigation.contextMenus.value"
      :module-title="navigation.currentModuleTitle.value"
      :show-brand="false"
      @navigate="navigation.navigate"
    />
    <section class="admin-layout__workspace">
      <AppBreadcrumb class="admin-layout__breadcrumb-bar" :items="navigation.breadcrumbItems.value" />
      <AppTabs class="admin-layout__tabs" />
      <AdminContent />
    </section>
  </div>

  <div
    v-else
    class="admin-layout admin-layout--dual"
    :class="{
      'has-context-menu': showContextSidebar,
      'has-tabs': settingsStore.settings.showTabs,
      'is-collapsed': shell.effectiveSidebarCollapsed.value,
    }"
  >
    <AppDualSidebar
      :active-id="navigation.activePrimaryMenu.value?.id"
      :collapsed="shell.effectiveSidebarCollapsed.value"
      :context-menus="navigation.contextMenus.value"
      :module-title="navigation.currentModuleTitle.value"
      :primary-menus="navigation.primaryMenus.value"
      @activate="activatePrimaryMenu"
      @navigate="navigation.navigate"
      @toggle-navigation="shell.toggleNavigation"
    />
    <section class="admin-layout__workspace">
      <AppHeader class="admin-layout__header">
        <template #breadcrumb>
          <AppBreadcrumb :items="navigation.breadcrumbItems.value" />
        </template>
      </AppHeader>
      <AppTabs class="admin-layout__tabs" />
      <AdminContent />
    </section>
  </div>

  <AppMobileNavigation
    v-if="effectiveLayout !== 'mobile' && shell.usesDrawer.value"
    v-model:visible="shell.sidebarDrawerVisible.value"
    :menus="navigation.fullMenus.value"
    @navigate="navigation.navigate"
  />
</template>
