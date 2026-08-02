<script setup lang="ts">
import type { MenuNavigationTarget, SidebarMenuItem } from '@/types/menu'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { findMenuById, findMenuPath, firstNavigableTarget } from '@/router/dynamic-routes'
import { useSettingsStore } from '@/stores/settings'
import AppLogo from './AppLogo.vue'
import AppMenuNode from './AppMenuNode.vue'

defineOptions({ name: 'AppSidebar' })

const props = withDefaults(defineProps<{
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
  navigate: [target: MenuNavigationTarget]
}>()

const settingsStore = useSettingsStore()
const route = useRoute()
const sidebarTheme = computed<'light' | 'dark'>(() => {
  const configuredTheme = settingsStore.settings.sidebarTheme
  return configuredTheme === 'auto' ? settingsStore.effectiveTheme : configuredTheme
})

/** 当前路由对应的完整菜单链，末项为应高亮的菜单项，父级用于展开 submenu */
const activeMenuPath = computed(() => findMenuPath(props.menus, route.path))
const activeMenuId = computed(() => activeMenuPath.value.at(-1)?.id ?? '')
const expandedMenuIds = computed(() =>
  activeMenuPath.value.slice(0, -1).map((item) => item.id),
)

// 展开状态 = 用户手动展开的项 ∪ 路由选中链的父级；路由变化时合并，用户交互实时生效
const userExpandedIds = ref<string[]>([])
watch(
  expandedMenuIds,
  (ids) => {
    userExpandedIds.value = [...new Set([...userExpandedIds.value, ...ids])]
  },
  { immediate: true },
)

function handleExpand(values: Array<string | number>): void {
  userExpandedIds.value = values.filter((value): value is string => typeof value === 'string')
}

function handleMenuChange(value: string | number): void {
  if (typeof value !== 'string') {
    return
  }
  const item = findMenuById(props.menus, value)
  const target = item ? firstNavigableTarget(item) : null
  if (target) {
    emit('navigate', target)
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
      :value="activeMenuId"
      :expanded="userExpandedIds"
      @change="handleMenuChange"
      @expand="handleExpand"
    >
      <AppMenuNode v-for="item in menus" :key="item.id" :item="item" />
    </t-menu>

    <div v-if="$slots.footer" class="app-sidebar__footer">
      <slot name="footer" />
    </div>

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

.app-sidebar__footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: var(--td-size-2);
  border-top: 1px solid var(--td-component-stroke);
}

.app-sidebar.is-dark .app-sidebar__footer {
  border-top-color: var(--vicp-sidebar-border-dark);
}
</style>
