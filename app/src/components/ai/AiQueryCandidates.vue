<script setup lang="ts">
import type { ReferenceCandidateResult } from '@/api/solution-types'
import { computed } from 'vue'
import { solutionMetrics } from '@/utils/aiSolution'

const props = defineProps<{ result: ReferenceCandidateResult, selectedIds: string[], disabled: boolean, notice: string }>()
const emit = defineEmits<{ select: [candidateId: string] }>()
const candidates = computed(() => props.result.candidates.filter(candidate => candidate.confirmationEligible))
</script>

<template>
  <view v-if="candidates.length" class="query-candidates">
    <view class="text-4 font-semibold">{{ result.matchesCurrentQuery === false ? '上次查询的参考方案' : '本次可选参考方案' }}</view>
    <view class="app-muted mt-1 text-3">{{ result.matchesCurrentQuery === false ? '这些是之前查询的结果，不符合最新筛选条件，供你回看。若要采用，请先核对条件。' : '先核对输入条件，再加入方案进行比较或指定最终方案。' }}</view>
    <view v-for="candidate in candidates" :key="candidate.candidateId" class="query-candidates__card">
      <view class="font-semibold">{{ candidate.schemeName || candidate.constructionCode || candidate.productName }}</view>
      <view class="app-muted mt-1 text-3">{{ candidate.substrateMaterial || candidate.systemName }}<text v-if="candidate.substrateThickness != null"> · 基层 {{ candidate.substrateThickness }}mm</text></view>
      <view v-for="metric in solutionMetrics(candidate)" :key="metric.label" class="mt-1 text-3">{{ metric.label }}：{{ metric.digits ? metric.value.toFixed(metric.digits) : metric.value }} {{ metric.unit }}</view>
      <wd-button class="mt-2" size="small" :disabled="disabled || selectedIds.includes(candidate.candidateId)" @click="emit('select', candidate.candidateId)">{{ selectedIds.includes(candidate.candidateId) ? '已加入方案' : '加入方案' }}</wd-button>
    </view>
    <view v-if="notice" class="app-muted mt-2 text-3">{{ notice }}</view>
  </view>
</template>

<style scoped lang="scss">
.query-candidates { padding: var(--app-space-3); margin-top: var(--app-space-3); border-radius: var(--app-radius-sm); background: var(--app-bg-surface); }
.query-candidates__card { padding: var(--app-space-3); margin-top: var(--app-space-3); border: 1px solid var(--app-border-default); border-radius: var(--app-radius-sm); }
</style>
