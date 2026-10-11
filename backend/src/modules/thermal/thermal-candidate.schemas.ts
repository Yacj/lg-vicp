import { constraintMatchSchema, queryExclusionSchema, queryStateExtraFields } from "./thermal-query-state.js";
import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { THERMAL_LOOKUP_METRICS, THERMAL_LOOKUP_MODES } from "./thermal-lookup-mode.js";
import { thermalLookupFilterSchema, normalizedThermalLookupFilterSchema } from "./thermal-lookup.schemas.js";

/**
 * 候选方案查询与条件匹配 Zod Schema。
 * - 查询条件全部可选：条件不完整时返回宽泛候选 + 缺失条件标注，不伪造精确结论。
 * - thicknessMm（精确档）与 thicknessMin/Max（区间）互斥；区间允许单边（如厚度 ≥ 25mm）。
 * - neighborTolerance：相邻已发布规格容差档数（0=禁止相邻匹配，默认 1，范围 0-3）。
 * - 候选确认记录保存查询条件 + 用户确认的最终候选全快照（历史确认不随后台参数漂移）。
 */

// ---------------------------------------------------------------- 候选查询

/** 候选查询字段（单一事实源）：AI 端组合必填 projectId 时复用，避免对带 refine 的 schema 再 extend */
export const thermalCandidateQueryFields = {
  documentIds: z.array(z.uuid()).optional(), knowledgeVersionIds: z.array(z.uuid()).optional(),
  structureType: z.string().optional(),
  exclusions: z.array(queryExclusionSchema).optional(), preferences: queryStateExtraFields.preferences,
  filters: z.array(thermalLookupFilterSchema).min(1).max(12).optional().describe("多个热工指标条件全部同时满足（AND）；提供时优先于单指标及旧字段"),
  metric: z.enum(THERMAL_LOOKUP_METRICS).optional().describe("K 传热系数 / TOTAL_R 总热阻 / PRODUCT_R 产品层热阻"),
  targetValue: z.coerce.number().positive().max(100).optional(),
  mode: z.enum(THERMAL_LOOKUP_MODES).optional().describe("新指标查询默认 APPROX；上下限只是查表筛选，不等同规范合规"),
  tolerance: z.coerce.number().positive().max(100).optional().describe("后端按指标限制容差；EXACT 固定精度"),
  /** 地区编码：仅用于解析标准限值（合格判定维度），不过滤参考行 */
  regionCode: z.string().trim().min(1).max(40).optional(),
  /** 标准限值 ID：解析 limitKValue（未给 targetK 时作为 K 条件缺省阈值） */
  standardLimitId: z.uuid("标准限值 ID 格式不正确").optional(),
  /** 建筑类型：与参考集 buildingTypes 数组做包含匹配（未配置的集标注数据缺失） */
  buildingType: z.string().trim().min(1).max(80).optional(),
  /** 保温系统 ID：方案所属系统精确匹配 */
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
  schemeId: z.uuid("构造方案 ID 格式不正确").optional(),
  schemeCode: z.string().trim().min(1).max(80).optional(),
  productSpecId: z.uuid("产品规格 ID 格式不正确").optional(),
  catalogProductId: z.uuid("产品目录 ID 格式不正确").optional(),
  /** 基层材料：忽略空白/大小写的包含匹配（如「200mm钢筋混凝土」可命中「钢筋混凝土」） */
  substrateMaterial: z.string().trim().min(1).max(120).optional(),
  /** 基层厚度 mm：±0.5mm 相等匹配；方案未填厚度时标注缺失不排除 */
  substrateThickness: z.coerce.number().positive().max(2000).optional(),
  /** 产品类型（规格分类） */
  specClass: z.enum(["I", "II", "III"]).optional(),
  /** 精确标准厚度档 mm（与厚度区间互斥） */
  thicknessMm: z.coerce.number().positive().max(1000).optional(),
  /** 厚度区间下限 mm（允许单边，如 ≥ 25mm） */
  thicknessMin: z.coerce.number().positive().max(1000).optional(),
  /** 厚度区间上限 mm */
  thicknessMax: z.coerce.number().positive().max(1000).optional(),
  /** 目标 K 值：含义由 kMode 决定（缺省 MAX_LIMIT：参考行 kValue <= targetK） */
  targetK: z.coerce.number().positive().max(10).optional().describe("deprecated：请使用 metric=K + targetValue；兼容旧 API 默认上限"),
  /**
   * K 查询语义（缺省 MAX_LIMIT，兼容历史「K ≤ 目标」口径）：
   * - APPROX：「0.3 左右 / 接近 0.3 / 0.3 的方案有么」→ 容差窗口内按 |kValue - targetK| 升序；
   * - MAX_LIMIT：「K≤0.3 / 不超过 0.3 / 0.3 以内」→ 只保留 kValue <= targetK；
   * - MIN_LIMIT：「K≥0.3 / 不低于 0.3」→ 只保留 kValue >= targetK；
   * - EXACT：「K=0.303」→ 按数值精度近似相等。
   */
  kMode: z.enum(["APPROX", "MAX_LIMIT", "MIN_LIMIT", "EXACT"]).optional()
    .describe("APPROX 按 abs(K-target) 容差匹配；MAX_LIMIT 要求 K≤目标；MIN_LIMIT 要求 K≥目标；EXACT 按精度相等。默认 MAX_LIMIT"),
  /** K 容差（APPROX/EXACT 有效）；缺省使用后台集中配置的固定业务默认值，不由调用方随意放大 */
  kTolerance: z.coerce.number().positive().max(5).optional(),
  /** 目标总热阻 m²·K/W：参考行 totalThermalResistance >= targetResistance */
  targetResistance: z.coerce.number().positive().max(100).optional().describe("deprecated：请使用 metric=TOTAL_R + targetValue；旧字段仍默认下限"),
  /** 相邻已发布规格容差档数（0=禁止相邻匹配） */
  neighborTolerance: z.coerce.number().int().min(0).max(3).default(1),
  /** 项目日期（asOfDate）：标准限值生效窗按该时点判定，缺省当前时间 */
  asOfDate: z.coerce.date().optional()
} as const;

