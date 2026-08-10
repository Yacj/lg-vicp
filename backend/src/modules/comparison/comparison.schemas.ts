import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 材料对比规则引擎 Zod Schema（body / query / params / DTO）。
 * - 版本化主体：comparison_versions（同 code 多版本行，发布互斥，new-version 派生新草稿并复制材料/规则/证据）。
 * - 子表：材料/规则/证据随版本化，无独立审核列（状态由版本承载，编辑受版本状态守卫）。
 * - 规则引用同一版本内的双方材料（VICP 侧与竞品侧），不同型号/密度/测试条件由材料行承载，防止混比。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });
export const versionIdParams = z.object({ versionId: z.uuid("版本 ID 格式不正确") });

export const comparisonReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const comparisonEvidenceLevelSchema = z.enum(["A", "B", "C"]);
export const comparisonMaterialCategorySchema = z.enum(["VICP", "EPS", "XPS", "ROCK_WOOL", "PU", "TRADITIONAL_BOARD"]);
export const comparisonBenchmarkTypeSchema = z.enum(["SAME_THICKNESS", "SAME_LAMBDA", "SAME_R_VALUE", "PERFORMANCE", "OTHER"]);
export const comparisonEvidenceSideSchema = z.enum(["VICP", "COMPETITOR"]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();

/** 正数数值（双方数值共用口径，最多 4 位小数） */
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

// ---------------------------------------------------------------- 版本

export const comparisonVersionCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: comparisonEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});
export const comparisonVersionUpdateSchema = comparisonVersionCreateSchema.partial();

export const comparisonVersionDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: comparisonEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: comparisonReviewStatusSchema,
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

