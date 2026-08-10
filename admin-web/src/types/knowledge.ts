import type { PageResult } from '@/types/api'
import type { EvidenceLevel } from '@/types/professional'

/** 知识中心类型。文档/版本审核状态与专业主数据不同：文档 ACTIVE|DISABLED，版本 DRAFT|APPROVED|PUBLISHED|DISABLED。 */

export interface MutationMessageResponse {
  message: string
}

export const knowledgeDocTypes = [
  'SPECIFICATION',
  'DETAIL_ATLAS',
  'STANDARD',
  'APPLICATION_GUIDE',
  'MATERIAL_COMPARISON',
  'COMPANY_PROFILE',
  'THERMAL_FORMULA',
  'OTHER',
] as const
export type KnowledgeDocType = (typeof knowledgeDocTypes)[number]

export const knowledgeVersionStatuses = ['DRAFT', 'APPROVED', 'PUBLISHED', 'DISABLED'] as const
export type KnowledgeVersionStatus = (typeof knowledgeVersionStatuses)[number]

export const knowledgeParseStatuses = ['PENDING', 'PARSING', 'PARSED', 'PARTIAL', 'OCR_REQUIRED', 'FAILED'] as const
export type KnowledgeParseStatus = (typeof knowledgeParseStatuses)[number]

export const knowledgePipelineStatuses = ['UPLOAD_PENDING', 'UPLOADED', 'PARSING', 'CHUNKING', 'REVIEW_PENDING', 'PUBLISHED', 'FAILED'] as const
export type KnowledgePipelineStatus = (typeof knowledgePipelineStatuses)[number]

/** 知识分类 */
export interface KnowledgeCategory {
  id: string
  parentId: string | null
  name: string
  code: string
  sortOrder: number
  enabled: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCategoryInput {
  name: string
  code: string
  parentId?: string
  sortOrder?: number
  description?: string
  enabled?: boolean
}

/** 知识文档 */
export interface KnowledgeDocument {
  id: string
  title: string
  docNumber: string | null
  docType: KnowledgeDocType
  sourceOrg: string | null
  issueDate: string | null
  effectiveDate: string | null
  evidenceLevel: EvidenceLevel | null
  allowedPurposes: string[]
  categoryId: string | null
  status: 'ACTIVE' | 'DISABLED'
  currentVersionId: string | null
  currentVersion: {
    version: number
    status: KnowledgeVersionStatus
    parseStatus: KnowledgeParseStatus
    pageCount: number | null
    parser: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocumentInput {
  title: string
  docType?: KnowledgeDocType
  docNumber?: string
  sourceOrg?: string
  issueDate?: string
  effectiveDate?: string
  evidenceLevel?: EvidenceLevel
  allowedPurposes?: string[]
  categoryId?: string
}

/** 知识文档版本（工作流：DRAFT→APPROVED→PUBLISHED→DISABLED） */
export interface KnowledgeDocumentVersion {
  id: string
  documentId: string
  version: number
  fileId: string | null
  title: string
  status: KnowledgeVersionStatus
  pipelineStatus: KnowledgePipelineStatus
  parseStatus: KnowledgeParseStatus
  pageCount: number | null
  parser: string | null
  evidenceLevel: EvidenceLevel | null
  changeNote: string | null
  effectiveDate: string | null
  expiryDate: string | null
  createdById: string | null
  approvedById: string | null
  approvedAt: string | null
  approvalNote: string | null
  publishedById: string | null
  publishedAt: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export const knowledgeTermTypes = ['KEYWORD', 'SYNONYM', 'ENTITY', 'CLAUSE_NO'] as const
export type KnowledgeTermType = (typeof knowledgeTermTypes)[number]

/** 别名词典 */
export interface KnowledgeAlias {
  id: string
  term: string
  alias: string
  termType: KnowledgeTermType
  scope: string
  enabled: boolean
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeAliasInput {
  term: string
  alias: string
  termType?: KnowledgeTermType
  scope?: string
  enabled?: boolean
}

/** 知识抓取源 */
export interface KnowledgeCrawlerSource {
  id: string
  name: string
  baseUrl: string
  downloadUrlPattern: string
  docType: KnowledgeDocType
  enabled: boolean
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCrawlerSourceInput {
  name: string
  baseUrl: string
  downloadUrlPattern: string
  docType?: KnowledgeDocType
  enabled?: boolean
}

/** 检索日志（可解释排序，非向量检索） */
export interface KnowledgeSearchLog {
  id: string
  query: string
  normalizedQuery: string
  filters: Record<string, unknown> | null
  matchModes: string[]
  resultCount: number
  topResults: Record<string, unknown>[]
  durationMs: number | null
  projectId: string | null
  searchedAt: string
  user: { id: string; displayName: string } | null
}

export const knowledgeParsingJobStatuses = ['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'OCR_REQUIRED'] as const
export type KnowledgeParsingJobStatus = (typeof knowledgeParsingJobStatuses)[number]

/** 解析任务 */
export interface KnowledgeParsingJob {
  id: string
  documentId: string
  versionId: string
  jobType: 'PARSE' | 'REPARSE' | 'CHUNK_REBUILD' | 'OCR'
  status: KnowledgeParsingJobStatus
  progress: number
  errorMessage: string | null
  result: Record<string, unknown> | null
  attempts: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  document: { title: string }
}

/** 检索排序规则 */
export interface KnowledgeRankingRule {
  id: string
  key: string
  weight: number
  enabled: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocumentQuery {
  page: number
  pageSize: number
  status?: 'ACTIVE' | 'DISABLED'
  docType?: KnowledgeDocType
  categoryId?: string
  keyword?: string
}

export interface KnowledgeAliasQuery {
  page: number
  pageSize: number
  term?: string
  alias?: string
}

export interface KnowledgeSearchLogQuery {
  page: number
  pageSize: number
  keyword?: string
  userId?: string
}

export interface KnowledgeParsingJobQuery {
  page: number
  pageSize: number
  documentId?: string
  versionId?: string
  status?: KnowledgeParsingJobStatus
}

export type { EvidenceLevel, PageResult }