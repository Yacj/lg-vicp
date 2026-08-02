<script setup lang="ts">
import type { TooltipProps } from 'tdesign-vue-next'
import { MenuFoldIcon, MenuUnfoldIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import { useResponsiveShell } from '@/composables/useResponsiveShell'

defineOptions({ name: 'AppNavigationToggle' })

const props = withDefaults(defineProps<{
  collapsed?: boolean
  placement?: TooltipProps['placement']
}>(), {
  collapsed: false,
  placement: 'bottom-left',
})

const emit = defineEmits<{
  click: []
}>()

const shell = useResponsiveShell()

const label = computed(() => (
  shell.usesDrawer.value
    ? '打开导航'
    : (props.collapsed ? '展开侧边栏' : '收起侧边栏')
))
</script>

<template>
  <t-tooltip :content="label" :placement="placement">
    <t-button
      :aria-label="label"
      shape="square"
      theme="default"
      variant="text"
      @click="emit('click')"
    >
      <MenuUnfoldIcon v-if="shell.usesDrawer.value || collapsed" />
      <MenuFoldIcon v-else />
    </t-button>
  </t-tooltip>
</template>