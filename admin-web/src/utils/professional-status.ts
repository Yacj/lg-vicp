/** 状态标签主题（与 AppStatusTag 的 status prop 保持一致的结构化字面量） */
export type AppStatus = 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled'

import { evidenceLevelMeta, type EvidenceLevel, type MdReviewStatus, type ProfessionalReviewStatus } from '@/types/professional'
import type { KnowledgeParseStatus, KnowledgeVersionStatus } from '@/types/knowledge'

export interface StatusMeta {
  label: string
  status: AppStatus
}

/** 专业数据审核状态映射（mdReviewStatusEnum） */
export const mdReviewStatusMeta: Record<MdReviewStatus, StatusMeta> = {
  DRAFT: { label: '草稿', status: 'default' },
  PENDING_REVIEW: { label: '待审核', status: 'warning' },
  APPROVED: { label: '已通过', status: 'info' },
  PUBLISHED: { label: '已发布', status: 'success' },
  DISABLED: { label: '已停用', status: 'disabled' },
  REJECTED: { label: '已驳回', status: 'error' },
}

/** 统一审核中心决议状态映射（professionalReviewStatusEnum） */
export const professionalReviewStatusMeta: Record<ProfessionalReviewStatus, StatusMeta> = {
  PENDING_REVIEW: { label: '待审核', status: 'warning' },
  APPROVED: { label: '已通过', status: 'success' },
  REJECTED: { label: '已驳回', status: 'error' },
}

/**
 * 证据等级展示标签：「A · 标准规范」形式，一眼可读。
 * 释义来自 evidenceLevelMeta（types/professional.ts），列头另有完整说明。
 */
export const evidenceLevelLabels = Object.fromEntries(
  (Object.keys(evidenceLevelMeta) as EvidenceLevel[]).map((level) => [
    level,
    `${level} · ${evidenceLevelMeta[level].name}`,
  ]),
) as Record<EvidenceLevel, string>

/** 知识文档版本状态映射（DRAFT→APPROVED→PUBLISHED→DISABLED） */
export const knowledgeVersionStatusMeta: Record<KnowledgeVersionStatus, StatusMeta> = {
  DRAFT: { label: '未发布', status: 'default' },
  APPROVED: { label: '已通过', status: 'info' },
  PUBLISHED: { label: '已发布', status: 'success' },
  DISABLED: { label: '已停用', status: 'disabled' },
}

/** 知识文档解析状态映射 */
export const knowledgeParseStatusMeta: Record<KnowledgeParseStatus, StatusMeta> = {
  PENDING: { label: '待解析', status: 'default' },
  PARSING: { label: '解析中', status: 'processing' },
  PARSED: { label: '解析完成', status: 'success' },
  PARTIAL: { label: '部分完成', status: 'warning' },
  OCR_REQUIRED: { label: '需要补充可搜索文字', status: 'warning' },
  FAILED: { label: '解析失败', status: 'error' },
  NO_TEXT_LAYER: { label: '需要补充可搜索文字', status: 'warning' },
  SEARCH_SOURCE_REQUIRED: { label: '需要补充可搜索文字', status: 'warning' },
}

/** 未知知识版本状态回退为原始值，避免接口新增状态导致页面渲染异常。 */
export function knowledgeVersionStatusMetaFor(value: string | null | undefined): StatusMeta {
  if (value && value in knowledgeVersionStatusMeta) {
    return knowledgeVersionStatusMeta[value as KnowledgeVersionStatus]
  }
  return { label: value || '未知', status: 'default' }
}

/** 未知解析状态回退为原始值，避免接口新增状态导致页面渲染异常。 */
export function knowledgeParseStatusMetaFor(value: string | null | undefined): StatusMeta {
  if (value && value in knowledgeParseStatusMeta) {
    return knowledgeParseStatusMeta[value as KnowledgeParseStatus]
  }
  return { label: value || '未知', status: 'default' }
}
export function mdReviewStatusMetaFor(value: string | null | undefined): StatusMeta {
  if (value && value in mdReviewStatusMeta) {
    return mdReviewStatusMeta[value as MdReviewStatus]
  }
  return { label: value || '未知', status: 'default' }
}

export function professionalReviewStatusMetaFor(value: string | null | undefined): StatusMeta {
  if (value && value in professionalReviewStatusMeta) {
    return professionalReviewStatusMeta[value as ProfessionalReviewStatus]
  }
  return { label: value || '未知', status: 'default' }
}