export const comparisonVersionListQuerySchema = paginationQuerySchema.extend({
  status: comparisonReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 材料

export const comparisonMaterialCreateSchema = z.object({
  category: comparisonMaterialCategorySchema,
  name: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(120),
  density: z.coerce.number().positive().max(100000).nullable().optional(),
  densityUnit: z.string().trim().max(40).nullable().optional(),
  testConditions: z.string().trim().max(4000).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: comparisonEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});
export const comparisonMaterialUpdateSchema = comparisonMaterialCreateSchema.partial();

export const comparisonMaterialDto = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
  category: comparisonMaterialCategorySchema,
  name: z.string(),
  model: z.string(),
  density: z.number().nullable(),
  densityUnit: z.string().nullable(),
  testConditions: z.string().nullable(),
  description: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: comparisonEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const comparisonMaterialListQuerySchema = paginationQuerySchema.extend({
  category: comparisonMaterialCategorySchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 维度（五维固定 + 子指标扩展）

export const comparisonDimensionCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  parentId: z.uuid("父维度 ID 格式不正确").nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  enabled: z.boolean().default(true),
  remark: z.string().trim().max(255).nullable().optional()
});
export const comparisonDimensionUpdateSchema = comparisonDimensionCreateSchema.partial();

export const comparisonDimensionDto = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number(),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 规则

export const comparisonRuleCreateSchema = z.object({
  dimensionId: z.uuid("维度 ID 格式不正确"),
  subIndicatorName: z.string().trim().max(120).nullable().optional(),
  vicpMaterialId: z.uuid("VICP 材料 ID 格式不正确"),
  competitorMaterialId: z.uuid("竞品材料 ID 格式不正确"),
  benchmarkType: comparisonBenchmarkTypeSchema,
  benchmarkDesc: z.string().trim().min(1).max(255),
  vicpValue: positiveNumber(),
  vicpUnit: z.string().trim().min(1).max(40),
  competitorValue: positiveNumber().nullable().optional(),
  competitorUnit: z.string().trim().max(40).nullable().optional(),
  advantageText: z.string().trim().min(1).max(4000),
  applicability: z.string().trim().min(1).max(4000),
  mandatoryDisclosure: z.string().trim().min(1).max(4000),
  forbiddenWording: z.string().trim().max(4000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0)
});
export const comparisonRuleUpdateSchema = comparisonRuleCreateSchema.partial();

/** 规则 DTO：附带双方材料与证据（供后台列表与 AI 消费复用同一形状） */
export const comparisonRuleDto = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
  dimensionId: z.uuid(),
  dimensionName: z.string(),
  subIndicatorName: z.string().nullable(),
  vicpMaterialId: z.uuid(),
  competitorMaterialId: z.uuid(),
  benchmarkType: comparisonBenchmarkTypeSchema,
  benchmarkDesc: z.string(),
  vicpValue: z.number(),
  vicpUnit: z.string(),
  competitorValue: z.number().nullable(),
  competitorUnit: z.string().nullable(),
  advantageText: z.string(),
  applicability: z.string(),
  mandatoryDisclosure: z.string(),
  forbiddenWording: z.string().nullable(),
  sortOrder: z.number(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const comparisonRuleListQuerySchema = paginationQuerySchema.extend({
  dimensionId: z.uuid("维度 ID 格式不正确").optional(),
  competitorCategory: comparisonMaterialCategorySchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 证据

export const comparisonEvidenceCreateSchema = z.object({
  materialId: z.uuid("材料 ID 格式不正确").nullable().optional(),
  side: comparisonEvidenceSideSchema,
  source: z.string().trim().min(1).max(255),
  pageRef: z.string().trim().max(120).nullable().optional(),
  clauseRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: comparisonEvidenceLevelSchema,
  quote: z.string().trim().max(4000).nullable().optional()
});
export const comparisonEvidenceUpdateSchema = comparisonEvidenceCreateSchema.partial();

export const comparisonEvidenceDto = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
  ruleId: z.string().uuid().nullable(),
  materialId: z.string().uuid().nullable(),
  side: comparisonEvidenceSideSchema,
  source: z.string(),
  pageRef: z.string().nullable(),
  clauseRef: z.string().nullable(),
  evidenceLevel: comparisonEvidenceLevelSchema,
  quote: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 批量导入（规则 + 材料，单事务）

/** 批量材料行：与规则间用 materialKey（category|name|model）关联，避免前端自行生成 ID */
export const comparisonBatchMaterialSchema = z.object({
  materialKey: z.string().trim().min(1).max(320),
  ...comparisonMaterialCreateSchema.shape
});

/** 批量规则行：材料引用使用 materialKey（必须与 materials 数组中的 key 对应） */
export const comparisonBatchRuleSchema = z.object({
  vicpMaterialKey: z.string().trim().min(1).max(320),
  competitorMaterialKey: z.string().trim().min(1).max(320),
  ...comparisonRuleCreateSchema.omit({ vicpMaterialId: true, competitorMaterialId: true }).shape
});

export const comparisonRuleBatchCreateSchema = z.object({
  materials: z.array(comparisonBatchMaterialSchema).max(200),
  rules: z.array(comparisonBatchRuleSchema).max(500)
}).refine((body) => body.materials.length > 0 || body.rules.length === 0, {
  message: "导入规则时必须同时提供规则引用的材料"
});

export const comparisonRuleBatchResultDto = z.object({
  materials: z.array(comparisonMaterialDto),
  rules: z.array(comparisonRuleDto)
});

// ---------------------------------------------------------------- 已发布读取（供 AI 与前端复用）

export const comparisonPublishedRuleQuerySchema = z.object({
  competitorCategory: comparisonMaterialCategorySchema.optional(),
  dimensionCode: z.string().trim().max(80).optional(),
  effectiveDate: z.coerce.date().optional()
});

/** 已发布规则消费形状：规则 + 双方材料 + 证据（VICP 侧/竞品侧），AI 上下文格式化以此为准 */
export const comparisonPublishedRuleDto = comparisonRuleDto.extend({
  vicpMaterial: comparisonMaterialDto,
  competitorMaterial: comparisonMaterialDto,
  evidence: z.array(comparisonEvidenceDto)
});

export { paginated, single };