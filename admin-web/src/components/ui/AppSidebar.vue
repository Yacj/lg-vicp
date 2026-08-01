<script setup lang="ts">
import type { SidebarMenuItem } from '@/types/menu'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import AppLogo from './AppLogo.vue'
import AppMenuNode from './AppMenuNode.vue'

defineOptions({ name: 'AppSidebar' })

withDefaults(defineProps<{
  menus: SidebarMenuItem[]
  collapsed?: boolean
  showBrand?: boolean
  moduleTitle?: string
  showUser?: boolean
}>(), {
  collapsed: false,
  showBrand: true,
  moduleTitle: '',
  showUser: false,
})

const emit = defineEmits<{
  navigate: [path: string]
}>()

const settingsStore = useSettingsStore()
const route = useRoute()
const sidebarTheme = computed<'light' | 'dark'>(() => {
  const configuredTheme = settingsStore.settings.sidebarTheme
  return configuredTheme === 'auto' ? settingsStore.effectiveTheme : configuredTheme
})

function handleMenuChange(value: string | number): void {
  if (typeof value === 'string' && value.startsWith('/')) {
    emit('navigate', value)
  }
}
</script>

<template>
  <aside
    class="app-sidebar"
    :class="[`is-${sidebarTheme}`, { 'is-collapsed': collapsed }]"
  >
    <div v-if="showBrand" class="app-sidebar__brand">
      <AppLogo :collapsed="collapsed" :inverse="sidebarTheme === 'dark'" />
    </div>
    <div v-else-if="moduleTitle && !collapsed" class="app-sidebar__module-title">
      {{ moduleTitle }}
    </div>

    <t-menu
      class="app-sidebar__nav"
      :collapsed="collapsed"
      :theme="sidebarTheme"
      :value="route.path"
      @change="handleMenuChange"
    >
      <AppMenuNode v-for="item in menus" :key="item.id" :item="item" />
    </t-menu>

    <slot v-if="showUser" name="user" />
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  flex-direction: column;
  border-right: 1px solid var(--td-component-stroke);
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-container);
}

.app-sidebar.is-dark {
  border-right-color: var(--vicp-sidebar-border-dark);
  color: var(--td-text-color-anti);
  background: var(--vicp-sidebar-bg-dark);
}

.app-sidebar__brand {
  display: flex;
  height: var(--vicp-header-height);
  flex: 0 0 var(--vicp-header-height);
  align-items: center;
  padding: 0 var(--td-size-7);
  border-bottom: 1px solid var(--td-component-stroke);
}

.app-sidebar__module-title {
  min-height: var(--vicp-header-height);
  padding: var(--td-size-7);
  border-bottom: 1px solid var(--td-component-stroke);
  color: inherit;
  font-size: var(--td-font-size-title-medium);
  font-weight: 600;
}

.app-sidebar.is-dark .app-sidebar__brand,
.app-sidebar.is-dark .app-sidebar__module-title {
  border-bottom-color: var(--vicp-sidebar-border-dark);
}

.app-sidebar__nav {
  width: 100%;
  min-height: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  background: inherit;
}

.app-sidebar.is-light .app-sidebar__nav {
  background: var(--td-bg-color-container);
}

.app-sidebar.is-dark .app-sidebar__nav {
  background: var(--vicp-sidebar-bg-dark);
}

.is-collapsed .app-sidebar__brand {
  justify-content: center;
  padding-inline: 0;
}
</style>
