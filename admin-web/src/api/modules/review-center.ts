import { api } from '@/api/http/client'
import type { PageResult } from '@/types/api'
import type { ReviewDetail, ReviewQueueItem, ReviewQueueQuery } from '@/types/review-center'

const REVIEW_PREFIX = '/api/v1/platform/review-center'

function queuePath(entityType: string, entityId: string): string {
  return `${REVIEW_PREFIX}/queue/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`
}

/** 统一审核队列 */
export function fetchReviewQueue(
  query: ReviewQueueQuery,
  signal?: AbortSignal,
): Promise<PageResult<ReviewQueueItem>> {
  return api.get<PageResult<ReviewQueueItem>>(`${REVIEW_PREFIX}/queue`, { params: query, signal })
}

/** 审核记录详情（含实体数据预览） */
export function fetchReviewDetail(entityType: string, entityId: string, signal?: AbortSignal): Promise<ReviewDetail> {
  return api.get<ReviewDetail>(queuePath(entityType, entityId), { signal })
}

/** 审核通过（PENDING_REVIEW → APPROVED） */
export function approveReview(entityType: string, entityId: string, approvalNote?: string): Promise<ReviewQueueItem> {
  return api.post<ReviewQueueItem>(`${queuePath(entityType, entityId)}/approve`, approvalNote ? { approvalNote } : {})
}

/** 驳回（PENDING_REVIEW → REJECTED，rejectReason 必填） */
export function rejectReview(entityType: string, entityId: string, rejectReason: string): Promise<ReviewQueueItem> {
  return api.post<ReviewQueueItem>(`${queuePath(entityType, entityId)}/reject`, { rejectReason })
}