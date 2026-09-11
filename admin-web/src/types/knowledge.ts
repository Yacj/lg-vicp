import type { AiSourceRef } from '@/types/ai-source'
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

export const knowledgeParseStatuses = ['PENDING', 'PARSING', 'PARSED', 'PARTIAL', 'OCR_REQUIRED', 'FAILED', 'NO_TEXT_LAYER', 'SEARCH_SOURCE_REQUIRED'] as const
export type KnowledgeParseStatus = (typeof knowledgeParseStatuses)[number]

export const knowledgeUsageModes = ['AI_ENABLED', 'BROWSE_ONLY'] as const
export type KnowledgeUsageMode = (typeof knowledgeUsageModes)[number]

export type KnowledgeAssetRole = 'ORIGINAL' | 'SEARCH_SOURCE' | 'OCR_SOURCE' | 'PREVIEW'
export type KnowledgeTocStatus = 'DRAFT' | 'PENDING_REVIEW' | 'CONFIRMED'
export type KnowledgeTocSource = 'PDF_BOOKMARK' | 'TOC_PAGE' | 'MANUAL' | 'COMPANION_FILE'
export type KnowledgePageMappingMethod = 'PAGE_LABEL' | 'TOC_TITLE' | 'MANUAL'

export const knowledgePipelineStatuses = ['UPLOAD_PENDING', 'UPLOADED', 'PARSING', 'CHUNKING', 'REVIEW_PENDING', 'PUBLISHED', 'FAILED'] as const
export type KnowledgePipelineStatus = (typeof knowledgePipelineStatuses)[number]

/** 普通用户可见的知识库状态（后端 knowledge-user-status 映射）。 */
export const knowledgeUserStatuses = [
  'PENDING_PARSE',
  'PARSING',
  'READY_TO_VERIFY',
  'READY',
  'PARSE_FAILED',
  'SEARCHABLE_FILE_REQUIRED',
] as const
export type KnowledgeUserStatus = (typeof knowledgeUserStatuses)[number]

export const knowledgeDocumentHealthStatuses = ['NEEDS_ACTION', 'READY', 'BROWSE_ONLY', 'PUBLISHED', 'PENDING_REVIEW'] as const
export type KnowledgeDocumentHealthStatus = (typeof knowledgeDocumentHealthStatuses)[number]

