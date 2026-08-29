import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

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
  /** 地区编码：仅用于解析标准限值（合格判定维度），不过滤参考行 */
  regionCode: z.string().trim().min(1).max(40).optional(),
  /** 标准限值 ID：解析 limitKValue（未给 targetK 时作为 K 条件缺省阈值） */
  standardLimitId: z.uuid("标准限值 ID 格式不正确").optional(),
  /** 建筑类型：与参考集 buildingTypes 数组做包含匹配（未配置的集标注数据缺失） */
  buildingType: z.string().trim().min(1).max(80).optional(),
  /** 保温系统 ID：方案所属系统精确匹配 */
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
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
  /** 目标 K 值：参考行 kValue <= targetK */
  targetK: z.coerce.number().positive().max(10).optional(),
  /** 目标总热阻 m²·K/W：参考行 totalThermalResistance >= targetResistance */
  targetResistance: z.coerce.number().positive().max(100).optional(),
  /** 相邻已发布规格容差档数（0=禁止相邻匹配） */
  neighborTolerance: z.coerce.number().int().min(0).max(3).default(1),
  /** 项目日期（asOfDate）：标准限值生效窗按该时点判定，缺省当前时间 */
  asOfDate: z.coerce.date().optional()
} as const;

/** 候选查询约束（精确厚度与区间互斥、区间上下限有序）；B 端与 AI 端共用 */
export function withCandidateQueryRefines<T extends z.ZodObject<typeof thermalCandidateQueryFields>>(schema: T) {
  return schema
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
  matchType: z.enum(["EXACT", "NEIGHBOR"]),
  /** 相邻档位距离（NEIGHBOR 时有值） */
  neighborGap: z.number().int().nullable(),
  matchedConditions: z.array(z.string()),
  unmatchedConditions: z.array(z.string()),
  missingConditions: z.array(z.string()),
  /** 与解析出的标准限值比较（K 判定）；无限值时 null */
  compliant: z.boolean().nullable(),
  /** 目标 K 值排序信息（提供 targetK 时返回；kGap = targetK - kValue，isClosestToTarget 标记最接近目标的候选） */
  ranking: z.object({
    kGap: z.number(),
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
  productSpec: z.object({ id: z.uuid(), specCode: z.string(), specVersion: z.number(), specClass: z.enum(["I", "II", "III"]) }),
  set: z.object({ id: z.uuid(), code: z.string(), version: z.number(), priority: z.number(), buildingTypes: z.array(z.string()) }),
  result: z.object({
    thicknessMm: z.number(),
    productThermalResistance: z.number(),
    totalThermalResistance: z.number(),
    kValue: z.number()
  }),
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
  /** 计算来源：第一版仅图集查表（REFERENCE_TABLE），无结果不自动批量计算 */
  calculationSource: z.literal("REFERENCE_TABLE"),
  candidates: z.array(thermalCandidateDto),
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