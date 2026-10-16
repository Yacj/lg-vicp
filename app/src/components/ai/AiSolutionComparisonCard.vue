<script setup lang="ts">
import type { SolutionCandidate, SolutionComparisonResult } from '@/api/solution-types'
import { solutionMetrics } from '@/utils/aiSolution'

defineProps<{ comparison: SolutionComparisonResult }>()
const emit = defineEmits<{ source: [candidate: SolutionCandidate] }>()
</script>

<template>
  <view class="comparison">
    <view class="text-3.5 font-semibold">
      已选方案比较
    </view>
    <view class="app-muted mt-1 text-2.5">
      仅比较已加入的方案；推荐由当前条件与偏好决定。
    </view>
    <scroll-view scroll-x class="mt-3">
      <view class="comparison__columns">
        <view v-for="candidate in comparison.candidates" :key="candidate.candidateId" class="comparison__column">
          <view class="text-3 font-semibold">
            {{ candidate.constructionCode || candidate.productName || '方案' }}
          </view>
          <view class="comparison__row">
            体系：{{ candidate.systemName || '待补齐' }}
          </view>
          <view class="comparison__row">
            构造：{{ candidate.constructionCode || '待补齐' }}
          </view>
          <view v-if="candidate.productName" class="comparison__row">
            产品：{{ candidate.productName }}
          </view>
          <view class="comparison__row">
            基层：{{ candidate.substrateMaterial || '待补齐' }}<text v-if="candidate.substrateThickness != null">
              {{ candidate.substrateThickness }}mm
            </text>
          </view>
          <view v-for="metric in solutionMetrics(candidate)" :key="metric.label" class="comparison__row">
            {{ metric.label }}：{{ metric.digits ? metric.value.toFixed(metric.digits) : metric.value }} {{ metric.unit }}
          </view>
          <view v-if="solutionMetrics(candidate).length < 4" class="app-muted text-2.5">
            热工/构造参数待补齐
          </view>
          <view v-if="candidate.conflicts.length" class="comparison__warning">
            <view>与当前条件冲突</view>
            <view v-for="conflict in candidate.conflicts" :key="`${conflict.code}:${conflict.relatedConstraint}`">
              {{ conflict.message }}
            </view>
          </view>
          <view v-if="comparison.recommendedCandidateIds.includes(candidate.candidateId)" class="comparison__recommend">
            当前条件下更符合偏好
          </view>
          <view class="app-muted mt-2 text-2.5">
            {{ candidate.sourcePageLabel ? `来源：第${candidate.sourcePageLabel}页` : candidate.sourceType === 'CALCULATED' ? '来源：正式计算' : '来源：正式目录/参考资料' }}
          </view>
          <wd-button v-if="candidate.sourcePageId" size="small" variant="text" @click="emit('source', candidate)">
            查看参考页
          </wd-button>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.comparison { border-top: 1px solid var(--app-border-default); padding-top: var(--app-space-4); margin-top: var(--app-space-4); }
.comparison__columns { display: flex; gap: var(--app-space-2); padding-bottom: var(--app-space-2); }
.comparison__column { width: 360rpx; flex: 0 0 360rpx; background: var(--app-bg-canvas); border-radius: var(--app-radius-xs); padding: var(--app-space-3); box-sizing: border-box; }
.comparison__row { padding: var(--app-space-2) 0; border-bottom: 1px solid var(--app-border-default); font-size: var(--app-font-size-sm); font-variant-numeric: tabular-nums; }
.comparison__warning { margin-top: var(--app-space-2); color: var(--app-warning); font-size: var(--app-font-size-xs); }
.comparison__recommend { margin-top: var(--app-space-2); color: var(--app-action-primary); font-size: var(--app-font-size-xs); }
</style>
