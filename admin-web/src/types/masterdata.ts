import type { PageResult } from '@/types/api'
import type {
  EvidenceLevel,
  EvidenceMeta,
  MdReviewStatus,
  ProfessionalPageQuery,
  ReviewMeta,
  VersionMeta,
} from '@/types/professional'

/** 单对象响应统一包装（masterdata 路由实际返回 data: { item }） */
export interface WorkflowItemResponse<T> {
  item: T
}

export interface MutationMessageResponse {
  message: string
}

/** 结构校验结果（各版本化实体的 validate 端点） */
export interface ValidationResult {
  valid: boolean
  violations: Array<{ field: string; message: string }>
}

// ===== 企业内容 =====

/** 企业简介（版本化实体） */
export interface EnterpriseProfile extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  shortName: string | null
  intro: string | null
  logoFileId: string | null
  address: string | null
  contactPhone: string | null
  contactEmail: string | null
  website: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface EnterpriseProfileInput {
  name: string
  code?: string
  shortName?: string
  intro?: string
  logoFileId?: string
  address?: string
  contactPhone?: string
  contactEmail?: string
  website?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 企业证书（非版本化实体） */
export interface EnterpriseCertificate extends ReviewMeta, EvidenceMeta {
  id: string
  certName: string
  certNo: string | null
  issuer: string | null
  issueDate: string | null
  expiryDate: string | null
  fileId: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface EnterpriseCertificateInput {
  certName: string
  certNo?: string
  issuer?: string
  issueDate?: string
  expiryDate?: string
  fileId?: string
  description?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

// ===== 产品中心 =====

export const productSpecClasses = ['I', 'II', 'III'] as const
export type ProductSpecClass = (typeof productSpecClasses)[number]

export const productProductionStatuses = ['PRODUCING', 'STOPPED'] as const
export type ProductProductionStatus = (typeof productProductionStatuses)[number]

export const productStandardTypes = ['STANDARD', 'CUSTOM'] as const
export type ProductStandardType = (typeof productStandardTypes)[number]

export const productParameterSources = ['TECHNICAL_REGULATION', 'ATLAS', 'DETECTION', 'ENTERPRISE_NOMINAL'] as const
export type ProductParameterSource = (typeof productParameterSources)[number]

export const productAttachmentTargetTypes = ['PRODUCT_SERIES', 'PRODUCT_SPEC', 'ENTERPRISE'] as const
export type ProductAttachmentTargetType = (typeof productAttachmentTargetTypes)[number]

/** 产品系列（版本化实体） */
export interface ProductSeries extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductSeriesInput {
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

/** 产品规格（版本化实体） */
export interface ProductSpec extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  seriesId: string
  specCode: string
  specClass: ProductSpecClass
  thicknessMm: number
  lengthMm: number | null
  widthMm: number | null
  combustionGrade: string | null
  productionStatus: ProductProductionStatus
  standardType: ProductStandardType
  supplyRegions: string[]
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductSpecInput {
  seriesId: string
  specCode: string
  specClass: ProductSpecClass
  thicknessMm: number
  lengthMm?: number
  widthMm?: number
  combustionGrade?: string
  productionStatus?: ProductProductionStatus
  standardType?: ProductStandardType
  supplyRegions?: string[]
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 产品性能参数（版本化实体） */
export interface ProductParameter extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  specId: string
  parameterCode: string
  parameterName: string
  paramSource: ProductParameterSource
  value: number
  unit: string | null
  allowedUsage: string[]
  applicableScope: string | null
  testReportFileId: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductParameterInput {
  specId: string
  parameterCode: string
  parameterName: string
  paramSource: ProductParameterSource
  value: number
  unit?: string
  allowedUsage?: string[]
  applicableScope?: string
  testReportFileId?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 产品附件（非版本化实体） */
export interface ProductAttachment extends ReviewMeta, EvidenceMeta {
  id: string
  targetType: ProductAttachmentTargetType
  targetId: string
  fileId: string
  attachmentType: string
  name: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductAttachmentInput {
  targetType: ProductAttachmentTargetType
  targetId: string
  fileId: string
  attachmentType?: string
  name?: string
  description?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

// ===== 基础数据 =====

/** 材料（版本化实体） */
export interface Material extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface MaterialInput {
  code: string
  name: string
  category?: string
  description?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

/** 材料参数版本（版本化实体，确定性计算唯一参数源） */
export interface MaterialParameterVersion extends VersionMeta, ReviewMeta, EvidenceMeta {
  id: string
  materialId: string
  thermalConductivity: number
  correctionFactor: number | null
  density: number | null
  compressiveStrength: number | null
  bondStrength: number | null
  combustionGrade: string | null
  applicableStandard: string | null
  source: string | null
  allowedUsage: string[]
  applicableScope: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface MaterialParameterVersionInput {
  materialId: string
  thermalConductivity: number
  correctionFactor?: number
  density?: number
  compressiveStrength?: number
  bondStrength?: number
  combustionGrade?: string
  applicableStandard?: string
  source?: string
  allowedUsage?: string[]
  applicableScope?: string
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

// ===== 查询参数 =====

export interface EnterpriseProfileQuery extends ProfessionalPageQuery {}

export interface EnterpriseCertificateQuery extends ProfessionalPageQuery {}

export interface ProductSeriesQuery extends ProfessionalPageQuery {}

export interface ProductSpecQuery extends ProfessionalPageQuery {
  seriesId?: string
  specClass?: ProductSpecClass | '' | 'all'
  standardType?: ProductStandardType | '' | 'all'
  productionStatus?: ProductProductionStatus | '' | 'all'
}

export interface ProductParameterQuery extends ProfessionalPageQuery {
  specId?: string
  parameterCode?: string
  paramSource?: ProductParameterSource | '' | 'all'
}

export interface ProductAttachmentQuery extends ProfessionalPageQuery {
  targetType?: ProductAttachmentTargetType | '' | 'all'
  targetId?: string
}

export interface MaterialQuery extends ProfessionalPageQuery {}

export interface MaterialParameterVersionQuery extends ProfessionalPageQuery {
  materialId?: string
}

export type { EvidenceLevel, MdReviewStatus, PageResult }