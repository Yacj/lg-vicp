import type { PageResult } from '@/types/api'
import type {
  EvidenceLevel,
  EvidenceMeta,
  ProfessionalPageQuery,
  ReviewMeta,
  VersionMeta,
} from '@/types/professional'

export interface ValidationResult {
  valid: boolean
  violations: Array<{ field: string, message: string }>
}

export interface MutationMessageResponse {
  message: string
}

/** 图集热工参考集（版本化实体，优先以图集节能计算参考选用表为准） */
export interface ThermalSet extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  description: string | null
  atlasDocumentId: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ThermalSetInput {
  code: string
  name: string
  description?: string
  atlasDocumentId?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 热工参考行（子表，随参考集版本复制；原文值保留 raw_* 字段） */
export interface ThermalRow {
  id: string
  setId: string
  schemeId: string
  productSpecId: string
  thicknessMm: number
  productThermalResistance: number
  totalThermalResistance: number
  kValue: number
  rawThickness: string
  rawProductResistance: string
  rawTotalResistance: string
  rawKValue: string
  evidenceSource: string
  evidenceRef: string
  evidenceLevel: EvidenceLevel
  catalogProductId: string | null
  sourceDocumentId: string | null
  sourcePageId: string | null
  sourcePageLabel: string | null
  sortOrder: number
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ThermalRowInput {
  schemeId: string
  productSpecId: string
  thicknessMm: number
  productThermalResistance: number
  totalThermalResistance: number
  kValue: number
  rawThickness: string
  rawProductResistance: string
  rawTotalResistance: string
  rawKValue: string
  evidenceSource: string
  evidenceRef: string
  evidenceLevel?: EvidenceLevel
  catalogProductId?: string | null
  sourceDocumentId?: string | null
  sourcePageId?: string | null
  sourcePageLabel?: string | null
  sortOrder?: number
}


export interface ThermalCalcRule extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  formulaVersion: string
  interiorSurfaceResistance: number
  exteriorSurfaceResistance: number
  precision: number
  roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'TRUNCATE' | 'NONE'
  compareField: 'K_VALUE' | 'TOTAL_RESISTANCE'
  compareOperator: 'LTE' | 'GTE'
  includeNonProductLayers: boolean
  includeSurfaceResistances: boolean
  parameterCodes: { equivalentConductivity: string, correctionFactor: string }
  paramSourcePriority: string[]
  usage: string | null
  applicableScope: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ThermalCalcRuleInput {
  code: string
  name: string
  formulaVersion: string
  interiorSurfaceResistance: number
  exteriorSurfaceResistance: number
  precision?: number
  roundingMode?: 'HALF_UP' | 'HALF_EVEN' | 'TRUNCATE' | 'NONE'
  compareField?: 'K_VALUE' | 'TOTAL_RESISTANCE'
  compareOperator?: 'LTE' | 'GTE'
  includeNonProductLayers?: boolean
  includeSurfaceResistances?: boolean
  parameterCodes: { equivalentConductivity: string, correctionFactor: string }
  paramSourcePriority?: string[]
  usage?: string
  applicableScope?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 地区标准限值（版本化实体） */
export interface ThermalStandardLimit extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  regionCode: string
  regionName: string
  basisCode: string
  basisName: string
  clauseRef: string
  limitKValue: number
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ThermalStandardLimitInput {
  regionCode: string
  regionName: string
  basisCode: string
  basisName: string
  clauseRef: string
  limitKValue: number
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

export const thermalCalcModes = ['REFERENCE_TABLE', 'EQUIVALENT', 'LAYERED'] as const
export type ThermalCalcMode = (typeof thermalCalcModes)[number]

export interface ThermalCalcRequest {
  mode: ThermalCalcMode
  schemeId: string
  productSpecId: string
  thicknessMm: number
  regionCode?: string
  ruleCode?: string
  projectId?: string
}

export interface ThermalCalcFieldError {
  field: string
  code: string
  message: string
}

export interface ThermalCalcExecution {
  valid: boolean
  errors: ThermalCalcFieldError[]
  notes: string[]
  record: ThermalCalcRecord | null
}

/** 计算记录（全快照只读，历史结果不随后台参数漂移） */
export interface ThermalCalcRecord {
  id: string
  requestId: string | null
  mode: ThermalCalcMode
  projectId: string | null
  ruleId: string | null
  ruleVersion: number | null
  standardLimitId: string | null
  limitVersion: number | null
  input: Record<string, unknown>
  layers: unknown[]
  parameters: unknown[]
  rule: Record<string, unknown> | null
  standard: Record<string, unknown> | null
  formulas: Record<string, unknown>
  steps: unknown[]
  result: Record<string, unknown>
  createdById: string | null
  createdAt: string
}

export const thermalImportJobStatuses = ['CREATED', 'QUEUED', 'PARSING', 'PARSED', 'APPLIED', 'FAILED'] as const
export type ThermalImportJobStatus = (typeof thermalImportJobStatuses)[number]

/** 图集热工导入任务 */
export interface ThermalImportJob {
  id: string
  setCode: string
  name: string | null
  setId: string | null
  fileId: string
  templateVersion: number
  status: ThermalImportJobStatus
  rowCount: number
  validCount: number
  errorCount: number
  errorSummary: string | null
  errorMessage: string | null
  appliedById: string | null
  appliedAt: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface ThermalSetQuery extends ProfessionalPageQuery {}

export interface ThermalCalcRuleQuery extends ProfessionalPageQuery {}

export interface ThermalStandardLimitQuery extends ProfessionalPageQuery {
  regionCode?: string
}

export interface ThermalCalcRecordQuery extends ProfessionalPageQuery {
  mode?: ThermalCalcMode | '' | 'all'
  projectId?: string
}

export interface ThermalImportJobQuery extends Omit<ProfessionalPageQuery, 'status'> {
  status?: ThermalImportJobStatus
  setCode?: string
}

export interface ThermalRowQuery {
  page: number
  pageSize: number
  schemeId?: string
}

// ===== 候选方案查询（B 端试算与 AI 端共用同一契约） =====

/** 热工指标（后端 THERMAL_LOOKUP_METRICS）：K 传热系数 / TOTAL_R 总热阻 / PRODUCT_R 产品层热阻。 */
export const thermalLookupMetrics = ['K', 'TOTAL_R', 'PRODUCT_R'] as const
export type ThermalLookupMetric = (typeof thermalLookupMetrics)[number]

/** 指标匹配语义（后端 THERMAL_LOOKUP_MODES）。 */
export const thermalLookupModes = ['APPROX', 'MAX_LIMIT', 'MIN_LIMIT', 'EXACT'] as const
export type ThermalLookupMode = (typeof thermalLookupModes)[number]

/** 单个热工指标条件；多个条件之间为 AND（后端 filters[]，1–12 条）。 */
export interface ThermalLookupFilter {
  metric: ThermalLookupMetric
  targetValue: number
  /** 缺省由后端按指标取默认语义（K 默认 MAX_LIMIT）。 */
  mode?: ThermalLookupMode
  /** APPROX/EXACT 有效；缺省用后端集中配置的业务默认值。 */
  tolerance?: number
}

/** 候选查询响应的已归一化条件，容差来源由 Backend 给出。 */
export interface ThermalNormalizedLookupFilter extends ThermalLookupFilter {
  /** 查询响应中的后端归一化容差元信息。 */
  toleranceSource?: 'USER' | 'DEFAULT'
  requestedTolerance?: number
  effectiveTolerance?: number
  toleranceAdjusted?: boolean
}

export interface ThermalCandidateQuery {
  /** 多指标条件（AND）；提供时优先于单指标与旧字段。 */
  filters?: ThermalLookupFilter[]
  metric?: ThermalLookupMetric
  targetValue?: number
  mode?: ThermalLookupMode
  tolerance?: number
  regionCode?: string
  standardLimitId?: string
  buildingType?: string
  systemId?: string
  schemeId?: string
  schemeCode?: string
  productSpecId?: string
  catalogProductId?: string
  substrateMaterial?: string
  substrateThickness?: number
  specClass?: 'I' | 'II' | 'III'
  /** 精确厚度档与厚度区间互斥 */
  thicknessMm?: number
  thicknessMin?: number
  thicknessMax?: number
  /** @deprecated 请使用 metric='K' + targetValue。 */
  targetK?: number
  /** @deprecated 请使用 metric='TOTAL_R' + targetValue。 */
  targetResistance?: number
  neighborTolerance?: number
  asOfDate?: string
}

/** 候选方案（图集参考行匹配结果）；ranking.isClosestToTarget 由后端标记最接近目标值 */
export interface ThermalCandidate {
  candidateId: string
  matchType: 'EXACT' | 'NEIGHBOR'
  neighborGap: number | null
  matchedConditions: string[]
  unmatchedConditions: string[]
  missingConditions: string[]
  compliant: boolean | null
  ranking?: { metric?: ThermalLookupMetric, metricGap?: number, kGap: number, isClosestToTarget: boolean }
  scheme: { id: string, code: string, version: number, substrateMaterial: string, substrateThickness: number | null, atlasPage: string | null }
  system: { id: string, code: string | null, name: string | null }
  productSpec: { id: string, specCode: string, specVersion: number, specClass: 'I' | 'II' | 'III' | null }
  set: { id: string, code: string, version: number, priority: number, buildingTypes: string[] }
  result: { thicknessMm: number, productThermalResistance: number, totalThermalResistance: number, kValue: number }
  /** 来源资料与印刷页码（用于回溯原始页面）。 */
  sourceDocumentId?: string | null
  sourcePageId?: string | null
  sourcePageLabel?: string | null
  catalogProductId?: string | null
  evidence: { source: string, ref: string }
}

export interface ThermalLimitSnapshot {
  id: string
  regionCode: string
  regionName: string
  basisCode: string
  basisName: string
  clauseRef: string
  limitKValue: number
  version: number
}

export interface ThermalCandidateQueryResult {
  /** 实际生效的查询条件（回显）。 */
  filters?: ThermalNormalizedLookupFilter[]
  requestedTolerance?: number
  effectiveTolerance?: number
  toleranceAdjusted?: boolean
  metric?: ThermalLookupMetric
  targetValue?: number | null
  tolerance?: number | null
  calculationSource: 'REFERENCE_TABLE'
  /** 实际生效的匹配语义（确认「接近」与「上限」未被混淆）。 */
  lookupMode?: ThermalLookupMode
  kTolerance?: number | null
  candidates: ThermalCandidate[]
  missingConditions: string[]
  notes: string[]
  limit: ThermalLimitSnapshot | null
  /** 多标准并存时非空：须由用户选择（standardLimitId）。 */
  limitCandidates: ThermalLimitSnapshot[] | null
}

export type { EvidenceLevel, PageResult }
