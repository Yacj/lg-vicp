<script setup lang="ts">
import { computed } from 'vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'

/**
 * 任务错误展示：展示错误信息，并提供重试 / 关闭操作（由调用方决定行为）。
 */
const props = withDefaults(defineProps<{
  error?: unknown
  /** 后端任务错误信息（AsyncTaskRecord.errorMessage）。 */
  taskErrorMessage?: string | null
  /** 错误展示是否可关闭。 */
  closable?: boolean
}>(), {
  taskErrorMessage: null,
  closable: true,
})

const emit = defineEmits<{
  retry: []
  close: []
}>()

const message = computed(() => {
  if (props.taskErrorMessage) {
    return props.taskErrorMessage
  }
  if (props.error === undefined || props.error === null) {
    return ''
  }
  return normalizeFeedbackError(props.error).message
})

const hasError = computed(() => Boolean(message.value))
</script>

<template>
  <div v-if="hasError" class="app-task-error">
    <div class="app-task-error__body">
      <t-icon name="error-circle-filled" class="app-task-error__icon" />
      <div class="app-task-error__content">
        <div class="app-task-error__title">任务执行失败</div>
        <div class="app-task-error__message">{{ message }}</div>
      </div>
    </div>
    <div class="app-task-error__actions">
      <t-button size="small" theme="primary" variant="outline" @click="emit('retry')">重试</t-button>
      <t-button v-if="closable" size="small" theme="default" variant="text" @click="emit('close')">关闭</t-button>
    </div>
  </div>
</template>

<style scoped>
.app-task-error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-size-3) var(--td-size-4);
  border: 1px solid var(--td-error-color-3);
  border-radius: var(--td-radius-medium);
  background: var(--td-error-color-1);
}

.app-task-error__body {
  display: flex;
  align-items: flex-start;
  gap: var(--td-size-3);
  min-width: 0;
}

.app-task-error__icon {
  margin-top: 2px;
  color: var(--td-error-color);
  font-size: var(--td-size-5);
}

.app-task-error__title {
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-medium);
  font-weight: var(--td-font-weight-medium);
}

.app-task-error__message {
  margin-top: var(--td-size-1);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
}

.app-task-error__actions {
  display: flex;
  flex: none;
  gap: var(--td-size-2);
}
</style>