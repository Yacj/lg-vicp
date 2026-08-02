<script setup lang="ts">
import { computed } from 'vue'
import { statusText, taskStatusTheme } from '@/utils/task-status'
import type { TaskStatusTheme } from '@/utils/task-status'

/**
 * 异步任务状态标签。
 * 状态以后端为准：QUEUED / ACTIVE / COMPLETED / FAILED，以及文件级 OCR_REQUIRED 等。
 */
const props = withDefaults(defineProps<{
  /** 后端状态原文（任务或文件状态）。 */
  status: string
  /** 自定义展示文本，默认按后端状态映射。 */
  label?: string
  size?: 'small' | 'medium'
}>(), {
  label: '',
  size: 'small',
})

const theme = computed<TaskStatusTheme>(() => taskStatusTheme(props.status))
const display = computed(() => props.label || statusText(props.status))
</script>

<template>
  <t-tag :size="size" :theme="theme" variant="light" :title="status">
    <span v-if="theme === 'primary'" class="app-task-status__indicator" aria-hidden="true" />
    {{ display }}
  </t-tag>
</template>

<style scoped>
.app-task-status__indicator {
  display: inline-block;
  width: var(--td-size-1);
  height: var(--td-size-1);
  margin-right: var(--td-size-1);
  border-radius: var(--td-radius-circle);
  background: currentcolor;
}
</style>