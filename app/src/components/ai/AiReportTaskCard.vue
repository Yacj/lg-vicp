<script setup lang="ts">
import type { SessionReport } from '@/utils/aiAgentUi'
import { reportTaskTitle } from '@/utils/aiReportTask'

const props = defineProps<{
  report: SessionReport
  retrying?: boolean
}>()

const emit = defineEmits<{
  open: [report: SessionReport]
  retry: [report: SessionReport]
}>()

const status = computed(() => props.report.status || (props.report.id ? 'READY' : 'GENERATING'))
const title = computed(() => reportTaskTitle(status.value))
const showView = computed(() => status.value === 'READY' && Boolean(props.report.id))
const showRetry = computed(() => status.value === 'FAILED')
const toneClass = computed(() => {
  if (status.value === 'READY') {
    return 'ai-report-task--ready'
  }
  if (status.value === 'FAILED') {
    return 'ai-report-task--failed'
  }
  if (status.value === 'CANCELLED') {
    return 'ai-report-task--cancelled'
  }
  return 'ai-report-task--busy'
})
</script>

<template>
  <view class="ai-report-task app-panel-flat mt-3 rounded-3 px-3.5 py-3" :class="toneClass">
    <view class="flex items-center justify-between gap-3">
      <view class="min-w-0 flex-1">
        <view class="text-3.5 font-semibold leading-5.5">
          {{ title }}
        </view>
      </view>
      <wd-button v-if="showView" size="small" @click="emit('open', report)">
        查看报告
      </wd-button>
      <wd-button
        v-else-if="showRetry"
        size="small"
        :loading="retrying"
        :disabled="retrying"
        @click="emit('retry', report)"
      >
        重新生成
      </wd-button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-report-task {
  border: 1px solid var(--app-border-default);
}

.ai-report-task--busy {
  background: var(--app-state-processing-bg);
}

.ai-report-task--ready {
  background: var(--app-state-success-bg-soft);
}

.ai-report-task--failed {
  background: var(--app-danger-soft);
}

.ai-report-task--cancelled {
  background: var(--app-bg-drawer);
}
</style>
