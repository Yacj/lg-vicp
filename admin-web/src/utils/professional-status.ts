/** 状态标签主题（与 AppStatusTag 的 status prop 保持一致的结构化字面量） */
export type AppStatus = 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled'

import type { EvidenceLevel, MdReviewStatus, ProfessionalReviewStatus } from '@/types/professional'

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
 * 证据等级展示标签。A/B/C 的正式语义在甲方资料中未定义，只做原文展示，不附加解释。
 */
export const evidenceLevelLabels: Record<EvidenceLevel, string> = {
  A: '证据等级 A',
  B: '证据等级 B',
  C: '证据等级 C',
}

/** 知识文档版本状态映射（DRAFT→APPROVED→PUBLISHED→DISABLED） */
export const knowledgeVersionStatusMeta: Record<'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'DISABLED', StatusMeta> = {
  DRAFT: { label: '草稿', status: 'default' },
  APPROVED: { label: '已通过', status: 'info' },
  PUBLISHED: { label: '已发布', status: 'success' },
  DISABLED: { label: '已停用', status: 'disabled' },
}

/** 知识文档解析状态映射 */
export const knowledgeParseStatusMeta: Record<'PENDING' | 'PARSING' | 'PARSED' | 'PARTIAL' | 'OCR_REQUIRED' | 'FAILED', StatusMeta> = {
  PENDING: { label: '待解析', status: 'default' },
  PARSING: { label: '解析中', status: 'processing' },
  PARSED: { label: '已解析', status: 'success' },
  PARTIAL: { label: '部分解析', status: 'warning' },
  OCR_REQUIRED: { label: '需 OCR', status: 'warning' },
  FAILED: { label: '解析失败', status: 'error' },
}

/** 未知审核状态的安全回退（不吞掉原始值，展示原文） */
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