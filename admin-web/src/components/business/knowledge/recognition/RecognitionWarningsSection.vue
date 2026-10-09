<script setup lang="ts">
import { computed } from 'vue'
import type { PageRecognitionMappingIssue } from '@/types/knowledge'
import { KNOWLEDGE_THERMAL_SET_LOCKED_HINT } from '@/composables/useKnowledgeVersionEditable'
import { describeMappingIssue, RECOGNITION_AMBIGUOUS_HINT } from '@/utils/knowledge-recognition'
import { businessUserMessage } from '@/utils/business-error'

/** 识别校验告警区：识别失败 / 重新识别提示 / 映射歧义 / 热工集锁定 / 确认后未同步。 */
const props = withDefaults(defineProps<{
  lastRecognitionError?: string | null
  lastRecognitionErrorCode?: string | null
  recognitionRunId?: string | null
  physicalPageNumber?: number | null
  reviewIssues?: string[]
  confirmed?: boolean
  ambiguous?: boolean
  thermalSetLocked?: boolean
  hasSyncOptions?: boolean
  canDebug?: boolean
  confirmIssues?: PageRecognitionMappingIssue[]
}>(), {
  lastRecognitionError: null,
  lastRecognitionErrorCode: null,
  recognitionRunId: null,
  physicalPageNumber: null,
  reviewIssues: () => [],
  confirmed: false,
  ambiguous: false,
  thermalSetLocked: false,
  hasSyncOptions: false,
  canDebug: false,
  confirmIssues: () => [],
})
const failureMessage = computed(() => {
  switch (props.lastRecognitionErrorCode) {
    case 'PAGE_RECOGNITION_OUTPUT_INVALID': return '识别结果格式不完整。请重试；仍失败时可手动填写识别草稿。'
    case 'PAGE_RECOGNITION_TIMEOUT': return '识别超时。请稍后重试。'
    case 'PAGE_RECOGNITION_QUEUE_FAILED': return '识别任务未能提交。请稍后重试。'
    case 'PAGE_RECOGNITION_FAILED': return '识别服务未能完成处理。请联系管理员并提供下方定位编号。'
    default: return businessUserMessage(props.lastRecognitionError)
  }
})
</script>

<template>
  <div class="recognition-warnings">
    <t-alert
      v-if="lastRecognitionError"
      theme="error"
      :message="`识别失败：${failureMessage}`"
    />
    <p v-if="lastRecognitionError" class="recognition-warnings__locator">
      文件第 {{ physicalPageNumber ?? '—' }} 页 · 错误码 {{ lastRecognitionErrorCode || '旧任务未记录' }} · 任务编号 {{ recognitionRunId || '未记录' }}
    </p>
    <t-alert v-if="reviewIssues.length" theme="warning" title="需要人工核对">
      <ul class="recognition-warnings__issues">
        <li v-for="(issue, index) in reviewIssues" :key="index">{{ businessUserMessage(issue) }}</li>
      </ul>
    </t-alert>
    <t-alert
      v-if="confirmed"
      theme="warning"
      message="重新识别不会直接覆盖已发布数据，新结果将进入待确认。"
    />
    <t-alert v-if="ambiguous" theme="warning" :message="RECOGNITION_AMBIGUOUS_HINT" />
    <t-alert v-if="thermalSetLocked" theme="warning" :message="KNOWLEDGE_THERMAL_SET_LOCKED_HINT" />
    <t-alert
      v-if="confirmIssues.length"
      theme="warning"
      title="页面已确认，但部分热工数据未同步"
    >
      <ul class="recognition-warnings__issues">
        <li v-for="(issue, index) in confirmIssues" :key="index">
          {{ describeMappingIssue(issue) }}
        </li>
      </ul>
      <p>{{ hasSyncOptions ? '请检查已关联的构造和产品，再选择热工参考集重试。' : '请先建立并关联可编辑的热工参考集，再重新确认需要同步的页面。' }}</p>
    </t-alert>
    <details v-if="canDebug && lastRecognitionError" class="recognition-warnings__diagnostic">
      <summary>排障详情</summary>
      <pre>{{ lastRecognitionError }}\n{{ lastRecognitionErrorCode }}\n{{ recognitionRunId }}</pre>
    </details>
  </div>
</template>

<style scoped>
.recognition-warnings {
  display: grid;
  gap: 8px;
}

.recognition-warnings__issues {
  margin: 0;
  padding-left: 18px;
}
.recognition-warnings__diagnostic pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.recognition-warnings__locator { margin: 0; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); overflow-wrap: anywhere; }
</style>
