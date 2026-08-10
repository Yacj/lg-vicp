import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 图集热工参考表模块 Zod Schema（body / query / params / DTO）。
 * - 版本化主体：参考集（同 code 多版本行，发布互斥，new-version 派生新草稿并复制参考行）。
 * - 子表：参考行，随集版本化，无独立审核列（状态由集承载，编辑受集状态守卫）。
 * - body 中日期接受 ISO 字符串，由 z.coerce.date() 转为 Date 传给服务层。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const thermalReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const thermalEvidenceLevelSchema = z.enum(["A", "B", "C"]);
export const thermalJobStatusSchema = z.enum(["CREATED", "QUEUED", "PARSING", "PARSED", "APPLIED", "FAILED"]);
export const thermalImportErrorTypeSchema = z.enum([
  "UNKNOWN_SCHEME", "UNKNOWN_SPEC", "OUT_OF_RANGE", "PARSE_ERROR", "MISSING_EVIDENCE", "DUPLICATE_IN_FILE", "APPLY_CONFLICT"
]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();

/** 正数毫米值（厚度/热阻/K 值共用的数值口径，最多 4 位小数） */
const positiveNumber = () => z.coerce.number().positive().max(100000);

const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({ items: z.array(itemDto), total: z.number(), page: z.number(), pageSize: z.number() }),
  requestId: z.string()
});
const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

// ---------------------------------------------------------------- 参考集

export const thermalSetCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  atlasDocumentId: z.uuid("图集文档 ID 格式不正确").nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: thermalEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});
export const thermalSetUpdateSchema = thermalSetCreateSchema.partial();

export const thermalSetDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  atlasDocumentId: z.string().uuid().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: thermalEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: thermalReviewStatusSchema,
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

export const thermalSetListQuerySchema = paginationQuerySchema.extend({
  status: thermalReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 参考行

export const thermalRowCreateSchema = z.object({
  schemeId: z.uuid("构造方案 ID 格式不正确"),
  productSpecId: z.uuid("产品规格 ID 格式不正确"),
  thicknessMm: positiveNumber(),
  productThermalResistance: positiveNumber(),
  totalThermalResistance: positiveNumber(),
  kValue: positiveNumber(),
  rawThickness: z.string().trim().min(1).max(80),
  rawProductResistance: z.string().trim().min(1).max(80),
  rawTotalResistance: z.string().trim().min(1).max(80),
  rawKValue: z.string().trim().min(1).max(80),
  evidenceSource: z.string().trim().min(1).max(500),
  evidenceRef: z.string().trim().min(1).max(120),
  evidenceLevel: thermalEvidenceLevelSchema.default("A")
});
export const thermalRowUpdateSchema = thermalRowCreateSchema.partial();

export const thermalRowDto = z.object({
  id: z.uuid(),
  setId: z.uuid(),
  schemeId: z.uuid(),
  productSpecId: z.uuid(),
  thicknessMm: z.number(),
  productThermalResistance: z.number(),
  totalThermalResistance: z.number(),
  kValue: z.number(),
  rawThickness: z.string(),
  rawProductResistance: z.string(),
  rawTotalResistance: z.string(),
  rawKValue: z.string(),
  evidenceSource: z.string(),
  evidenceRef: z.string(),
  evidenceLevel: thermalEvidenceLevelSchema,
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const thermalRowListQuerySchema = paginationQuerySchema.extend({
  schemeId: z.uuid("构造方案 ID 格式不正确").optional()
});

// ---------------------------------------------------------------- 导入作业

export const thermalImportJobCreateSchema = z.object({
  setCode: z.string().trim().min(1).max(80),
  name: z.string().trim().max(160).optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.literal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  sizeBytes: z.coerce.number().int().positive().max(100 * 1024 * 1024),
  sha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "sha256 必须为 64 位十六进制").optional()
});

export const thermalImportApplySchema = z.object({
  ignoreErrors: z.boolean().default(false)
});

export const thermalImportErrorDto = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  sheetName: z.string().nullable(),
  rowNumber: z.number(),
  rawRow: z.record(z.string(), z.unknown()).nullable(),
  errorType: z.string(),
  message: z.string(),
  createdAt: z.date()
});

export const thermalImportJobDto = z.object({
  id: z.uuid(),
  setCode: z.string(),
  name: z.string().nullable(),
  setId: z.string().uuid().nullable(),
  fileId: z.uuid(),
  templateVersion: z.number(),
  status: thermalJobStatusSchema,
  rowCount: z.number(),
  validCount: z.number(),
  errorCount: z.number(),
  errorSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  appliedById: z.string().uuid().nullable(),
  appliedAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const thermalImportJobListQuerySchema = paginationQuerySchema.extend({
  status: thermalJobStatusSchema.optional(),
  setCode: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 导入预览 / 差异 / 应用响应

/** 解析结果中的匹配行（快照形状，无主键/审计列） */
export const thermalMatchedRowDto = z.object({
  schemeId: z.uuid(),
  productSpecId: z.uuid(),
  thicknessMm: z.number(),
  productThermalResistance: z.number(),
  totalThermalResistance: z.number(),
  kValue: z.number(),
  rawThickness: z.string(),
  rawProductResistance: z.string(),
  rawTotalResistance: z.string(),
  rawKValue: z.string(),
  evidenceSource: z.string(),
  evidenceRef: z.string()
});

/** 导入预览：解析后的有效行 + 错误清单 */
export const thermalImportPreviewDto = z.object({
  rowCount: z.number(),
  validCount: z.number(),
  errorCount: z.number(),
  rows: z.array(thermalMatchedRowDto),
  errors: z.array(thermalImportErrorDto)
});

/** 差异对比：目标集 + 新增/变化/待移除行（removed 仅提示，apply 不删除） */
export const thermalImportDiffDto = z.object({
  set: thermalSetDto.nullable(),
  added: z.array(thermalMatchedRowDto),
  changed: z.array(z.object({ row: thermalMatchedRowDto, changes: z.array(z.string()) })),
  removed: z.array(thermalRowDto)
});

/** 应用导入结果：目标集 + 应用统计 */
export const thermalImportApplyDto = z.object({
  set: z.object({ id: z.uuid(), code: z.string(), status: thermalReviewStatusSchema, version: z.number() }).nullable(),
  applied: z.number(),
  updated: z.number(),
  skippedRemoved: z.number()
});

/** 导入作业详情：job + 错误清单 */
export const thermalImportJobDetailDto = thermalImportJobDto.extend({
  errors: z.array(thermalImportErrorDto)
});

// ---------------------------------------------------------------- 已发布读取（供筛选模块）

export const thermalPublishedSetQuerySchema = z.object({
  schemeId: z.uuid("构造方案 ID 格式不正确").optional(),
  productSpecId: z.uuid("产品规格 ID 格式不正确").optional(),
  keyword: z.string().trim().max(80).optional()
});

export { paginated, single };