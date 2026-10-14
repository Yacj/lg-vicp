<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import type { SolutionAction, SolutionCandidate, SolutionComparisonResult, SolutionSnapshotDto, SolutionStateDto } from '@/api/solution-types'
import { computed, ref, watch } from 'vue'
import { confirmedReportBody } from '@/utils/aiReportTask'
import { snapshotCandidateCard, solutionPool, solutionSelected, solutionStageLabels, visibleSolutionPool } from '@/utils/aiSolution'
import { snapshotReferencePages } from '@/utils/referenceTable'
import AiSolutionCandidateCard from './AiSolutionCandidateCard.vue'
import AiSolutionComparisonCard from './AiSolutionComparisonCard.vue'
import ReferencePageViewer from './ReferencePageViewer.vue'

const props = defineProps<{
  state: SolutionStateDto
  comparison: SolutionComparisonResult | null
  snapshot: SolutionSnapshotDto | null
  loading: boolean
  actionCandidateIds: string[]
  pendingAction: SolutionAction | null
  snapshotLoading: boolean
  notice: string
  reportCreating?: boolean
  reportBlocked?: boolean
  reportError?: string
}>()
const emit = defineEmits<{
  action: [action: SolutionAction, candidateIds: string[]]
  source: [candidate: SolutionCandidate]
  snapshot: []
  refresh: []
  generateReport: []
  openTable: [page: AiReferencePage, match: ReferenceHighlight | undefined, highlightEnabled: boolean]
}>()
const expanded = ref(false)
const snapshotExpanded = ref(false)
const draftFinalIds = ref<string[]>([])
const pool = computed(() => solutionPool(props.state))
const visiblePool = computed(() => visibleSolutionPool(props.state, expanded.value))
const selected = computed(() => solutionSelected(props.state))
const finals = computed(() => props.state.candidateCards.filter(card => props.state.finalCandidateIds.includes(card.candidateId)))
const confirmed = computed(() => Boolean(props.state.confirmedSnapshotId) || ['CONFIRMED', 'GENERATING', 'GENERATED'].includes(props.state.stage))
const unhandledConflicts = computed(() => props.state.conflicts.some(conflict => !conflict.keptForComparison))
const finalDraftChanged = computed(() => draftFinalIds.value.length !== props.state.finalCandidateIds.length
  || draftFinalIds.value.some(id => !props.state.finalCandidateIds.includes(id)))
const confirmBlocked = computed(() => props.loading || finalDraftChanged.value || !finals.value.length || unhandledConflicts.value || finals.value.some(card => card.conflict))
const snapshotPages = computed(() => snapshotReferencePages(props.snapshot))
const canCreateReport = computed(() => Boolean(confirmedReportBody(props.state, props.state.conversationId))
  && !props.loading && !props.reportCreating && !props.reportBlocked)

function generateReport() {
  if (canCreateReport.value)
    emit('generateReport')
}

watch(() => props.state, (state, previous) => {
  draftFinalIds.value = [...state.finalCandidateIds]
  if (state.id !== previous?.id || state.candidateSetRevision !== previous?.candidateSetRevision)
    expanded.value = false
  if (state.id !== previous?.id)
    snapshotExpanded.value = false
}, { immediate: true })

function toggleFinal(id: string) {
  draftFinalIds.value = draftFinalIds.value.includes(id) ? draftFinalIds.value.filter(value => value !== id) : [...draftFinalIds.value, id]
}
function kept(id: string) {
  const conflicts = props.state.conflicts.filter(conflict => conflict.candidateId === id)
  return conflicts.length > 0 && conflicts.every(conflict => conflict.keptForComparison)
}
function loadingCandidate(id: string) {
  return props.loading && props.actionCandidateIds.includes(id)
}
function viewSnapshot() {
  snapshotExpanded.value = true
  emit('snapshot')
}
</script>

