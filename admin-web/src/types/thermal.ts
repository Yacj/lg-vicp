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
  violations: Array<{ field: string; message: string }>
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
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 热工计算规则（版本化实体；图集无结果且规则已审核时才允许计算） */
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
  parameterCodes: { equivalentConductivity: string; correctionFactor: string }
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
  parameterCodes: { equivalentConductivity: string; correctionFactor: string }
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

export type { EvidenceLevel, PageResult }