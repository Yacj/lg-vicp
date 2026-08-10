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

/** 保温系统（版本化实体） */
export interface InsulationSystem extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  systemType: string
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface InsulationSystemInput {
  code: string
  name: string
  systemType: string
  description?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 构造方案（版本化实体） */
export interface ConstructionScheme extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  systemId: string
  schemeCode: string
  name: string
  substrateMaterial: string
  substrateThickness: number | null
  drawingFileId: string | null
  atlasPage: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ConstructionSchemeInput {
  systemId: string
  schemeCode: string
  name: string
  substrateMaterial: string
  substrateThickness?: number
  drawingFileId?: string
  atlasPage?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

export const constructionLayerTypes = ['BASE_LAYER', 'PRODUCT_LAYER', 'FIXING_LAYER', 'VARIABLE_LAYER'] as const
export type ConstructionLayerType = (typeof constructionLayerTypes)[number]

/** 构造层（子表，随方案版本复制，无审核列） */
export interface ConstructionLayer extends EvidenceMeta {
  id: string
  schemeId: string
  layerOrder: number
  layerType: ConstructionLayerType
  layerName: string
  materialId: string | null
  thickness: number | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 构造方案详情（含子表，published 详情端点） */
export interface ConstructionSchemeDetail extends ConstructionScheme {
  layers: ConstructionLayer[]
  productOptions: Array<{
    id: string
    schemeId: string
    productSpecId: string
    minThickness: number
    maxThickness: number
    defaultThickness: number | null
    evidenceSource: string | null
    evidenceRef: string | null
    evidenceLevel: EvidenceLevel | null
  }>
  documents: Array<{
    id: string
    targetType: 'SYSTEM' | 'SCHEME'
    targetId: string
    knowledgeDocumentId: string | null
    atlasPage: string | null
  }>
}

export interface ConstructionSystemQuery extends ProfessionalPageQuery {}

export interface ConstructionSchemeQuery extends ProfessionalPageQuery {
  systemId?: string
  schemeCode?: string
}

export interface InsulationSystemQuery extends ProfessionalPageQuery {}

export type { EvidenceLevel, PageResult }