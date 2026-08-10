import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { thermalEvidenceLevelSchema, thermalReviewStatusSchema } from "./thermal.schemas.js";

/**
 * 确定性热工计算引擎 Zod Schema（规则 / 标准限值 / 计算请求 / 计算记录 DTO）。
 * - 计算请求只接受 id/编码标识，任何数值参数（导热系数/修正系数/限值）都从已发布数据加载，
 *   调用方不可直接传入——满足"不能传入未发布参数"与禁止硬编码。
 * - 计算失败返回 valid=false + 字段级 errors，不抛业务异常、不吞错误信息。
 */

// ---------------------------------------------------------------- 公共

export const thermalCalcModeSchema = z.enum(["REFERENCE_TABLE", "EQUIVALENT", "LAYERED"]);
export const thermalRoundingModeSchema = z.enum(["HALF_UP", "HALF_EVEN", "TRUNCATE", "NONE"]);
export const thermalCompareFieldSchema = z.enum(["K_VALUE", "TOTAL_RESISTANCE"]);
export const thermalCompareOperatorSchema = z.enum(["LTE", "GTE"]);

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

const positiveNumber = () => z.coerce.number().positive().max(100000);

const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({ items: z.array(itemDto), total: z.number(), page: z.number(), pageSize: z.number() }),
  requestId: z.string()
});

/** 字段级错误（计算失败的原因清单，字段名定位到具体输入） */
export const thermalCalcFieldErrorSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string()
});

const evidenceDto = {
  evidenceSource: z.string().nullable().optional(),
  evidenceRef: z.string().nullable().optional(),
  evidenceLevel: thermalEvidenceLevelSchema.nullable().optional(),
  effectiveAt: z.date().nullable().optional(),
  expiresAt: z.date().nullable().optional()
};

const reviewDtoFull = {
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
  updatedById: z.string().uuid().nullable()
};

const timestampsDto = { createdAt: z.date(), updatedAt: z.date() };

// ---------------------------------------------------------------- 计算规则（版本化实体）

export const thermalCalcRuleCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  formulaVersion: z.string().trim().min(1).max(40),
  interiorSurfaceResistance: positiveNumber(),
  exteriorSurfaceResistance: positiveNumber(),
  precision: z.coerce.number().int().min(0).max(8).default(4),
  roundingMode: thermalRoundingModeSchema.default("HALF_UP"),
  compareField: thermalCompareFieldSchema.default("K_VALUE"),
  compareOperator: thermalCompareOperatorSchema.default("LTE"),
  includeNonProductLayers: z.boolean().default(true),
  includeSurfaceResistances: z.boolean().default(true),
  parameterCodes: z.object({
    equivalentConductivity: z.string().trim().min(1).max(80),
    correctionFactor: z.string().trim().min(1).max(80)
  }),
  paramSourcePriority: z.array(z.string().trim().min(1).max(40)).default([]),
  usage: z.string().trim().max(40).nullable().optional(),
  applicableScope: z.string().trim().max(4000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: thermalEvidenceLevelSchema.nullable().optional(),
  effectiveAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional()
});
export const thermalCalcRuleUpdateSchema = thermalCalcRuleCreateSchema.partial();

export const thermalCalcRuleDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  formulaVersion: z.string(),
  interiorSurfaceResistance: z.number(),
  exteriorSurfaceResistance: z.number(),
  precision: z.number(),
  roundingMode: thermalRoundingModeSchema,
  compareField: thermalCompareFieldSchema,
  compareOperator: thermalCompareOperatorSchema,
  includeNonProductLayers: z.boolean(),
  includeSurfaceResistances: z.boolean(),
  parameterCodes: z.object({ equivalentConductivity: z.string(), correctionFactor: z.string() }),
  paramSourcePriority: z.array(z.string()),
  usage: z.string().nullable(),
  applicableScope: z.string().nullable(),
  changeNote: z.string().nullable(),
  ...evidenceDto,
  ...reviewDtoFull,
  ...timestampsDto
});

export const thermalCalcRuleListQuerySchema = paginationQuerySchema.extend({
  status: thermalReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 地区标准限值（版本化实体）

export const thermalStandardLimitCreateSchema = z.object({
  regionCode: z.string().trim().min(1).max(40),
  regionName: z.string().trim().min(1).max(120),
  basisCode: z.string().trim().min(1).max(80),
  basisName: z.string().trim().min(1).max(160),
  clauseRef: z.string().trim().min(1).max(120),
  limitKValue: positiveNumber(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: thermalEvidenceLevelSchema.nullable().optional(),
  effectiveAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional()
});
export const thermalStandardLimitUpdateSchema = thermalStandardLimitCreateSchema.partial();

export const thermalStandardLimitDto = z.object({
  id: z.uuid(),
  regionCode: z.string(),
  version: z.number(),
  regionName: z.string(),
  basisCode: z.string(),
  basisName: z.string(),
  clauseRef: z.string(),
  limitKValue: z.number(),
  changeNote: z.string().nullable(),
  ...evidenceDto,
  ...reviewDtoFull,
  ...timestampsDto
});

export const thermalStandardLimitListQuerySchema = paginationQuerySchema.extend({
  status: thermalReviewStatusSchema.optional(),
  regionCode: z.string().trim().max(40).optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 计算请求 / 响应

/** 计算入参：只接受标识，数值参数全部由服务层从已发布数据加载 */
export const thermalCalcRequestSchema = z.object({
  mode: thermalCalcModeSchema,
  schemeId: z.uuid("构造方案 ID 格式不正确"),
  productSpecId: z.uuid("产品规格 ID 格式不正确"),
  thicknessMm: positiveNumber(),
  /** 标准限值地区编码（缺省不判定，compliant=null） */
  regionCode: z.string().trim().min(1).max(40).optional(),
  /** 指定规则编码（缺省取最新已发布规则） */
  ruleCode: z.string().trim().min(1).max(80).optional(),
  /** AI 端必填（项目归属校验）；B 端可选 */
  projectId: z.uuid("项目 ID 格式不正确").optional()
});

/** 计算记录 DTO（快照字段为 jsonb，只读透传） */
export const thermalCalcRecordDto = z.object({
  id: z.uuid(),
  requestId: z.string().nullable(),
  mode: thermalCalcModeSchema,
  projectId: z.string().uuid().nullable(),
  ruleId: z.string().uuid().nullable(),
  ruleVersion: z.number().nullable(),
  standardLimitId: z.string().uuid().nullable(),
  limitVersion: z.number().nullable(),
  input: z.record(z.string(), z.unknown()),
  layers: z.array(z.unknown()),
  parameters: z.array(z.unknown()),
  rule: z.record(z.string(), z.unknown()).nullable(),
  standard: z.record(z.string(), z.unknown()).nullable(),
  formulas: z.record(z.string(), z.unknown()),
  steps: z.array(z.unknown()),
  result: z.record(z.string(), z.unknown()),
  createdById: z.string().uuid().nullable(),
  createdAt: z.date()
});

export const thermalCalcRecordListQuerySchema = paginationQuerySchema.extend({
  mode: thermalCalcModeSchema.optional(),
  projectId: z.uuid("项目 ID 格式不正确").optional()
});

export { single, paginated };