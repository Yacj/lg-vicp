<script setup lang="ts">
import type { SidebarMenuItem } from '@/types/menu'
import { BreadcrumbItem } from 'tdesign-vue-next'
import { useRouter } from 'vue-router'
import { navigateMenuTarget } from '@/router/dynamic-routes'

defineOptions({ name: 'AppBreadcrumb' })

defineProps<{
  items: SidebarMenuItem[]
}>()

const router = useRouter()

function handleClick(item: SidebarMenuItem): void {
  if (item.target) {
    navigateMenuTarget(item.target, router)
  }
}
</script>

<template>
  <t-breadcrumb v-if="items.length > 0" class="app-breadcrumb" aria-label="面包屑导航">
    <BreadcrumbItem
      v-for="(item, index) in items"
      :key="item.id"
      :max-width="index === items.length - 1 ? undefined : '200px'"
      @click="index < items.length - 1 && handleClick(item)"
    >
      {{ item.title }}
    </BreadcrumbItem>
  </t-breadcrumb>
</template>