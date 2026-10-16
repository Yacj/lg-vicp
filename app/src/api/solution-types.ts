import type { KnowledgePageRenderModel } from './reference-page'

export type SolutionStage = 'COLLECTING_REQUIREMENTS' | 'CANDIDATE_SELECTION' | 'REFINING' | 'READY_TO_CONFIRM' | 'CONFIRMED' | 'GENERATING' | 'GENERATED'
export type SolutionAction = 'SELECT' | 'ADD' | 'REMOVE' | 'REMOVE_CONFLICT' | 'KEEP_FOR_COMPARISON' | 'SET_FINAL' | 'COMPARE' | 'CONFIRM' | 'START_NEW' | 'REVISE'

export interface SolutionCandidate {
  candidateId: string
  sourceType: 'REFERENCE' | 'CALCULATED' | 'PRODUCT'
  systemId?: string
  systemName?: string
  schemeId?: string
  constructionCode?: string
  productSpecId?: string
  productId?: string | null
  productName?: string
  substrateMaterial?: string
  substrateThickness?: number | null
  thicknessMm?: number
  productThermalResistance?: number
  totalThermalResistance?: number
  kValue?: number
  sourceDocumentId?: string | null
  sourcePageId?: string | null
  sourcePageLabel?: string | null
  optionId?: string
  calculationId?: string
}

export interface SolutionCandidateCard extends SolutionCandidate {
  title: string
  position: number | null
  status: 'AVAILABLE' | 'SELECTED' | 'REJECTED' | 'CONFLICT' | 'FINAL'
  selected: boolean
  final: boolean
  conflict: boolean
  conflictMessages: string[]
}

export interface SolutionConflict {
  candidateId: string
  code: string
  message: string
  relatedConstraint: string
  keptForComparison: boolean
}

/** 完整查询由后端语义查询生成；客户端不解析自然语言或补算热工事实。 */
export interface SolutionQueryState {
  intent?: 'REFERENCE_LOOKUP' | 'THERMAL' | 'COMPLIANCE' | 'COMPARISON'
  queryMode?: 'NEW_QUERY' | 'CONTINUE_QUERY' | 'REFINE_QUERY' | 'COMPARE_SELECTED'
  filters?: Array<{ metric: 'K' | 'TOTAL_R' | 'PRODUCT_R', targetValue: number, mode?: 'EXACT' | 'APPROX' | 'MAX_LIMIT' | 'MIN_LIMIT', tolerance?: number, toleranceSource?: 'USER' | 'DEFAULT', requestedTolerance?: number, effectiveTolerance?: number, toleranceAdjusted?: boolean }>
  metric?: 'K' | 'TOTAL_R' | 'PRODUCT_R'
  targetValue?: number
  targetK?: number
  targetR?: number
  mode?: 'EXACT' | 'APPROX' | 'MAX_LIMIT' | 'MIN_LIMIT'
  tolerance?: number
  toleranceSource?: 'USER' | 'DEFAULT'
  requestedTolerance?: number
  effectiveTolerance?: number
  toleranceAdjusted?: boolean
  systemId?: string
  systemIds?: string[]
  systemHint?: string
  schemeId?: string
  schemeCode?: string
  productSpecId?: string
  catalogProductId?: string
  specClass?: 'I' | 'II' | 'III'
  substrateMaterial?: string
  substrateThickness?: number
  buildingType?: string
  structureType?: string
  regionCode?: string
  standardLimitId?: string
  documentIds?: string[]
  knowledgeVersionIds?: string[]
  thicknessMm?: number
  thicknessMin?: number
  thicknessMax?: number
  preferThinner?: boolean
  preferences?: { preferLowerK?: boolean, preferHigherR?: boolean, preferThinner?: boolean, preferThicker?: boolean, higherRMetric?: 'TOTAL_R' | 'PRODUCT_R', entities?: Array<{ field: SolutionEntityField, value: string }> }
  exclusions?: Array<{ field: SolutionEntityField, value: string }>
  removedFields?: SolutionEntityField[]
  removedMetrics?: Array<'K' | 'TOTAL_R' | 'PRODUCT_R'>
  unresolved?: Array<{ field: string, reason: string }>
  conditionTrace?: Array<{ field: string, value: string | number | boolean, mode?: string, source: 'USER_EXPLICIT' | 'CONTEXT_INHERITED' | 'SYSTEM_DERIVED', classification: 'HARD_CONSTRAINT' | 'SOFT_PREFERENCE' | 'AMBIGUOUS' }>
}

export type SolutionEntityField = 'systemId' | 'systemHint' | 'schemeId' | 'schemeCode' | 'productSpecId' | 'catalogProductId' | 'specClass' | 'substrateMaterial' | 'buildingType' | 'structureType' | 'regionCode' | 'standardLimitId'

export interface SolutionStateDto {
  id: string
  conversationId: string
  stage: SolutionStage
  version: number
  candidateSetRevision: number
  selectedCandidateIds: string[]
  rejectedCandidateIds: string[]
  finalCandidateIds: string[]
  recommendedCandidateIds: string[]
  poolCandidateIds: string[]
  keptForComparisonIds: string[]
  conflicts: SolutionConflict[]
  candidateCards: SolutionCandidateCard[]
  confirmedSnapshotId?: string | null
}

export interface SolutionComparisonResult {
  scope: 'SELECTED_CANDIDATES'
  candidates: Array<SolutionCandidate & { conflicts: SolutionConflict[] }>
  recommendedCandidateIds: string[]
}

export interface SolutionSnapshotDto {
  id: string
  solutionStateId: string
  conversationId: string
  confirmedAt: string
  payload: {
    schemaVersion: number
    candidates: SolutionCandidate[]
    alternatives: SolutionCandidate[]
    selectedCandidateIds: string[]
    finalCandidateIds: string[]
    recommendedCandidateIds: string[]
    warnings: string[]
    referencePages: Array<{ sourcePageId: string, documentId: string, pageLabel?: string | null, documentTitle?: string, renderModel?: KnowledgePageRenderModel | null }>
  }
  referenceImages?: Array<{ sourcePageId: string, imageUrl: string | null }>
}

export interface SolutionUpdate {
  solutionState: SolutionStateDto
  comparison?: SolutionComparisonResult
  snapshot?: SolutionSnapshotDto
}

export interface SolutionActionBody {
  action: SolutionAction
  solutionStateId: string
  expectedVersion: number
  candidateSetRevision: number
  candidateIds: string[]
}
