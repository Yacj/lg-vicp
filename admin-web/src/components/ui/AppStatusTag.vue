<script setup lang="ts">
import { computed } from 'vue'

export type AppStatus = 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled'

const props = withDefaults(defineProps<{
  status?: AppStatus
  label?: string
  size?: 'small' | 'medium' | 'large'
}>(), {
  status: 'default',
  label: '',
  size: 'small',
})

const theme = computed(() => {
  if (props.status === 'info' || props.status === 'processing') {
    return 'primary'
  }
  if (props.status === 'error') {
    return 'danger'
  }
  if (props.status === 'disabled') {
    return 'default'
  }
  return props.status
})
</script>

<template>
  <t-tag
    class="app-status-tag"
    :class="`is-${status}`"
    :size="size"
    :theme="theme"
    :variant="status === 'disabled' ? 'outline' : 'light'"
  >
    <span v-if="status === 'processing'" class="app-status-tag__indicator" aria-hidden="true" />
    <slot>{{ label }}</slot>
  </t-tag>
</template>

<style scoped>
.app-status-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-1);
}

.app-status-tag.is-disabled {
  color: var(--td-text-color-disabled);
}

.app-status-tag__indicator {
  width: var(--td-size-1);
  height: var(--td-size-1);
  border-radius: var(--td-radius-circle);
  background: currentcolor;
}
</style>