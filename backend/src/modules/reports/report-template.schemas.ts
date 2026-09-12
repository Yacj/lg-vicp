import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 报告模板模块 Zod Schema（body / query / params / DTO）。
 * - 报告模板为版本化审核实体：同逻辑键多版本行，发布互斥，new-version 派生新草稿。
 * - sectionsJson 为章节配置数组：key 固定枚举（12 个 DATA 数据章节 + 免责声明等 TEXT 文案章节），
 *   sourceType=DATA 由报告快照数据确定性渲染，sourceType=TEXT 直接使用配置文案。
 * - 章节配置校验：key 唯一、order 从 1 连续、DATA 章节不允许配置 content、TEXT 章节 content 必填、至少一个启用。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const reportReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const reportEvidenceLevelSchema = z.enum(["A", "B", "C"]);

/** 报告章节 key 固定枚举（与 src/db/schema.ts ReportTemplateSection.key 一致） */
export const reportSectionKeySchema = z.enum([
  "enterprise",
  "project",
  "standards",
  "candidates",
  "selection",
  "thermal",
  "nodes",
  "construction",
  "comparison",
  "acceptance",
  "sources",
  "disclaimer"
]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();

/** 证据列（create/update 共用，update 时额外允许省略） */
const evidenceFields = () => ({
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: reportEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});

// 分页响应包装（挂 schema.response）
const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({
    items: z.array(itemDto),
    total: z.number(),
    page: z.number(),
    pageSize: z.number()
  }),
  requestId: z.string()
});
const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

// ---------------------------------------------------------------- 报告模板

export const reportSectionSchema = z.object({
  key: reportSectionKeySchema,
  title: z.string().trim().min(1, "章节标题必填").max(120),
  enabled: z.boolean().default(true),
  order: z.number().int().positive("章节顺序必须为正整数").max(100),
  sourceType: z.enum(["DATA", "TEXT"]),
  /** TEXT 章节文案（DATA 章节禁止携带） */
  content: z.string().trim().max(10000).optional()
});

export const reportTemplateCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  sections: z.array(reportSectionSchema).min(1, "至少配置一个报告章节"),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  requiresProject: z.boolean().default(false),
  ...evidenceFields()
});
export const reportTemplateUpdateSchema = reportTemplateCreateSchema.partial();

export const reportTemplateDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  sections: z.array(reportSectionSchema),
  changeNote: z.string().nullable(),
  requiresProject: z.boolean(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: reportEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: reportReviewStatusSchema,
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.date().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.date().nullable(),
  approvalNote: z.string().nullable(),
  rejectedById: z.string().uuid().nullable(),
  rejectedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  publishedById: z.string().uuid().nullable(),
  publishedAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 工作流请求体

/** 审核通过（approve）：approvalNote 可选 */
export const approveBodySchema = z.object({
  approvalNote: z.string().trim().max(2000).optional()
});

/** 驳回（reject）：rejectReason 必填，体现审核决议 */
export const rejectBodySchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(2000)
});

/** 派生新版本：changeNote 可选 */
export const newVersionBodySchema = z.object({
  changeNote: z.string().trim().max(2000).optional()
});

// ---------------------------------------------------------------- 查询 schema（挂 request.querystring）

export const reportTemplateListQuerySchema = paginationQuerySchema.extend({
  status: reportReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 响应包装集合

export const REPORT_TEMPLATE_RESPONSES = {
  single,
  paginated,
  templateList: paginated(reportTemplateDto),
  templateSingle: single(reportTemplateDto),
  message: single(z.object({ message: z.string() }))
};