<template>
  <view class="workspace">
    <view class="workspace__header">
      <view>
        <view class="text-4 font-semibold">
          智配方案
        </view>
        <view class="app-muted mt-1 text-2.5">
          当前候选 {{ pool.length }} · 已选 {{ selected.length }}
        </view>
      </view>
      <text class="workspace__stage" :class="{ 'workspace__stage--confirmed': confirmed }">
        {{ solutionStageLabels[state.stage] }}
      </text>
    </view>
    <view v-if="notice" class="workspace__notice">
      <view>{{ notice }}</view>
      <wd-button size="small" variant="text" :disabled="loading" @click="emit('refresh')">
        刷新方案
      </wd-button>
    </view>
    <template v-if="confirmed">
      <view class="workspace__confirmed">
        <view class="text-3.5 font-semibold">
          方案已确认
        </view>
        <view class="mt-1 text-3">
          已保存 {{ state.finalCandidateIds.length }} 个最终方案及其正式参数和来源。
        </view>
      </view>
      <AiSolutionCandidateCard v-for="candidate in finals" :key="candidate.candidateId" :candidate="candidate" read-only @source="emit('source', $event)" />
      <view class="workspace__actions">
        <wd-button size="small" :loading="reportCreating" :disabled="!canCreateReport" @click="generateReport">
          生成技术方案 PDF
        </wd-button>
        <wd-button size="small" :loading="snapshotLoading" :disabled="snapshotLoading" @click="viewSnapshot">
          查看已确认方案
        </wd-button>
        <wd-button size="small" variant="plain" :disabled="loading" :loading="pendingAction === 'REVISE'" @click="emit('action', 'REVISE', [])">
          继续调整
        </wd-button>
        <wd-button size="small" variant="text" :disabled="loading" :loading="pendingAction === 'START_NEW'" @click="emit('action', 'START_NEW', [])">
          重新做一套方案
        </wd-button>
      </view>
      <view v-if="reportError" class="workspace__notice">
        {{ reportError }}
      </view>
      <view v-if="snapshotExpanded && snapshot" class="workspace__section">
        <view class="text-3.5 font-semibold">
          已确认方案摘要
        </view>
        <view class="app-muted mt-1 text-2.5">
          {{ snapshot.confirmedAt }} · 冻结参数
        </view>
        <view class="workspace__subheading">
          最终方案（{{ snapshot.payload.candidates.length }}）
        </view>
        <AiSolutionCandidateCard v-for="candidate in snapshot.payload.candidates" :key="candidate.candidateId" :candidate="snapshotCandidateCard(candidate, true)" read-only @source="emit('source', $event)" />
        <view v-if="snapshot.payload.alternatives.length" class="workspace__subheading">
          备选方案（{{ snapshot.payload.alternatives.length }}）
        </view>
        <AiSolutionCandidateCard v-for="candidate in snapshot.payload.alternatives" :key="candidate.candidateId" :candidate="snapshotCandidateCard(candidate, false)" read-only @source="emit('source', $event)" />
        <view v-for="(warning, index) in snapshot.payload.warnings" :key="index" class="workspace__notice">
          {{ warning }}
        </view>
        <view v-for="page in snapshotPages" :key="page.page.pageId" class="workspace__section">
          <view class="app-muted mb-2 text-2.5">
            冻结来源：{{ page.page.documentTitle }}{{ page.page.pageLabel ? ` · 第${page.page.pageLabel}页` : '' }}
          </view>
          <ReferencePageViewer :page="page" inline :anchor-prefix="`snapshot-${snapshot.id}-${page.page.pageId}`" initial-view="页面内容" @open-source="emit('source', { candidateId: '', sourceType: 'REFERENCE', sourceDocumentId: page.page.documentId, sourcePageId: page.page.pageId, sourcePageLabel: page.page.pageLabel, optionId: $event?.optionId || undefined })" @open-table="(match, enabled) => emit('openTable', page, match, enabled)" />
        </view>
      </view>
    </template>
    <template v-else>
      <view class="workspace__section">
        <view class="workspace__subheading">
          本轮候选（{{ pool.length }}）
        </view>
        <view v-if="!pool.length" class="app-muted text-3">
          继续输入方案条件，筑小格会为你查询候选方案。
        </view>
        <AiSolutionCandidateCard v-for="candidate in visiblePool" :key="candidate.candidateId" :candidate="candidate" :recommended="state.recommendedCandidateIds.includes(candidate.candidateId)" :disabled="loading" :loading="loadingCandidate(candidate.candidateId)" :kept-for-comparison="kept(candidate.candidateId)" @action="(action, ids) => emit('action', action, ids)" @source="emit('source', $event)" />
        <wd-button v-if="pool.length > 4" size="small" variant="text" @click="expanded = !expanded">
          {{ expanded ? '收起候选' : `查看全部候选（${pool.length}）` }}
        </wd-button>
      </view>
      <view class="workspace__section">
        <view class="workspace__subheading">
          已选方案（{{ selected.length }}）
        </view>
        <view class="app-muted mb-3 text-2.5">
          继续查询会保留已选方案。勾选一个或多个，再设为最终方案。
        </view>
        <AiSolutionCandidateCard v-for="candidate in selected" :key="candidate.candidateId" :candidate="candidate" :recommended="state.recommendedCandidateIds.includes(candidate.candidateId)" :disabled="loading" :loading="loadingCandidate(candidate.candidateId)" :kept-for-comparison="kept(candidate.candidateId)" final-selectable :draft-final="draftFinalIds.includes(candidate.candidateId)" @toggle-final="toggleFinal" @action="(action, ids) => emit('action', action, ids)" @source="emit('source', $event)" />
        <view class="workspace__actions">
          <wd-button size="small" variant="plain" :disabled="loading || selected.length < 2" :loading="pendingAction === 'COMPARE'" @click="emit('action', 'COMPARE', state.selectedCandidateIds)">
            对比已选方案
          </wd-button>
          <wd-button size="small" :disabled="loading || !draftFinalIds.length" :loading="pendingAction === 'SET_FINAL'" @click="emit('action', 'SET_FINAL', draftFinalIds)">
            设为最终方案
          </wd-button>
        </view>
      </view>
      <AiSolutionComparisonCard v-if="comparison" :comparison="comparison" @source="emit('source', $event)" />
      <view v-if="state.stage === 'READY_TO_CONFIRM'" class="workspace__section">
        <view class="workspace__subheading">
          最终方案确认（{{ finals.length }}）
        </view>
        <AiSolutionCandidateCard v-for="candidate in finals" :key="candidate.candidateId" :candidate="candidate" read-only @source="emit('source', $event)" />
        <view class="app-muted my-3 text-3">
          确认后将保存当前最终方案、备选方案及来源，形成已确认方案。
        </view>
        <view v-if="unhandledConflicts" class="workspace__notice">
          仍有未处理冲突，请先移除或明确保留用于比较。
        </view>
        <view v-if="finalDraftChanged" class="workspace__notice">
          最终选择已调整，请先点击「设为最终方案」。
        </view>
        <wd-button block :disabled="confirmBlocked" :loading="pendingAction === 'CONFIRM'" @click="emit('action', 'CONFIRM', state.finalCandidateIds)">
          确认生成方案
        </wd-button>
      </view>
    </template>
  </view>
