import type { StatusMeta } from '@/utils/professional-status'

/**
 * 标准审核状态 → 业务可见性文案映射：
 * 用中文业务语言说明「这条数据当前能不能给用户用、能不能参与 AI 判定」，
 * 禁止只显示模糊的状态码。
 */

export type StandardReviewStatusCode
  = | 'DRAFT'
    | 'PENDING_REVIEW'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'DISABLED'
    | 'REJECTED'
    | 'UNKNOWN'

export interface StandardVisibilityMeta extends StatusMeta {
  code: StandardReviewStatusCode
  /** 状态中文名 */
  label: string
  /** 用户可见性说明 */
  visibility: string
  /** 是否参与 AI / 热工判定 */
  aiUsage: string
}

const VISIBILITY_META: Record<StandardReviewStatusCode, Omit<StandardVisibilityMeta, 'code'>> = {
  DRAFT: { label: '草稿', status: 'default', visibility: '用户不可见', aiUsage: '不参与 AI / 热工判定' },
  PENDING_REVIEW: { label: '待审核', status: 'warning', visibility: '用户不可见', aiUsage: '不参与 AI / 热工判定' },
  APPROVED: { label: '审核通过待发布', status: 'info', visibility: '用户不可见', aiUsage: '不参与 AI / 热工判定' },
  PUBLISHED: { label: '已发布', status: 'success', visibility: '用户可见', aiUsage: 'AI 可使用 / 参与热工判定' },
  DISABLED: { label: '已停用', status: 'disabled', visibility: '用户不可见', aiUsage: '新请求不可使用' },
  REJECTED: { label: '已驳回', status: 'error', visibility: '用户不可见', aiUsage: '不参与 AI / 热工判定' },
  UNKNOWN: { label: '未知状态', status: 'default', visibility: '用户不可见', aiUsage: '不参与 AI / 热工判定' },
}

export function standardVisibilityMeta(status: string | null | undefined): StandardVisibilityMeta {
  const code = (status && status in VISIBILITY_META ? status : 'UNKNOWN') as StandardReviewStatusCode
  return { code, ...VISIBILITY_META[code] }
}

/** 指标行的一句话完整文案（列表/详情复用） */
export function standardVisibilityText(status: string | null | undefined): string {
  const meta = standardVisibilityMeta(status)
  return `${meta.label} · ${meta.visibility}`
}
