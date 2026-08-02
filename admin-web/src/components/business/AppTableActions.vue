<script setup lang="ts">
import type { DropdownOption } from 'tdesign-vue-next'
import { MoreIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import type { AppTableAction } from '@/types/crud'

const props = withDefaults(defineProps<{
  actions: readonly AppTableAction[]
  maxVisible?: number
}>(), {
  maxVisible: 2,
})

const visibleCount = computed(() => Math.max(0, Math.floor(props.maxVisible)))
const visibleActions = computed(() => props.actions.slice(0, visibleCount.value))
const overflowActions = computed(() => props.actions.slice(visibleCount.value))
const overflowOptions = computed<DropdownOption[]>(() => overflowActions.value.map(action => ({
  content: action.loading ? `${action.label}中…` : action.label,
  disabled: action.disabled || action.loading,
  theme: action.theme === 'danger' ? 'error' : 'default',
  value: action.key,
})))

function run(action: AppTableAction): void {
  if (action.disabled || action.loading) {
    return
  }
  void action.handler()
}

function runOverflow(option: DropdownOption): void {
  const action = overflowActions.value.find(item => item.key === option.value)
  if (action) {
    run(action)
  }
}
</script>

<template>
  <div class="app-table-actions">
    <t-button
      v-for="action in visibleActions"
      :key="action.key"
      :disabled="action.disabled"
      :loading="action.loading"
      size="small"
      :theme="action.theme ?? 'primary'"
      variant="text"
      @click="run(action)"
    >
      {{ action.label }}
    </t-button>

    <t-dropdown
      v-if="overflowActions.length > 0"
      :options="overflowOptions"
      placement="bottom-right"
      trigger="click"
      @click="runOverflow"
    >
      <t-button aria-label="更多操作" shape="square" size="small" theme="default" variant="text">
        <MoreIcon />
      </t-button>
    </t-dropdown>
  </div>
</template>

<style scoped>
.app-table-actions {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-1);
  white-space: nowrap;
}
</style>