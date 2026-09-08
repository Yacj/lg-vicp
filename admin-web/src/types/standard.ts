import type { EvidenceLevel } from '@/types/professional'

/**
 * 标准政策模块类型。注意：本模块所有列表接口均返回纯数组（data: DTO[]），无分页。
 */

export interface MutationMessageResponse {
  message: string
}

/** 标准抓取来源（含运营回写：最近抓取结果与人工备注） */
export interface StandardSource {
  id: string
  provinceCode: string
  provinceName: string
  officialDomain: string
  catalogUrls: Array<{
    label: string
    url: string
    listSelector?: string
    itemLinkSelector?: string
    paginationMode?: 'url' | 'scroll' | 'none'
    pageParam?: string
    pageLimit?: number
  }>
  parserType: string
  extractRules: Array<{ field: string, pattern: string, flags?: string }>
  keywords: { titleKeywords: string[], excludeKeywords: string[] }
  crawlScope: 'today' | 'all'
  enabled: boolean
  lastCrawledAt: string | null
  lastCrawlStatus: 'SUCCESS' | 'FAILED' | string | null
  lastCrawlSummary: { fetched?: number, discovered?: number, new?: number, changed?: number, failed?: number, skipped?: number, indicators?: number } | null
  lastErrorMessage: string | null
  operatorRemark: string | null
  createdAt: string
  updatedAt: string
}

export interface StandardSourceInput {
  provinceCode: string
  provinceName: string
  officialDomain: string
  catalogUrls?: Array<{
    label: string
    url: string
    listSelector?: string
    itemLinkSelector?: string
    paginationMode?: 'url' | 'scroll' | 'none'
    pageParam?: string
    pageLimit?: number
  }>
  extractRules?: Array<{ field: string, pattern: string, flags?: string }>
  keywords: { titleKeywords?: string[], excludeKeywords?: string[] }
  crawlScope?: 'today' | 'all'
  enabled?: boolean
  /** 人工备注；清空时提交空字符串，后端按可空文本保存 */
  operatorRemark?: string
}

export const standardCrawlJobStatuses = ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED'] as const
export type StandardCrawlJobStatus = (typeof standardCrawlJobStatuses)[number]

/** 抓取作业 */
export interface StandardCrawlJob {
  id: string
  sourceId: string
  status: StandardCrawlJobStatus
  triggeredBy: 'SCHEDULE' | 'MANUAL'
  scope: string
  catalogResults: Record<string, unknown>[]
  statsJson: Record<string, unknown> | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export const standardDocumentStatuses = ['DRAFT_CONSULTATION', 'OFFICIAL', 'SUPERSEDED', 'REPEALED'] as const
export type StandardDocumentStatus = (typeof standardDocumentStatuses)[number]

export const standardIngestTypes = ['CRAWL', 'MANUAL'] as const
export type StandardIngestType = (typeof standardIngestTypes)[number]

export const standardParseStatuses = ['PENDING', 'PARSED', 'FAILED'] as const
export type StandardParseStatus = (typeof standardParseStatuses)[number]

/** 标准文档（抓取结果默认待审核，未经人工审核不得自动参与正式合规判断） */
export interface StandardDocument {
  id: string
  ingestType: StandardIngestType
  provinceCode: string
  provinceName: string
  sourceId: string | null
  crawlJobId: string | null
  documentNo: string
  title: string
  category: string | null
  standardStatus: StandardDocumentStatus
  publishDate: string | null
  implementDate: string | null
  effectiveAt: string | null
  expiresAt: string | null
  originUrl: string | null
  pageHtmlObjectKey: string | null
  pageHtmlSha256: string | null
  fileObjectKey: string | null
  fileSha256: string | null
  fileSize: number | null
  screenshotObjectKey: string | null
  parseStatus: StandardParseStatus
  supersededById: string | null
  version: number
  status: string
  submittedAt: string | null
  approvedAt: string | null
  rejectReason: string | null
  publishedAt: string | null
  createdById: string | null
  createdAt: string
}

/** 标准文档人工组合录入（指标至少 1 条且每条 evidenceRef 必填） */
export interface StandardDocumentInput {
  provinceCode: string
  provinceName: string
  documentNo: string
  title: string
  indicators: StandardIndicatorInput[]
  category?: string
  standardStatus?: StandardDocumentStatus
  publishDate?: string
  implementDate?: string
  effectiveAt?: string
  expiresAt?: string
  originUrl?: string
  evidenceSource?: string
  applicability?: StandardApplicabilityInput[]
}

/** 标准文档更新（仅草稿） */
export interface StandardDocumentUpdateInput {
  title?: string
  category?: string
  standardStatus?: StandardDocumentStatus
  publishDate?: string
  implementDate?: string
  effectiveAt?: string
  expiresAt?: string
  originUrl?: string
}

export const standardIndicatorTypes = ['K_VALUE', 'HEAT_RESISTANCE', 'OTHER'] as const
export type StandardIndicatorType = (typeof standardIndicatorTypes)[number]

export interface StandardIndicatorInput {
  indicatorType?: StandardIndicatorType
  indicatorName: string
  value: number
  unit?: string
  evidenceRef: string
  rawText?: string
}

/** 标准适用范围 */
export interface StandardApplicability {
  id: string
  documentId: string
  regionCode: string
  regionName: string
  buildingTypes: string[]
  structureTypes: string[]
  scopeText: string | null
  evidenceRef: string | null
  status: string
  createdAt: string
}

export interface StandardApplicabilityInput {
  documentId: string
  regionCode: string
  regionName: string
  buildingTypes?: string[]
  structureTypes?: string[]
  scopeText?: string
  evidenceRef?: string
}

/** 标准指标（发布后同事务写入热工标准限值） */
export interface StandardIndicator {
  id: string
  documentId: string
  applicabilityId: string | null
  indicatorType: StandardIndicatorType
  indicatorName: string
  value: number
  unit: string | null
  evidenceRef: string | null
  rawText: string | null
  evidenceLevel: EvidenceLevel | null
  screenshotObjectKey: string | null
  status: string
  reviewedAt: string | null
  effectiveAt: string | null
  expiresAt: string | null
  version: number
  createdAt: string
}

export const standardReplacementStatuses = ['PENDING', 'CONFIRMED', 'REJECTED'] as const
export type StandardReplacementStatus = (typeof standardReplacementStatuses)[number]

/** 标准替代关系（确认后旧标准过期） */
export interface StandardReplacement {
  id: string
  oldDocumentId: string
  newDocumentId: string
  replacementType: 'SUPERSEDE' | 'REPEAL'
  transitionStartAt: string | null
  transitionEndAt: string | null
  status: StandardReplacementStatus
  note: string | null
  confirmedById: string | null
  confirmedAt: string | null
  createdAt: string
}

export interface StandardReplacementInput {
  oldDocumentId: string
  newDocumentId: string
  replacementType?: 'SUPERSEDE' | 'REPEAL'
  transitionStartAt?: string
  transitionEndAt?: string
  note?: string
}

/** 生效标准（含适用范围与指标） */
export interface EffectiveStandard {
  document: StandardDocument
  applicability: StandardApplicability[]
  indicators: StandardIndicator[]
}