/** 候选查询约束（精确厚度与区间互斥、区间上下限有序）；B 端与 AI 端共用 */
export function withCandidateQueryRefines<T extends z.ZodObject<typeof thermalCandidateQueryFields>>(schema: T) {
  return schema
    .refine((q) => (q.metric === undefined) === (q.targetValue === undefined),
      { message: "metric 与 targetValue 必须同时提供", path: ["targetValue"] })
    .refine((q) => q.metric !== "K" || q.targetValue === undefined || q.targetValue <= 10,
      { message: "目标 K 不能超过 10", path: ["targetValue"] })
    .refine(
      (q) => !(q.thicknessMm !== undefined && (q.thicknessMin !== undefined || q.thicknessMax !== undefined)),
      { message: "thicknessMm 精确档与厚度区间互斥，只能提供一种", path: ["thicknessMm"] }
    )
    .refine(
      (q) => q.thicknessMin === undefined || q.thicknessMax === undefined || q.thicknessMin <= q.thicknessMax,
      { message: "厚度区间下限不能大于上限", path: ["thicknessMin"] }
    );
}

export const thermalCandidateQuerySchema = withCandidateQueryRefines(
  z.object(thermalCandidateQueryFields)
);

// ---------------------------------------------------------------- 候选响应

export const thermalCandidateDto = z.object({
  candidateId: z.uuid(),
  constraintMatch: constraintMatchSchema.optional(),
  structureType: z.string().optional(), regionCode: z.string().optional(), standardLimitId: z.string().optional(), sourceVersionId: z.string().nullable().optional(),
  matchType: z.enum(["EXACT", "NEIGHBOR"]),
  /** 相邻档位距离（NEIGHBOR 时有值） */
  neighborGap: z.number().int().nullable(),
  matchedConditions: z.array(z.string()),
  unmatchedConditions: z.array(z.string()),
  missingConditions: z.array(z.string()),
  /** 与解析出的标准限值比较（K 判定）；无限值时 null */
  compliant: z.boolean().nullable(),
  /** K 距离：APPROX/EXACT 为 abs(K-target)，MAX_LIMIT 为 target-K，MIN_LIMIT 为 K-target */
  ranking: z.object({
    metric: z.enum(THERMAL_LOOKUP_METRICS).optional(),
    metricGap: z.number().optional(),
    kGap: z.number().describe("APPROX/EXACT 为 abs(K-target)，MAX_LIMIT 为 target-K，MIN_LIMIT 为 K-target"),
    isClosestToTarget: z.boolean()
  }).optional(),
  scheme: z.object({
    id: z.uuid(),
    code: z.string(),
    version: z.number(),
    substrateMaterial: z.string(),
    substrateThickness: z.number().nullable(),
    atlasPage: z.string().nullable()
  }),
  system: z.object({ id: z.uuid(), code: z.string().nullable(), name: z.string().nullable() }),
  productSpec: z.object({ id: z.uuid(), specCode: z.string(), specVersion: z.number(), specClass: z.enum(["I", "II", "III"]).nullable() }),
  set: z.object({ id: z.uuid(), code: z.string(), version: z.number(), priority: z.number(), buildingTypes: z.array(z.string()) }),
  result: z.object({
    thicknessMm: z.number(),
    productThermalResistance: z.number(),
    totalThermalResistance: z.number(),
    kValue: z.number()
  }),
  sourceDocumentId: z.string().nullable().optional(),
  sourcePageId: z.string().nullable().optional(),
  sourcePageLabel: z.string().nullable().optional(),
  catalogProductId: z.uuid().nullable().optional(),
  evidence: z.object({ source: z.string(), ref: z.string() })
});

