<script setup lang="ts">
import type { ReportListViewItem } from '@/utils/aiReportTask'
import { computed } from 'vue'
import { formatReportDate, reportTypeLabel } from '@/constants/reports'
import { reportTaskPresentation } from '@/utils/aiReportTask'

const props = withDefaults(defineProps<{
  item: ReportListViewItem
  hideProject?: boolean
}>(), {
  hideProject: false,
})

const emit = defineEmits<{
  open: [item: ReportListViewItem]
  openProject: [projectId: string]
}>()

const presentation = computed(() => reportTaskPresentation({ id: props.item.id, projectId: props.item.project?.id ?? null, title: props.item.title, reportStatus: props.item.status, publishedAt: props.item.publishedAt }))
</script>

<template>
  <view class="report-card app-panel-flat app-pressable" @click="emit('open', item)">
    <view class="text-3.5 font-semibold leading-5">
      {{ item.title || '未命名报告' }}
    </view>
    <view class="app-muted mt-1 text-2.5">
      {{ reportTypeLabel(item.reportType, Boolean(item.project)) }}
    </view>
    <view class="app-tertiary mt-1 text-2.5">
      {{ formatReportDate(item.createdAt) }}
    </view>
    <view class="app-muted mt-2 text-2.5" :class="{ 'app-danger-text': presentation.status === 'FAILED' }">
      {{ [presentation.title, presentation.reviewLabel, presentation.publicationLabel].filter(Boolean).join(' · ') }}
    </view>
    <view
      v-if="item.project && !hideProject"
      class="app-primary-text mt-2 flex items-center justify-between text-2.5"
      @click.stop="emit('openProject', item.project.id)"
    >
      <text class="min-w-0 truncate">
        {{ item.project.name }}
      </text>
      <wd-icon name="arrow-right" size="24rpx" color="var(--app-action-primary)" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.report-card {
  padding: 28rpx;
  border-radius: var(--app-radius-md);
  background: var(--app-bg-surface);
}

.report-card + .report-card {
  margin-top: 20rpx;
}
</style>
