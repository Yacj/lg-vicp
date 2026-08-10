import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 统一审核中心 Zod Schema。
 * - 队列查询：按 entityType（复用审计 targetType）/ status 过滤，分页返回 professional_reviews 行。
 * - 审核决议：approve（approvalNote 可选）/ reject（rejectReason 必填），委托各域审核服务执行。
 * - 实体类型白名单见 review-center.service.ts ENTITY_REVIEWERS（产品/构造/热工/标准/比较/节点/报告模板/报告）。
 */

export const entityTypeParamsSchema = z.object({
  entityType: z.string().trim().min(1).max(80),
  entityId: z.uuid("实体 ID 格式不正确")
});

export const reviewStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]);

export const reviewQueueQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().trim().max(80).optional(),
  status: reviewStatusSchema.optional()
});

/** 审核通过（approve）：approvalNote 可选 */
export const reviewApproveBodySchema = z.object({
  approvalNote: z.string().trim().max(2000).optional()
});

/** 驳回（reject）：rejectReason 必填，体现审核决议 */
export const reviewRejectBodySchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(2000)
});

/** 队列项 DTO：审核记录 + 实体中文名（展示用） */
export const reviewQueueItemDto = z.object({
  id: z.uuid(),
  entityType: z.string(),
  entityId: z.uuid(),
  entityVersion: z.number().nullable(),
  status: reviewStatusSchema,
  comment: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.date().nullable(),
  reviewedById: z.string().uuid().nullable(),
  reviewedAt: z.date().nullable(),
  requestId: z.string().nullable(),
  label: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const reviewDetailDto = z.object({
  record: reviewQueueItemDto,
  /** 实体数据预览（各域详情行） */
  entity: z.record(z.string(), z.unknown()).nullable()
});

// ---------------------------------------------------------------- 响应包装

const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

export const REVIEW_RESPONSES = {
  queue: single(z.object({
    items: z.array(reviewQueueItemDto),
    total: z.number(),
    page: z.number(),
    pageSize: z.number()
  })),
  detail: single(reviewDetailDto),
  item: single(z.record(z.string(), z.unknown()))
};