<script setup lang="ts">
import type { SolutionAction, SolutionCandidateCard } from '@/api/solution-types'
import { computed } from 'vue'
import { solutionMetrics } from '@/utils/aiSolution'

const props = defineProps<{
  candidate: SolutionCandidateCard
  recommended?: boolean
  disabled?: boolean
  loading?: boolean
  readOnly?: boolean
  keptForComparison?: boolean
  finalSelectable?: boolean
  draftFinal?: boolean
}>()
const emit = defineEmits<{
  action: [action: SolutionAction, candidateIds: string[]]
  toggleFinal: [candidateId: string]
  source: [candidate: SolutionCandidateCard]
}>()
const metrics = computed(() => solutionMetrics(props.candidate))
const incomplete = computed(() => metrics.value.length < 4)
const sourceLabel = computed(() => ({ REFERENCE: '参考方案', CALCULATED: '正式计算', PRODUCT: '产品候选' })[props.candidate.sourceType])
</script>

<template>
  <view class="candidate" :class="{ 'candidate--final': candidate.final }">
    <view class="flex flex-wrap items-center gap-2">
      <text class="app-muted text-2.5">
        {{ candidate.position !== null ? `方案 ${candidate.position}` : readOnly ? '冻结方案' : '此前保留' }}
      </text>
      <text v-if="recommended" class="candidate__tag candidate__tag--recommend">
        推荐
      </text>
      <text v-if="candidate.final" class="candidate__tag candidate__tag--final">
        最终方案
      </text>
      <text v-else-if="candidate.selected" class="candidate__tag">
        已加入
      </text>
      <text v-else-if="candidate.status === 'REJECTED'" class="candidate__tag">
        已移除
      </text>
    </view>
    <view class="mt-2 text-3.5 font-semibold">
      {{ candidate.constructionCode || candidate.title }}
    </view>
    <view v-if="candidate.systemName" class="app-muted mt-1 text-3">
      {{ candidate.systemName }}
    </view>
    <view v-if="candidate.productName" class="app-muted mt-1 text-3">
      {{ candidate.productName }}
    </view>
    <view v-if="metrics.length" class="candidate__metrics">
      <view v-for="metric in metrics" :key="metric.label">
        <view class="app-muted text-2.5">
          {{ metric.label }}
        </view>
        <view class="candidate__value">
          {{ metric.digits ? metric.value.toFixed(metric.digits) : metric.value }} <text class="candidate__unit">
            {{ metric.unit }}
          </text>
        </view>
      </view>
    </view>
    <view v-if="incomplete" class="app-muted mt-2 text-3">
      {{ candidate.sourceType === 'PRODUCT' ? '产品候选 · 热工/构造参数待补齐' : '部分正式参数待补齐' }}
    </view>
    <view v-if="candidate.conflict" class="candidate__conflict">
      <view class="font-semibold">
        与当前条件冲突
      </view>
      <view v-for="(message, index) in candidate.conflictMessages" :key="index" class="mt-1">
        {{ message }}
      </view>
      <view v-if="keptForComparison" class="mt-1">
        已保留用于比较，仍不满足当前条件
      </view>
      <view v-else class="mt-1">
        请移除，或明确保留用于比较
      </view>
    </view>
    <view class="candidate__source app-muted text-2.5">
      {{ sourceLabel }}<text v-if="candidate.sourcePageLabel">
        · 第{{ candidate.sourcePageLabel }}页
      </text>
      <wd-button v-if="candidate.sourcePageId" size="small" variant="text" @click="emit('source', candidate)">
        查看参考页
      </wd-button>
    </view>
    <view v-if="!readOnly" class="flex flex-wrap items-center gap-2">
      <wd-button v-if="!candidate.selected" size="small" :disabled="disabled" :loading="loading" @click="emit('action', 'ADD', [candidate.candidateId])">
        加入方案
      </wd-button>
      <template v-else>
        <wd-button size="small" variant="plain" :disabled="disabled" :loading="loading" @click="emit('action', candidate.conflict ? 'REMOVE_CONFLICT' : 'REMOVE', [candidate.candidateId])">
          移除
        </wd-button>
        <wd-button v-if="candidate.conflict && !keptForComparison" size="small" type="warning" variant="soft" :disabled="disabled" :loading="loading" @click="emit('action', 'KEEP_FOR_COMPARISON', [candidate.candidateId])">
          保留用于比较
        </wd-button>
      </template>
      <wd-checkbox v-if="finalSelectable" :model-value="draftFinal" :disabled="disabled || candidate.conflict" type="square" @change="emit('toggleFinal', candidate.candidateId)">
        选为最终方案
      </wd-checkbox>
    </view>
  </view>
</template>

<style scoped lang="scss">
.candidate { padding: var(--app-space-3); border: 1px solid var(--app-border-default); border-radius: var(--app-radius-sm); background: var(--app-bg-surface); color: var(--app-text-primary); }
.candidate--final { border-color: var(--app-energy); }
.candidate__tag { border-radius: var(--app-radius-xs); padding: 4rpx 12rpx; color: var(--app-text-secondary); background: var(--app-bg-soft); font-size: var(--app-font-size-xs); }
.candidate__tag--recommend { color: var(--app-action-primary); background: var(--app-action-primary-soft); }
.candidate__tag--final { color: var(--app-energy); background: var(--app-energy-soft); }
.candidate__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--app-space-2); margin: var(--app-space-3) 0; }
.candidate__value { color: var(--app-action-primary); font-weight: 600; font-size: var(--app-font-size-lg); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.candidate__unit { font-weight: 400; font-size: var(--app-font-size-xs); color: var(--app-text-tertiary); }
.candidate__conflict { padding: var(--app-space-2); margin: var(--app-space-2) 0; color: var(--app-warning); background: var(--app-warning-soft); border-radius: var(--app-radius-xs); font-size: var(--app-font-size-sm); }
.candidate__source { margin: var(--app-space-2) 0; display: flex; align-items: center; flex-wrap: wrap; gap: var(--app-space-1); }
</style>
