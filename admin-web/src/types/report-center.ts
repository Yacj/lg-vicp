import type { PageResult } from '@/types/api'
import type { EvidenceLevel, MdReviewStatus } from '@/types/professional'

/** 报告中心类型：报告模板（版本化审核实体）+ 模板报告（项目级生成与审核）。 */

// ===== 报告模板 =====

/** 报告章节 key 固定枚举（与后端 reportSectionKeySchema 一致） */
export const reportSectionKeys = [
  'enterprise',
  'project',
  'standards',
  'candidates',
  'selection',
  'thermal',
  'nodes',
  'construction',
  'comparison',
  'acceptance',
  'sources',
  'disclaimer',
] as const
export type ReportSectionKey = (typeof reportSectionKeys)[number]

export interface ReportSection {
  key: ReportSectionKey
  title: string
  enabled: boolean
  order: number
  sourceType: 'DATA' | 'TEXT'
  /** TEXT 章节文案（DATA 章节禁止携带） */
  content?: string
}

/** 报告模板（DRAFT→PENDING_REVIEW→APPROVED→PUBLISHED→DISABLED，REJECTED 可回） */
export interface ReportTemplate {
  id: string
  code: string
  version: number
  name: string
  description: string | null
  sections: ReportSection[]
  changeNote: string | null
  status: MdReviewStatus
  evidenceSource: string | null
  evidenceRef: string | null
  evidenceLevel: EvidenceLevel | null
  effectiveAt: string | null
  expiresAt: string | null
  submittedById: string | null
  submittedAt: string | null
  approvedById: string | null
  approvedAt: string | null
  approvalNote: string | null
  rejectedById: string | null
  rejectedAt: string | null
  rejectReason: string | null
  publishedById: string | null
  publishedAt: string | null
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportTemplateSectionInput {
  key: ReportSectionKey
  title: string
  enabled?: boolean
  order: number
  sourceType: 'DATA' | 'TEXT'
  content?: string
}

export interface ReportTemplateInput {
  code: string
  name: string
  description?: string
  sections: ReportTemplateSectionInput[]
  changeNote?: string
  evidenceSource?: string
  evidenceRef?: string
  evidenceLevel?: EvidenceLevel
  effectiveAt?: string
  expiresAt?: string
}

export interface ReportTemplateQuery {
  page: number
  pageSize: number
  status?: MdReviewStatus
  keyword?: string
}

/** 结构校验结果（submit/publish 前显式校验，violations 逐条展示） */
export interface ReportTemplateViolation {
  field: string
  message: string
}

// ===== 模板报告 =====

export const templateReportStatuses = [
  'DRAFT',
  'QUEUED',
  'GENERATING',
  'READY',
  'FAILED',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
] as const
export type TemplateReportStatus = (typeof templateReportStatuses)[number]

/** 模板报告（项目级生成，READY→PENDING_REVIEW→APPROVED/REJECTED） */
export interface TemplateReport {
  id: string
  projectId: string
  status: TemplateReportStatus
  reportType: string
  templateVersion: string | null
  publishedAt: string | null
  submittedById: string | null
  submittedAt: string | null
  approvedById: string | null
  approvedAt: string | null
  approvalNote: string | null
  rejectedById: string | null
  rejectedAt: string | null
  rejectReason: string | null
  errorMessage: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

/** 报告数据快照（历史还原） */
export interface ReportSnapshot {
  id: string
  reportId: string
  templateId: string | null
  templateVersion: number | null
  asOfDate: string | null
  dataJson: Record<string, unknown>
  generatedById: string | null
  generatedAt: string
  createdAt: string
  updatedAt: string
}

export interface TemplateReportQuery {
  page: number
  pageSize: number
  projectId: string
  status?: TemplateReportStatus
}

export interface GenerateReportInput {
  reportType?: string
  projectId?: string
  conversationId?: string
  /** 兼容旧接口：已确认候选。不传则按项目取最近一次确认记录。 */
  selectionId?: string
  /** 兼容旧接口：显式内部模板。普通业务不传，由 reportType 自动选用。 */
  templateId?: string
  asOfDate?: string
}

export type { PageResult }