import type { SolutionAction, SolutionActionBody, SolutionCandidate, SolutionCandidateCard, SolutionStage, SolutionStateDto, SolutionUpdate } from '@/api/solution-types'

export const solutionStageLabels: Record<SolutionStage, string> = {
  COLLECTING_REQUIREMENTS: '正在补充条件',
  CANDIDATE_SELECTION: '请选择方案',
  REFINING: '正在调整方案',
  READY_TO_CONFIRM: '等待最终确认',
  CONFIRMED: '方案已确认',
  GENERATING: '方案已确认',
  GENERATED: '方案已确认',
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function pickFields<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in value)
      result[key] = value[key]
  }
  return result
}

/** Client DTO 不携带 Backend debug、完整候选 provenance 或内部 payload。 */
export function solutionClientState(state: SolutionStateDto): SolutionStateDto {
  const result = pickFields(state, ['id', 'conversationId', 'stage', 'version', 'candidateSetRevision', 'selectedCandidateIds', 'rejectedCandidateIds', 'finalCandidateIds', 'recommendedCandidateIds', 'poolCandidateIds', 'keptForComparisonIds', 'conflicts', 'candidateCards', 'confirmedSnapshotId'])
  return { ...result, candidateCards: state.candidateCards.map(card => pickFields(card, [
    'candidateId',
    'sourceType',
    'title',
    'position',
    'status',
    'selected',
    'final',
    'conflict',
    'conflictMessages',
    'systemId',
    'systemName',
    'schemeId',
    'constructionCode',
    'productSpecId',
    'productId',
    'productName',
    'thicknessMm',
    'productThermalResistance',
    'totalThermalResistance',
    'kValue',
    'sourceDocumentId',
    'sourcePageId',
    'sourcePageLabel',
    'optionId',
    'calculationId',
  ])) }
}

export function isSolutionState(value: unknown): value is SolutionStateDto {
  const state = record(value)
  return Boolean(state && typeof state.id === 'string' && typeof state.conversationId === 'string'
    && typeof state.stage === 'string' && Object.prototype.hasOwnProperty.call(solutionStageLabels, state.stage)
    && Number.isInteger(state.version) && Number.isInteger(state.candidateSetRevision)
    && ['selectedCandidateIds', 'rejectedCandidateIds', 'finalCandidateIds', 'recommendedCandidateIds', 'poolCandidateIds', 'keptForComparisonIds'].every(key => strings(state[key]))
    && Array.isArray(state.conflicts) && Array.isArray(state.candidateCards)
    && state.candidateCards.every((item) => {
      const card = record(item)
      return card && typeof card.candidateId === 'string' && typeof card.title === 'string'
        && ['REFERENCE', 'CALCULATED', 'PRODUCT'].includes(String(card.sourceType))
        && (card.position === null || Number.isInteger(card.position))
        && typeof card.selected === 'boolean' && typeof card.final === 'boolean' && typeof card.conflict === 'boolean'
        && strings(card.conflictMessages)
    }))
}

export function parseSolutionUpdate(value: unknown): SolutionUpdate | null {
  const update = record(value)
  if (!update || !isSolutionState(update.solutionState))
    return null
  const comparison = record(update.comparison)
  const snapshot = record(update.snapshot)
  return {
    solutionState: update.solutionState,
    ...(comparison?.scope === 'SELECTED_CANDIDATES' && Array.isArray(comparison.candidates) && strings(comparison.recommendedCandidateIds) ? { comparison: comparison as unknown as SolutionUpdate['comparison'] } : {}),
    ...(typeof snapshot?.id === 'string' && typeof snapshot.conversationId === 'string' && record(snapshot.payload) ? { snapshot: snapshot as unknown as SolutionUpdate['snapshot'] } : {}),
  }
}

export function solutionPool(state: SolutionStateDto): SolutionCandidateCard[] {
  return state.candidateCards.filter(card => card.position !== null).sort((a, b) => a.position! - b.position!)
}

