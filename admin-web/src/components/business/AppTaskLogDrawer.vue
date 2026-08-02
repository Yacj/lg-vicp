<script setup lang="ts">
import { computed } from 'vue'
import type { AsyncTaskRecord } from '@/types/file'
import { taskStatusText } from '@/utils/task-status'

/**
 * 任务日志抽屉：展示后端任务记录中的运行信息。
 * 后端未提供独立日志接口，因此展示任务记录可获得的字段
 * （状态、进度、尝试次数、错误、时间线、负载与结果）。
 */
const props = withDefaults(defineProps<{
  visible: boolean
  task?: AsyncTaskRecord | null
  title?: string
}>(), {
  task: null,
  title: '任务日志',
})

const emit = defineEmits<{
  close: []
}>()

const errorText = computed(() => props.task?.errorMessage || '无')
const resultText = computed(() => {
  if (!props.task?.result) {
    return '无'
  }
  return JSON.stringify(props.task.result, null, 2)
})
const payloadText = computed(() => {
  if (!props.task?.payload) {
    return '无'
  }
  return JSON.stringify(props.task.payload, null, 2)
})

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}
</script>

<template>
  <t-drawer
    :visible="visible"
    :header="title"
    size="480px"
    :footer="false"
    @close="emit('close')"
  >
    <template v-if="task">
      <div class="app-task-log">
        <div class="app-task-log__meta">
          <div class="app-task-log__row">
            <span class="app-task-log__label">任务 ID</span>
            <span class="app-task-log__value app-task-log__value--mono">{{ task.id }}</span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">任务类型</span>
            <span class="app-task-log__value">{{ task.jobType }}（{{ task.queueName }}）</span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">状态</span>
            <span class="app-task-log__value">
              <AppTaskStatus :status="task.status" :label="taskStatusText(task.status)" />
            </span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">进度</span>
            <span class="app-task-log__value">{{ task.progress }}%</span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">尝试次数</span>
            <span class="app-task-log__value">{{ task.attempts }}</span>
          </div>
        </div>

        <t-divider />

        <div class="app-task-log__timeline">
          <div class="app-task-log__row">
            <span class="app-task-log__label">创建时间</span>
            <span class="app-task-log__value">{{ formatTime(task.createdAt) }}</span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">开始时间</span>
            <span class="app-task-log__value">{{ formatTime(task.startedAt) }}</span>
          </div>
          <div class="app-task-log__row">
            <span class="app-task-log__label">完成时间</span>
            <span class="app-task-log__value">{{ formatTime(task.finishedAt) }}</span>
          </div>
        </div>

        <template v-if="task.status === 'FAILED'">
          <t-divider />
          <div class="app-task-log__section">
            <div class="app-task-log__label">错误信息</div>
            <div class="app-task-log__error">{{ errorText }}</div>
          </div>
        </template>

        <template v-if="task.result">
          <t-divider />
          <div class="app-task-log__section">
            <div class="app-task-log__label">任务结果</div>
            <pre class="app-task-log__code">{{ resultText }}</pre>
          </div>
        </template>

        <template v-if="task.payload">
          <t-divider />
          <div class="app-task-log__section">
            <div class="app-task-log__label">任务负载</div>
            <pre class="app-task-log__code">{{ payloadText }}</pre>
          </div>
        </template>
      </div>
    </template>
    <t-empty v-else description="暂无任务信息" />
  </t-drawer>
</template>

<style scoped>
.app-task-log {
  display: grid;
  gap: var(--td-size-4);
}

.app-task-log__meta,
.app-task-log__timeline {
  display: grid;
  gap: var(--td-size-3);
}

.app-task-log__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  min-height: var(--td-size-7);
}

.app-task-log__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}

.app-task-log__value {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  text-align: right;
  word-break: break-all;
}

.app-task-log__value--mono {
  font-family: var(--td-font-family-mono);
}

.app-task-log__error {
  padding: var(--td-size-3);
  border-radius: var(--td-radius-small);
  background: var(--td-error-color-1);
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
  white-space: pre-wrap;
}

.app-task-log__code {
  max-height: 320px;
  margin: 0;
  padding: var(--td-size-3);
  overflow: auto;
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-primary);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>