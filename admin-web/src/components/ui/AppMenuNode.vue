<script setup lang="ts">
import type { SidebarMenuItem } from '@/types/menu'
import { resolveMenuIcon } from './menu-icons'

defineOptions({ name: 'AppMenuNode' })

defineProps<{
  item: SidebarMenuItem
}>()
</script>

<template>
  <t-submenu v-if="item.children.length > 0" :title="item.title" :value="item.id">
    <template #icon>
      <component :is="resolveMenuIcon(item.icon)" />
    </template>
    <AppMenuNode v-for="child in item.children" :key="child.id" :item="child" />
  </t-submenu>
  <t-menu-item v-else-if="item.path" :value="item.path">
    <template #icon>
      <component :is="resolveMenuIcon(item.icon)" />
    </template>
    {{ item.title }}
  </t-menu-item>
</template>