export function solutionSelected(state: SolutionStateDto): SolutionCandidateCard[] {
  return state.candidateCards.filter(card => card.selected)
}

export function visibleSolutionPool(state: SolutionStateDto, expanded: boolean) {
  return solutionPool(state).filter((card, index) => expanded || index < 4 || card.selected || card.conflict || card.final)
}

export function solutionActionBody(state: SolutionStateDto, action: SolutionAction, candidateIds: string[] = []): SolutionActionBody {
  return { action, solutionStateId: state.id, expectedVersion: state.version, candidateSetRevision: state.candidateSetRevision, candidateIds: [...new Set(candidateIds)] }
}

export function solutionSourceQuery(candidate: SolutionCandidate) {
  return { documentId: candidate.sourceDocumentId || undefined, pageId: candidate.sourcePageId || undefined, pageLabel: candidate.sourcePageLabel || undefined, optionId: candidate.optionId, title: candidate.constructionCode || candidate.systemName || candidate.productName, view: 'content' }
}

export function solutionErrorCode(error: unknown): string {
  const outer = record(error)
  const data = record(outer?.data)
  const payload = record(data?.error) || record(outer?.error)
  const details = record(payload?.details)
  return String(details?.errorCode || payload?.code || outer?.code || '')
}

export const solutionErrorMessages: Record<string, string> = {
  SOLUTION_VERSION_CONFLICT: '方案已更新，请重新确认操作',
  SOLUTION_REVISION_CONFLICT: '候选列表已变化，请重新确认操作',
  SOLUTION_COMPARE_MINIMUM: '请至少加入两个方案后再比较',
  SOLUTION_HARD_CONFLICT: '最终方案与当前条件冲突，请移除该方案或调整条件',
  SOLUTION_CONFLICT_UNHANDLED: '请先移除冲突方案，或明确保留用于比较',
  SOLUTION_FINAL_REQUIRED: '请先指定最终方案',
  SOLUTION_FACTS_INCOMPLETE: '方案缺少正式热工或构造参数，请补齐后确认',
  SOLUTION_SOURCE_CHANGED: '部分来源数据已更新，请重新查询后确认方案',
}

export function solutionMetrics(candidate: SolutionCandidate) {
  return [
    { label: '保温层厚度', value: candidate.thicknessMm, digits: 0, unit: 'mm' },
    { label: '传热系数 K', value: candidate.kValue, digits: 3, unit: 'W/(m²·K)' },
    { label: '产品热阻 R', value: candidate.productThermalResistance, digits: 3, unit: '(m²·K)/W' },
    { label: '总热阻 R₀', value: candidate.totalThermalResistance, digits: 3, unit: '(m²·K)/W' },
  ].filter((metric): metric is typeof metric & { value: number } => typeof metric.value === 'number' && Number.isFinite(metric.value))
}

export function snapshotCandidateCard(candidate: SolutionCandidate, final: boolean): SolutionCandidateCard {
  return { ...candidate, title: candidate.constructionCode || candidate.systemName || candidate.productName || '已确认方案', position: null, status: final ? 'FINAL' : 'SELECTED', selected: true, final, conflict: false, conflictMessages: [] }
}

/** 保存候选选择，丢弃请求锁、临时比较和快照缓存；重进时从 Backend 读取并续签来源。 */
export function solutionPersistenceSnapshot(state: Record<string, unknown>): Record<string, unknown> {
  const conversation = record(state.conversation)
  const solutionState = isSolutionState(state.solutionState) && state.solutionState.conversationId === conversation?.id ? solutionClientState(state.solutionState) : null
  return { ...state, solutionState, solutionComparison: null, solutionSnapshot: null, solutionActionLoading: false, solutionActionCandidateIds: [], solutionPendingAction: null, solutionSnapshotLoading: false, solutionNotice: '', solutionRetiredStateIds: [], solutionRequestRevision: typeof state.solutionRequestRevision === 'number' ? state.solutionRequestRevision : 0, solutionReportCreating: false, solutionReportError: '', solutionReportRequestRevision: 0 }
}
