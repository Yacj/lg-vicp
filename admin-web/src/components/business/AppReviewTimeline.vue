<script setup lang="ts">
import { computed } from 'vue'
import type { ReviewMeta } from '@/types/professional'
import { formatDate } from '@/utils/day'

/**
 * 审核时间线：按审核状态展示 提交审核 → 审核通过/驳回 → 发布 的流转事件。
 * 人员字段当前为 ID（后端未 join 名称，见 GAP-030 同类问题），待后端补充后切换展示名称。
 */
const props = withDefaults(defineProps<{
  review?: Partial<ReviewMeta> | null
}>(), {
  review: null,
})

interface TimelineItem {
  label: string
  time: string
  actor: string
  note: string
  theme: 'primary' | 'success' | 'danger' | 'warning' | 'default'
}

function formatTime(value: string | null | undefined): string {
  return value ? formatDate(new Date(value)) : ''
}

const items = computed<TimelineItem[]>(() => {
  const review = props.review
  if (!review) {
    return []
  }
  const result: TimelineItem[] = []
  if (review.submittedAt) {
    result.push({
      label: '提交审核',
      time: formatTime(review.submittedAt),
      actor: review.submittedBy ?? '',
      note: '',
      theme: 'primary',
    })
  }
  if (review.rejectedAt) {
    result.push({
      label: '审核驳回',
      time: formatTime(review.rejectedAt),
      actor: review.rejectedBy ?? '',
      note: review.rejectReason ?? '',
      theme: 'danger',
    })
  }
  else if (review.approvedAt) {
    result.push({
      label: '审核通过',
      time: formatTime(review.approvedAt),
      actor: review.approvedBy ?? '',
      note: review.approvalNote ?? '',
      theme: 'success',
    })
  }
  if (review.publishedAt) {
    result.push({
      label: '发布',
      time: formatTime(review.publishedAt),
      actor: review.publishedBy ?? '',
      note: '',
      theme: 'default',
    })
  }
  return result
})
</script>

<template>
  <div v-if="items.length" class="app-review-timeline">
    <t-timeline v-for="item in items" :key="`${item.label}-${item.time}`" :theme="item.theme">
      <t-timeline-item :label="item.label" :dot-color="item.theme">
        <div class="app-review-timeline__content">
          <div class="app-review-timeline__meta">
            <span class="app-review-timeline__actor">{{ item.actor }}</span>
            <span class="app-review-timeline__time">{{ item.time }}</span>
          </div>
          <div v-if="item.note" class="app-review-timeline__note">{{ item.note }}</div>
        </div>
      </t-timeline-item>
    </t-timeline>
  </div>
  <span v-else class="app-review-timeline__empty">--</span>
</template>

<style scoped>
.app-review-timeline {
  max-width: 100%;
}

.app-review-timeline__content {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
  padding-bottom: var(--td-size-3);
}

.app-review-timeline__meta {
  display: flex;
  align-items: baseline;
  gap: var(--td-size-3);
}

.app-review-timeline__actor {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
}

.app-review-timeline__time {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.app-review-timeline__note {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-review-timeline__empty {
  color: var(--td-text-color-placeholder);
}
</style>