export const thermalLimitSnapshotDto = z.object({
  id: z.uuid(),
  regionCode: z.string(),
  regionName: z.string(),
  basisCode: z.string(),
  basisName: z.string(),
  clauseRef: z.string(),
  limitKValue: z.number(),
  version: z.number()
});

export const thermalCandidateQueryResponseSchema = z.object({
  filters: z.array(normalizedThermalLookupFilterSchema).optional(),
  requestedTolerance: z.number().optional(),
  effectiveTolerance: z.number().optional(),
  toleranceAdjusted: z.boolean().optional(),
  metric: z.enum(THERMAL_LOOKUP_METRICS).optional(),
  targetValue: z.number().nullable().optional(),
  tolerance: z.number().nullable().optional(),
  /** 计算来源：第一版仅图集查表（REFERENCE_TABLE），无结果不自动批量计算 */
  calculationSource: z.literal("REFERENCE_TABLE"),
  /** 实际生效的 K 查询语义（缺省 MAX_LIMIT）；用于前端/日志确认「近似」与「上限」未被混淆 */
  lookupMode: z.enum(["APPROX", "MAX_LIMIT", "MIN_LIMIT", "EXACT"]).optional(),
  /** 实际生效的 K 容差（APPROX/EXACT）；其余模式为 null */
  kTolerance: z.number().nullable().optional(),
  candidates: z.array(thermalCandidateDto),
  matchedCandidates: z.array(thermalCandidateDto).optional(),
  nearbyCandidates: z.array(thermalCandidateDto.extend({ status: z.literal("NOT_FULLY_MATCHED").optional() })).optional(),
  /** 查询提供了但全部数据缺失的条件（如所有方案未填基层厚度） */
  missingConditions: z.array(z.string()),
  notes: z.array(z.string()),
  /** 解析出的地区标准限值快照（未提供地区或无限值时 null） */
  limit: thermalLimitSnapshotDto.nullable(),
  /** 多标准并存时非空：同地区多份已发布且生效中的限值候选，须由用户选择（standardLimitId） */
  limitCandidates: z.array(thermalLimitSnapshotDto).nullable()
});

// ---------------------------------------------------------------- 候选确认记录

export const thermalCandidateSelectionCreateSchema = z.object({
  /** 查询条件快照（用户发起查询时提交的完整条件） */
  query: thermalCandidateQuerySchema,
  /** 用户确认的最终候选快照（query 响应中某个候选的完整对象） */
  candidate: thermalCandidateDto,
  /** 选择理由（报审是否必填待甲方确认，当前可选） */
  selectionReason: z.string().trim().max(4000).optional(),
  /** AI 端必填（项目归属校验）；B 端可选 */
  projectId: z.uuid("项目 ID 格式不正确").optional()
});

export const thermalCandidateSelectionDto = z.object({
  id: z.uuid(),
  requestId: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  query: z.record(z.string(), z.unknown()),
  candidate: z.record(z.string(), z.unknown()),
  selectionReason: z.string().nullable(),
  selectedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const thermalCandidateSelectionListQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确").optional()
});
