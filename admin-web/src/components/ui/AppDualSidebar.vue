<script setup lang="ts">
import type { MenuNavigationTarget, SidebarMenuItem } from '@/types/menu'
import { computed } from 'vue'
import { firstNavigableTarget } from '@/router/dynamic-routes'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from './AppIcon.vue'
import AppLogo from './AppLogo.vue'
import AppNavigationToggle from './AppNavigationToggle.vue'
import AppSidebar from './AppSidebar.vue'

defineOptions({ name: 'AppDualSidebar' })

defineProps<{
  primaryMenus: SidebarMenuItem[]
  contextMenus: SidebarMenuItem[]
  activeId?: string
  moduleTitle?: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  activate: [item: SidebarMenuItem]
  navigate: [target: MenuNavigationTarget]
  toggleNavigation: []
}>()

const settingsStore = useSettingsStore()
const sidebarTheme = computed<'light' | 'dark'>(() => {
  const configuredTheme = settingsStore.settings.sidebarTheme
  return configuredTheme === 'auto' ? settingsStore.effectiveTheme : configuredTheme
})
</script>

<template>
  <aside
    class="app-dual-sidebar"
    :class="[
      `is-${sidebarTheme}`,
      {
        'has-secondary': !collapsed && contextMenus.length > 0,
        'is-collapsed': collapsed,
      },
    ]"
  >
    <div class="app-dual-sidebar__primary">
      <div class="app-dual-sidebar__brand">
        <AppLogo collapsed :inverse="sidebarTheme === 'dark'" />
      </div>
      <nav class="app-dual-sidebar__primary-nav" aria-label="一级模块导航">
        <t-tooltip
          v-for="item in primaryMenus"
          :key="item.id"
          :content="item.title"
          placement="right"
        >
          <t-button
            :aria-label="item.title"
            class="app-dual-sidebar__primary-item"
            :class="{ 'is-active': item.id === activeId }"
            :disabled="firstNavigableTarget(item) === null"
            shape="square"
            theme="default"
            variant="text"
            @click="emit('activate', item)"
          >
            <template #icon>
              <span class="app-dual-sidebar__primary-icon" aria-hidden="true">
                <AppIcon :name="item.icon" />
              </span>
            </template>
            <span class="app-dual-sidebar__primary-label">{{ item.title }}</span>
          </t-button>
        </t-tooltip>
      </nav>
      <div v-if="collapsed" class="app-dual-sidebar__primary-toggle">
        <AppNavigationToggle :collapsed="collapsed" @click="emit('toggleNavigation')" />
      </div>
    </div>

    <AppSidebar
      v-if="!collapsed && contextMenus.length > 0"
      class="app-dual-sidebar__secondary"
      :menus="contextMenus"
      :module-title="moduleTitle"
      :show-brand="false"
      @navigate="emit('navigate', $event)"
    >
      <template #footer>
        <AppNavigationToggle :collapsed="collapsed" placement="top" @click="emit('toggleNavigation')" />
      </template>
    </AppSidebar>
  </aside>
</template>

<style scoped>
.app-dual-sidebar {
  display: grid;
  width: var(--vicp-dual-primary-width);
  height: 100%;
  min-height: 0;
  grid-template-columns: var(--vicp-dual-primary-width);
  color: var(--td-text-color-primary);
}

.app-dual-sidebar.has-secondary {
  width: calc(var(--vicp-dual-primary-width) + var(--vicp-dual-secondary-width));
  grid-template-columns: var(--vicp-dual-primary-width) var(--vicp-dual-secondary-width);
}

.app-dual-sidebar.is-collapsed {
  width: var(--vicp-dual-primary-width);
  grid-template-columns: var(--vicp-dual-primary-width);
}

.app-dual-sidebar__primary {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--td-component-stroke);
  background: var(--td-bg-color-container);
}

.app-dual-sidebar.is-dark .app-dual-sidebar__primary {
  border-right-color: var(--vicp-sidebar-border-dark);
  color: var(--td-text-color-anti);
  background: var(--vicp-sidebar-bg-dark-strong);
}

.app-dual-sidebar__brand {
  display: grid;
  height: var(--vicp-header-height);
  flex: 0 0 var(--vicp-header-height);
  place-items: center;
  border-bottom: 1px solid var(--td-component-stroke);
}

.app-dual-sidebar.is-dark .app-dual-sidebar__brand {
  border-bottom-color: var(--vicp-sidebar-border-dark);
}

.app-dual-sidebar__primary-nav {
  display: flex;
  min-height: 0;
  overflow-y: auto;
  flex: 1;
  align-items: center;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-size-5) var(--td-size-2);
}

.app-dual-sidebar__primary-item {
  display: flex;
  width: 100%;
  min-width: 0;
  height: auto;
  align-items: center;
  flex-direction: column;
  gap: var(--td-size-1);
  padding: var(--td-size-2) var(--td-size-1);
  color: inherit;
  white-space: normal;
}

.app-dual-sidebar__primary-item :deep(.t-button__text) {
  display: inline-flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: center;
  margin-left: 0;
}

.app-dual-sidebar__primary-item :deep(.t-icon + .t-button__text) {
  margin-left: 0;
}

.app-dual-sidebar__primary-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  font-size: var(--td-font-size-title-medium);
  line-height: 1;
}

.app-dual-sidebar__primary-label {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-dual-sidebar__primary-item.is-active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.app-dual-sidebar__secondary {
  width: var(--vicp-dual-secondary-width);
}

.app-dual-sidebar__primary-toggle {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: var(--td-size-2);
  border-top: 1px solid var(--td-component-stroke);
}

.app-dual-sidebar.is-dark .app-dual-sidebar__primary-toggle {
  border-top-color: var(--vicp-sidebar-border-dark);
}

/* 一级栏为深色主题时，切换按钮文字需反色并对 hover 做低对比适配 */
.app-dual-sidebar.is-dark .app-dual-sidebar__primary-toggle :deep(.t-button--variant-text) {
  color: var(--td-text-color-anti);
}

.app-dual-sidebar.is-dark .app-dual-sidebar__primary-toggle :deep(.t-button--variant-text:not(.t-is-disabled):hover) {
  color: var(--td-text-color-anti);
  background: var(--vicp-sidebar-bg-dark);
}
</style>
