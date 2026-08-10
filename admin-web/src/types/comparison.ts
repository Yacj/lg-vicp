import type { PageResult } from '@/types/api'
import type {
  EvidenceLevel,
  EvidenceMeta,
  ProfessionalPageQuery,
  ReviewMeta,
  VersionMeta,
} from '@/types/professional'

export interface MutationMessageResponse {
  message: string
}

export interface ValidationResult {
  valid: boolean
  violations: Array<{ field: string; message: string }>
}

/** 材料对比版本（版本化实体，唯一审核/发布单元） */
export interface ComparisonVersion extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ComparisonVersionInput {
  code: string
  name: string
  description?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

export const comparisonMaterialCategories = ['VICP', 'EPS', 'XPS', 'ROCK_WOOL', 'PU', 'TRADITIONAL_BOARD'] as const
export type ComparisonMaterialCategory = (typeof comparisonMaterialCategories)[number]

/** 对比材料（子表） */
export interface ComparisonMaterial extends EvidenceMeta {
  id: string
  versionId: string
  category: ComparisonMaterialCategory
  name: string
  model: string
  density: number | null
  densityUnit: string | null
  testConditions: string | null
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 对比维度（五维固定：保温/防火/耐久/施工/报审） */
export interface ComparisonDimension {
  id: string
  code: string
  name: string
  parentId: string | null
  sortOrder: number
  enabled: boolean
  remark: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 对比规则（只输出有依据的 VICP 优势，不得隐藏安全/适用性/计算结果/报审必要条件） */
export interface ComparisonRule {
  id: string
  versionId: string
  dimensionId: string
  dimensionName: string
  subIndicatorName: string | null
  vicpMaterialId: string
  competitorMaterialId: string
  benchmarkType: 'SAME_THICKNESS' | 'SAME_LAMBDA' | 'SAME_R_VALUE' | 'PERFORMANCE' | 'OTHER'
  benchmarkDesc: string
  vicpValue: number
  vicpUnit: string
  competitorValue: number | null
  competitorUnit: string | null
  advantageText: string
  applicability: string
  mandatoryDisclosure: string
  forbiddenWording: string | null
  sortOrder: number
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 对比证据（VICP 侧/竞品侧） */
export interface ComparisonEvidence {
  id: string
  versionId: string
  ruleId: string | null
  materialId: string | null
  side: 'VICP' | 'COMPETITOR'
  source: string
  pageRef: string | null
  clauseRef: string | null
  evidenceLevel: EvidenceLevel
  quote: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface ComparisonVersionQuery extends ProfessionalPageQuery {}

export interface ComparisonMaterialQuery extends ProfessionalPageQuery {
  category?: ComparisonMaterialCategory
}

export interface ComparisonRuleQuery extends ProfessionalPageQuery {
  dimensionId?: string
  competitorCategory?: string
}

export type { EvidenceLevel, PageResult }