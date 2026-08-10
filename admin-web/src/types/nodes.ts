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

/** 节点图（版本化实体） */
export interface NodeDrawing extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  position: string
  systemId: string | null
  atlasPage: string | null
  imageFileId: string | null
  cadFileId: string | null
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface NodeDrawingInput {
  code: string
  name: string
  position: string
  systemId?: string
  atlasPage?: string
  imageFileId?: string
  cadFileId?: string
  description?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 节点-方案关联（子表，随节点版本复制） */
export interface NodeSchemeLink extends EvidenceMeta {
  id: string
  nodeDrawingId: string
  schemeId: string
  atlasPage: string | null
  remark: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface NodeDrawingQuery extends ProfessionalPageQuery {
  systemId?: string
  position?: string
}

export interface NodeSchemeLinkQuery extends ProfessionalPageQuery {}

export type { EvidenceLevel, PageResult }