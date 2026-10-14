<script setup lang="ts">
import type { SessionReport } from '@/utils/aiAgentUi'
import { computed } from 'vue'
import { reportTaskPresentation } from '@/utils/aiReportTask'

const props = defineProps<{
  report: SessionReport
  retrying?: boolean
}>()

const emit = defineEmits<{
  open: [report: SessionReport]
  retry: [report: SessionReport]
}>()

const presentation = computed(() => reportTaskPresentation(props.report))
const status = computed(() => presentation.value.status)
const title = computed(() => presentation.value.title)
const showView = computed(() => presentation.value.canOpenDetail)
const showRetry = computed(() => presentation.value.canRetry)
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
        <view v-if="presentation.taskLabel" class="app-muted mt-1 text-2.5">
          {{ presentation.taskLabel }}{{ presentation.progress != null ? ` · ${presentation.progress}%` : '' }}
        </view>
        <view v-if="presentation.reviewLabel || presentation.publicationLabel" class="app-muted mt-1 text-2.5">
          {{ [presentation.reviewLabel, presentation.publicationLabel].filter(Boolean).join(' · ') }}
        </view>
        <view v-if="presentation.errorMessage" class="app-danger-text mt-1 text-2.5">
          {{ presentation.errorMessage }}
        </view>
      </view>
      <wd-button v-if="showView" size="small" @click="emit('open', report)">
        查看报告
      </wd-button>
      <wd-button
        v-if="showRetry"
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