</template>

<style scoped lang="scss">
.workspace { margin: var(--app-space-4) 0; padding: var(--app-space-4) var(--app-space-3); border: 1px solid var(--app-border-default); border-top: 4rpx solid var(--app-action-primary); border-radius: var(--app-radius-sm); background: var(--app-bg-surface); color: var(--app-text-primary); }
.workspace__header { display: flex; align-items: center; justify-content: space-between; gap: var(--app-space-2); }
.workspace__stage { flex-shrink: 0; padding: var(--app-space-1) var(--app-space-2); border-radius: var(--app-radius-pill); background: var(--app-action-primary-soft); color: var(--app-action-primary); font-size: var(--app-font-size-xs); }
.workspace__stage--confirmed { color: var(--app-energy); background: var(--app-energy-soft); }
.workspace__section { margin-top: var(--app-space-4); padding-top: var(--app-space-3); border-top: 1px solid var(--app-border-default); }
.workspace__subheading { font-size: var(--app-font-size-md); font-weight: 600; margin-bottom: var(--app-space-2); }
.workspace :deep(.candidate) { margin-top: var(--app-space-2); }
.workspace__actions { display: flex; flex-wrap: wrap; gap: var(--app-space-2); margin-top: var(--app-space-3); }
.workspace__notice { margin: var(--app-space-2) 0; padding: var(--app-space-2); border-radius: var(--app-radius-xs); color: var(--app-warning); background: var(--app-warning-soft); font-size: var(--app-font-size-sm); }
.workspace__confirmed { margin: var(--app-space-3) 0; padding: var(--app-space-3); border-radius: var(--app-radius-xs); color: var(--app-energy); background: var(--app-energy-soft); }
</style>