export const knowledgeAiAvailabilityStatuses = ['AVAILABLE', 'BROWSE_ONLY', 'UNAVAILABLE'] as const
export type KnowledgeAiAvailabilityStatus = (typeof knowledgeAiAvailabilityStatuses)[number]

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
  publishedVersionId?: string | null
  workingVersionId?: string | null
  userStatus?: KnowledgeUserStatus
  healthStatus: KnowledgeDocumentHealthStatus
  aiAvailabilityStatus: KnowledgeAiAvailabilityStatus
  healthBlockers: string[]
  healthWarnings: string[]
  currentVersion: {
    id?: string
    version: number
    status: KnowledgeVersionStatus
    parseStatus: KnowledgeParseStatus
    pipelineStatus: KnowledgePipelineStatus
    usageMode: KnowledgeUsageMode
    fileId: string | null
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
  usageMode: KnowledgeUsageMode
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

/** 知识抓取源（含运营回写字段：最近抓取结果与人工备注） */
export interface KnowledgeCrawlerSource {
  id: string
  name: string
  baseUrl: string
  downloadUrlPattern: string
  docType: KnowledgeDocType
  enabled: boolean
  lastCrawledAt: string | null
  lastCrawlStatus: 'SUCCESS' | 'FAILED' | null
  lastErrorMessage: string | null
  operatorRemark: string | null
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
  /** 人工备注；清空时提交空字符串，后端按可空文本保存 */
  operatorRemark?: string
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
  user: { id: string, displayName: string } | null
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
  healthStatus?: KnowledgeDocumentHealthStatus
  userStatus?: KnowledgeUserStatus
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

// ===== 文档版本与上传 =====

export interface KnowledgeUploadIntent {
  fileId: string
  mode?: 'UPLOAD' | 'REUSE'
  uploadUrl: string | null
  headers: Record<string, string> | null
  expiresAt: string | null
}

export interface KnowledgeDocumentDetail {
  document: KnowledgeDocument
  versions: KnowledgeDocumentVersion[]
}

export interface KnowledgeVersionInput {
  title?: string
  changeNote?: string
  evidenceLevel?: EvidenceLevel
}

export interface KnowledgeUploadIntentInput {
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  existingFileId?: string
  assetRole?: KnowledgeAssetRole
}

export interface KnowledgeCreateWithFileInput {
  title: string
  docType: KnowledgeDocType
  originalFileId: string
  searchSourceFileId?: string | null
  categoryId?: string | null
  docNumber?: string | null
  sourceOrg?: string | null
  issueDate?: string | null
  effectiveDate?: string | null
  evidenceLevel?: EvidenceLevel | null
  allowedPurposes?: string[]
}

export interface KnowledgeCreateWithFileResult {
  document: { id: string, title: string, docType: KnowledgeDocType }
  version: { id: string, versionNo: number }
  file: { id: string, name: string }
  parsing: { jobId: string, status: 'QUEUED' }
}

export interface KnowledgeReplaceFileInput {
  originalFileId: string
  searchSourceFileId?: string | null
  changeNote?: string
}

export interface KnowledgeWorkspaceFile {
  id: string
  name: string
  mimeType?: string
  sizeBytes?: number
}

export interface KnowledgeParseFailureTechnical {
  parser: string | null
  page?: number
  reason: string
  jobId?: string
  attempts?: number
  stage?: string | null
  stack?: string
}

export interface KnowledgeWorkspaceLastJob {
  id: string
  status: KnowledgeParsingJobStatus
  progress: number
  stage: string | null
  errorMessage: string | null
  userMessage: string | null
  errorCode: string | null
  attempts: number
  startedAt: string | null
  finishedAt: string | null
  technical?: KnowledgeParseFailureTechnical
}

export interface KnowledgeWorkspace {
  document: {
    id: string
    title: string
    docType: KnowledgeDocType
    docNumber?: string | null
    categoryId?: string | null
    currentVersionId: string | null
    publishedVersionId: string | null
  }
  currentVersion: {
    id: string
    versionNo: number
    userStatus: KnowledgeUserStatus
    parseStatus: KnowledgeParseStatus
    status: KnowledgeVersionStatus
    pipelineStatus: KnowledgePipelineStatus
  } | null
  primaryFile: KnowledgeWorkspaceFile | null
  searchableFile?: { id: string, name: string } | null
  parsing: { lastJob: KnowledgeWorkspaceLastJob | null }
  summary: {
    pageCount: number
    tocCount: number
    sectionCount: number
    canAskAi: boolean
    canPublish: boolean
    canRetry: boolean
  }
  actions: {
    canRetry: boolean
    canReplaceFile: boolean
    canBindSearchSource: boolean
  }
}

export interface KnowledgeChapterTreeNode {
  id: string
  title: string
  level: number
  pageLabel: string | null
  physicalPageNumber: number | null
  children?: KnowledgeChapterTreeNode[]
}

export interface KnowledgeChapterTreeResult {
  items: KnowledgeChapterTreeNode[]
}

export interface KnowledgeSelectedFile {
  fileId: string
  name: string
  mimeType: string
  sizeBytes: number
  fromCenter?: boolean
}

export interface KnowledgeVersionTestQaRequest {
  query: string
  reasoningMode?: 'OFF' | 'ON'
  limit?: number
}

/** 普通用户测试知识库引用来源（后端 toUserTestSources，不含 score/chunkId）。 */
export interface KnowledgeUserTestSource {
  documentId: string
  versionId?: string
  title: string
  tocPath?: string[] | null
  sectionTitle?: string | null
  pageLabel?: string | null
  physicalPageNumber?: number | null
  matchedText?: string | null
}

export interface KnowledgeDocumentAsset {
  id: string
  role: KnowledgeAssetRole
  isPrimary: boolean
  fileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  fileStatus: string
  createdAt: string
}

export interface KnowledgeTocItem {
  id: string
  parentId: string | null
  title: string
  level: number
  sortOrder: number
  pageLabel: string | null
  physicalPageNumber: number | null
  source: KnowledgeTocSource
  confidence: number | null
  status?: KnowledgeTocStatus
  sectionId?: string | null
  children?: KnowledgeTocItem[]
}

export interface KnowledgePageBlock {
  id: string
  blockIndex: number
  content: string
  contentType: string
  sectionId?: string | null
  sectionTitle?: string | null
  sourceAnchor?: string | null
  metadata?: Record<string, unknown> | null
}

export interface KnowledgePage {
  id: string
  documentId: string
  versionId: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  pageTitle: string | null
  parsedText: string | null
  extractedText?: string | null
  pageImageObjectKey: string | null
  pageImageUrl?: string | null
  sectionPath: string | null
  sectionId?: string | null
  blocks?: KnowledgePageBlock[]
  hasTables: boolean
  hasImages: boolean
  parseStatus: string
  createdAt: string
}

export interface KnowledgePageMapping {
  id: string
  searchPhysicalPageNumber: number
  originalPhysicalPageNumber: number | null
  originalPageId: string | null
  pageLabel: string | null
  mappingMethod: KnowledgePageMappingMethod
  confidence: number | null
  verified: boolean
}

export interface KnowledgeAiReadiness {
  eligible: boolean
  blockers: string[]
  warnings: string[]
  hasSearchSourceAsset?: boolean
  mappingCount?: number
  verifiedMappingCount?: number
  tocItemCount?: number
  confirmedTocCount?: number
}

/** 版本文件资产 */
export interface KnowledgeVersionAssetsResult {
  items: KnowledgeDocumentAsset[]
}

/** 原文目录 */
export interface KnowledgeVersionTocResult {
  items: KnowledgeTocItem[]
}

/** 页面映射 */
export interface KnowledgePageMappingsResult {
  items: KnowledgePageMapping[]
  total: number
}

export interface KnowledgePageWindowItem {
  id: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  pageLabelSource: string
  pageLabelConfidence: number | null
  pageLabelVerified: boolean
  pageTitle: string | null
  hasTables: boolean
  hasImages: boolean
  sectionPath: string | null
}

export interface KnowledgePageWindow {
  current: number
  total: number
  page: {
    id: string
    pageNumber: number
    physicalPageNumber: number
    pageLabel: string | null
    pageLabelSource: string
    pageLabelConfidence: number | null
    pageLabelVerified: boolean
    pageTitle: string | null
    fullText: string
    extractedText: string
    blocks: KnowledgePageBlock[]
    pageImageUrl: string | null
  }
  items: KnowledgePageWindowItem[]
}

/** 页面与分块 */
export const knowledgeChunkContentTypes = [
  'PARAGRAPH',
  'TITLE',
  'SECTION',
  'CLAUSE',
  'TABLE',
  'NOTE',
  'FORMULA',
  'IMAGE_CAPTION',
] as const
export type KnowledgeChunkContentType = (typeof knowledgeChunkContentTypes)[number]

export interface KnowledgeChunk {
  id: string
  chunkIndex: number
  content: string
  contentType: KnowledgeChunkContentType
  sourcePage: number | null
  pageEnd: number | null
  sourceSection: string | null
  headingLevel: number | null
  keywords: string[] | null
  aliasTerms: string[] | null
  citationAnchor: string | null
  sortWeight: number | null
  searchText: string | null
  metadata: Record<string, unknown> | null
  annotation: string | null
  invalid: boolean | null
  invalidReason: string | null
  editedAt: string | null
}

export interface KnowledgeChunkTerm {
  id: string
  chunkId: string
  term: string
  termType: KnowledgeTermType
  weight: number
}

export interface KnowledgeChunkEditInput {
  keywords?: string[]
  heading?: string | null
  headingLevel?: number
  citationAnchor?: string | null
  annotation?: string | null
  invalid?: boolean
  invalidReason?: string | null
}

// ===== 检索 =====

/**
 * 检索命中（Wiki 级层级检索：体系 → 文档 → 章节 → 页面 → 内容块，Chunk 辅助）。
 * 与后端 knowledge.service.ts SearchHit（继承 WikiHit）对齐。
 */
export interface KnowledgeSearchHit {
  sourceId?: string
  chunkId?: string
  documentId: string
  versionId?: string
  sectionId?: string | null
  pageId?: string | null
  pageBlockId?: string | null
  retrievalUnit?: 'DOCUMENT' | 'SECTION' | 'PAGE' | 'BLOCK' | 'CHUNK'
  content?: string
  sourcePage: number | null
  pageEnd: number | null
  physicalPageNumber?: number | null
  pageLabel?: string | null
  pageTitle?: string | null
  originalFileId?: string | null
  sourceSection: string | null
  headingPath?: string[] | null
  sourceTitle: string
  version?: number
  docNumber: string | null
  citationAnchor: string | null
  contentType?: string
  score?: number | null
  hitReason?: string
  rankScore?: number | null
  snippet: string
  matchedTerms?: string[]
  matchReasons?: string[]
  evidenceLevel?: string | null
  usageScope: string[] | null
  region: string | null
}

export interface KnowledgeSearchQuery {
  query: string
  docType?: KnowledgeDocType
  categoryId?: string
  projectId?: string
  region?: string
  purpose?: string
  limit?: number
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchHit[]
  took: number
}

// ===== 检索评测 =====

export const knowledgeEvaluationJudgements = ['PENDING', 'APPROVED', 'REJECTED', 'PARTIAL'] as const
export type KnowledgeEvaluationJudgement = (typeof knowledgeEvaluationJudgements)[number]

export interface KnowledgeEvaluation {
  id: string
  query: string
  normalizedQuery: string
  parsedKeywords: string[] | null
  expectedDocumentId: string | null
  expectedPage: number | null
  actualTopResults: Record<string, unknown>[] | null
  judgement: KnowledgeEvaluationJudgement
  judgedById: string | null
  judgedAt: string | null
  note: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeEvaluationInput {
  query: string
  expectedDocumentId?: string
  expectedPage?: number
}

export interface KnowledgeEvaluationQuery {
  page: number
  pageSize: number
  judgement?: KnowledgeEvaluationJudgement | 'ALL'
}

// ===== 公开文库（visibility=PUBLIC + 版本 PUBLISHED + 生效中，复用同一 Wiki 读取口径） =====

/** Wiki 章节树节点（GET /platform/knowledge/versions/:versionId/sections，扁平有序，按 parentId/level 组树） */
export interface KnowledgeVersionSection {
  id: string
  parentId: string | null
  title: string
  level: number
  sectionPath: string[]
  startPage: number | null
  endPage: number | null
  sortOrder: number
}

export interface PublicLibraryDocumentItem {
  id: string
  title: string
  docNumber: string | null
  docType: KnowledgeDocType
  versionId: string
  version: number
  pageCount: number | null
  region: string | null
  publishedAt: string | null
}

export interface PublicLibraryDocumentQuery {
  page: number
  pageSize: number
  categoryId?: string
  docType?: KnowledgeDocType
  keyword?: string
  sort?: 'latest' | 'title'
}

export type PublicLibrarySectionNode = KnowledgeVersionSection

export interface PublicLibraryDocumentDetail {
  document: {
    id: string
    title: string
    versionId: string
    version: number
    docNumber: string | null
    docType: string
    visibility: string
    projectId: string | null
  }
  sections: PublicLibrarySectionNode[]
}

export interface PublicLibraryPageListItem {
  id: string
  pageNumber: number
  physicalPageNumber?: number
  pageLabel?: string | null
  pageTitle?: string | null
  hasTables: boolean
  hasImages: boolean
  sectionPath: string | null
}

export interface PublicLibraryTocResult {
  items: KnowledgeTocItem[]
}

export interface PublicLibraryPageDetail {
  id: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  pageTitle: string | null
  fullText: string
  extractedText: string
  blocks: KnowledgePageBlock[]
  pageImageUrl: string | null
}

// ===== 知识问答（检索 + AI 回答，SSE） =====

export interface KnowledgeQaRequest {
  query: string
  categoryId?: string
  docType?: KnowledgeDocType
  region?: string
  purpose?: string
  limit?: number
  reasoningMode?: 'OFF' | 'ON'
}

/**
 * AI 引用来源：统一复用 AiSourceRef 契约（后端 ai-generation 通过 ai-source.mapper 输出）。
 */
export type KnowledgeQaSource = AiSourceRef

export type KnowledgeQaSseEvent
  = | { type: 'message', data: { messageId: string, conversationId: string, requestId: string } }
    | { type: 'progress', data: { stage: string, message: string } }
    | { type: 'delta', data: { text: string } }
    | {
      type: 'done'
      data: {
        messageId: string
        conversationId: string
        finishReason: string
        model: { id: string }
        promptVersion: { id: string, version: number }
        sources: Array<KnowledgeQaSource | KnowledgeUserTestSource>
        latencyMs: number
        usage?: { inputTokens?: number | null, outputTokens?: number | null, reasoningTokens?: number | null }
      }
    }
    | { type: 'stopped', data: { messageId: string, partialContent: string, content: string } }
    | { type: 'error', data: { code: string, message: string, requestId: string, retryable: boolean } }

export type { EvidenceLevel, PageResult }
