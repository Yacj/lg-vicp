/**
 * 专业数据域通用类型：11 个 VICP 业务模块（企业内容/知识中心/产品中心/基础数据/
 * 系统构造/热工中心/材料对比/标准政策/节点图库/报告中心/审核中心）共用。
 * 字段名与后端 DTO 的 camelCase 响应一致（后端 md.schemas.ts 等）。
 */

/** 专业数据审核状态（mdReviewColumns.status，后端 md_review_status 枚举） */
export const mdReviewStatuses = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'DISABLED',
  'REJECTED',
] as const
export type MdReviewStatus = (typeof mdReviewStatuses)[number]

/** 统一审核中心决议状态（professional_reviews.status） */
export const professionalReviewStatuses = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const
export type ProfessionalReviewStatus = (typeof professionalReviewStatuses)[number]

/** 证据等级（knowledge_evidence_level 枚举；A/B/C 的正式语义待甲方确认，前端只做原文展示） */
export const evidenceLevels = ['A', 'B', 'C'] as const
export type EvidenceLevel = (typeof evidenceLevels)[number]

/** 来源与页码/条款证据（mdEvidenceColumns） */
export interface EvidenceMeta {
  evidenceSource: string | null
  evidenceRef: string | null
  evidenceLevel: EvidenceLevel | null
  effectiveAt: string | null
  expiresAt: string | null
}

/** 审核流转字段（mdReviewColumns） */
export interface ReviewMeta {
  status: MdReviewStatus
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  approvalNote: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectReason: string | null
  publishedBy: string | null
  publishedAt: string | null
}

/** 版本化字段 */
export interface VersionMeta {
  version: number
  changeNote: string | null
}

/** 工作流动作入参（判别联合；与后端 workflow-routes 六端点 body 契约一致） */
export type WorkflowActionInput =
  | { type: 'submit' }
  | { type: 'approve'; approvalNote?: string }
  | { type: 'reject'; rejectReason: string }
  | { type: 'publish' }
  | { type: 'disable' }
  | { type: 'new-version'; changeNote?: string }

/** 工作流动作类型（供按钮与菜单权限映射） */
export type WorkflowActionType = WorkflowActionInput['type']

/** 通用列表查询（服务端分页 + 状态/关键词过滤，各模块扩展追加专属字段）。
 * status 额外允许 '' 与 'all'：UI 的「全部状态」占位值，请求发出前在 fetcher 归一化为 undefined。 */
export interface ProfessionalPageQuery {
  page: number
  pageSize: number
  status?: MdReviewStatus | '' | 'all'
  keyword?: string
}