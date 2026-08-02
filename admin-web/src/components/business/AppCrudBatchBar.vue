<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  selectedCount: number
  busy?: boolean
  message?: string
  clearText?: string
}>(), {
  busy: false,
  message: '',
  clearText: '清空选择',
})

const emit = defineEmits<{
  clear: []
}>()

const resolvedMessage = computed(() => props.message || `已选择 ${props.selectedCount} 项`)
</script>

<template>
  <section v-if="selectedCount > 0" aria-live="polite" class="app-crud-batch-bar">
    <div class="app-crud-batch-bar__summary">
      <strong>{{ resolvedMessage }}</strong>
      <slot name="summary" :selected-count="selectedCount" />
    </div>
    <div class="app-crud-batch-bar__actions">
      <slot :busy="busy" :selected-count="selectedCount" />
      <t-button :disabled="busy" theme="default" variant="text" @click="emit('clear')">
        {{ clearText }}
      </t-button>
    </div>
  </section>
</template>

<style scoped>
.app-crud-batch-bar {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-size-3) var(--td-size-4);
  border: 1px solid var(--td-brand-color-3);
  border-radius: var(--vicp-radius);
  background: var(--td-brand-color-light);
}

.app-crud-batch-bar__summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.app-crud-batch-bar__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-size-2);
}

@media (max-width: 640px) {
  .app-crud-batch-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .app-crud-batch-bar__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>