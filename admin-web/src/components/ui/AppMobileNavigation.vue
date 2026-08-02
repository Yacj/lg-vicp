<script setup lang="ts">
import type { MenuNavigationTarget, SidebarMenuItem } from '@/types/menu'
import AppLogo from './AppLogo.vue'
import AppSidebar from './AppSidebar.vue'
import AppUserSummary from './AppUserSummary.vue'

defineProps<{
  visible: boolean
  menus: SidebarMenuItem[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'navigate': [target: MenuNavigationTarget]
}>()

function navigate(target: MenuNavigationTarget): void {
  emit('navigate', target)
  emit('update:visible', false)
}
</script>

<template>
  <t-drawer
    attach="body"
    :close-btn="false"
    :footer="false"
    :header="false"
    placement="left"
    :prevent-scroll-through="true"
    size="min(320px, 88vw)"
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="app-mobile-navigation">
      <div class="app-mobile-navigation__brand">
        <AppLogo />
      </div>
      <AppSidebar
        class="app-mobile-navigation__menu"
        :menus="menus"
        :show-brand="false"
        @navigate="navigate"
      />
      <div class="app-mobile-navigation__user">
        <AppUserSummary />
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.app-mobile-navigation {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--td-bg-color-container);
}

.app-mobile-navigation__brand,
.app-mobile-navigation__user {
  padding: var(--td-size-6);
}

.app-mobile-navigation__brand {
  border-bottom: 1px solid var(--td-component-stroke);
}

.app-mobile-navigation__menu {
  min-height: 0;
  border-right: 0;
}

.app-mobile-navigation__user {
  border-top: 1px solid var(--td-component-stroke);
}
</style>
