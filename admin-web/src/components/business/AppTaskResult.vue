<script setup lang="ts">
import { computed } from 'vue'
import type { AsyncTaskRecord } from '@/types/file'

/**
 * 任务结果展示：任务成功后展示后端 result 中的关键信息。
 * 无 result 时显示默认完成文案。
 */
const props = withDefaults(defineProps<{
  task?: AsyncTaskRecord | null
  /** result 中各字段的展示顺序与文案，未配置的字段按 key 直出。 */
  fields?: { key: string, label: string }[]
}>(), {
  task: null,
  fields: () => [],
})

interface ResultItem {
  label: string
  value: string
}

const items = computed<ResultItem[]>(() => {
  const result = props.task?.result
  if (!result) {
    return []
  }
  const configured = props.fields
  const entries = configured.length > 0
    ? configured
      .filter(entry => result[entry.key] !== undefined)
      .map(entry => ({ label: entry.label, key: entry.key }))
    : Object.keys(result).map(key => ({ label: key, key }))

  return entries.map(({ label, key }) => {
    const value = result[key]
    return {
      label,
      value: typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
    }
  })
})

const hasResult = computed(() => items.value.length > 0)
</script>

<template>
  <div class="app-task-result">
    <div class="app-task-result__header">
      <t-icon name="check-circle-filled" class="app-task-result__icon" />
      <span>任务已完成</span>
    </div>
    <t-divider v-if="hasResult" />
    <dl v-if="hasResult" class="app-task-result__list">
      <div v-for="item in items" :key="item.label" class="app-task-result__item">
        <dt class="app-task-result__label">{{ item.label }}</dt>
        <dd class="app-task-result__value">{{ item.value }}</dd>
      </div>
    </dl>
    <div v-else class="app-task-result__empty">任务已处理完成</div>
  </div>
</template>

<style scoped>
.app-task-result__header {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-success-color);
  font-size: var(--td-font-size-body-medium);
  font-weight: var(--td-font-weight-medium);
}

.app-task-result__icon {
  font-size: var(--td-size-5);
}

.app-task-result__list {
  display: grid;
  gap: var(--td-size-3);
  margin: 0;
}

.app-task-result__item {
  display: flex;
  align-items: baseline;
  gap: var(--td-size-4);
}

.app-task-result__label {
  min-width: 96px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-task-result__value {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
}

.app-task-result__empty {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>