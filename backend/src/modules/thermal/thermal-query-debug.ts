/**
 * 热工查询诊断快照（确定性、可测试、无 IO）。
 *
 * 目的只有一个：当用户说「查不到」时，工程侧能一眼看出**到底是哪个条件把候选挡掉了**，
 * 而不是只看到一个 matched=0。这里不改任何查询行为，只把已经算出来的中间状态整理成结构化快照。
 */
import { normalizeThermalLookupQuery, type ThermalLookupMode } from "./thermal-lookup-mode.js";
import { formatLookupThickness } from "./thermal-lookup-thickness.js";
import { entityFields, type ConstraintMatch, type ThermalQueryState } from "./thermal-query-state.js";
import type { QueryLifecycleMode } from "./thermal-query-lifecycle.js";

/** 被过滤候选的失败信息（来自 validateCandidateAgainstQueryState）。 */
export interface RejectedCandidateDebug {
  id: string;
  failed: string[];
  matched?: string[];
  /** 结构化拒绝原因（细化到 SYSTEM_FAMILY_MISMATCH 等，不再只有 not matched） */
  reasons?: RejectedReason[];
}

/**
 * 结构化拒绝原因：把 ConstraintMatch.failed 的字段名映射成可读、可断言的稳定原因码。
 * 只做映射，不改任何匹配行为。
 */
export type RejectedReason =
  | "SYSTEM_FAMILY_MISMATCH"
  | "SYSTEM_ID_MISMATCH"
  | "SCHEME_MISMATCH"
  | "PRODUCT_SPEC_MISMATCH"
  | "CATALOG_PRODUCT_MISMATCH"
  | "SPEC_CLASS_MISMATCH"
  | "METRIC_OUT_OF_RANGE"
  | "THICKNESS_MISMATCH"
  | "SUBSTRATE_MATERIAL_MISMATCH"
  | "SUBSTRATE_THICKNESS_MISMATCH"
  | "REGION_MISMATCH"
  | "STANDARD_MISMATCH"
  | "BUILDING_TYPE_MISMATCH"
  | "STRUCTURE_TYPE_MISMATCH"
  | "DOCUMENT_MISMATCH"
  | "EXCLUDED"
  | "UNRESOLVED_CONDITION"
  | "OTHER";

/** 失败字段名 → 稳定原因码。字段名来自 validateCandidateAgainstQueryState / matcher。 */
export function classifyRejection(field: string): RejectedReason {
  if (field === "systemIds") return "SYSTEM_FAMILY_MISMATCH";
  if (field === "systemId" || field === "systemHint") return "SYSTEM_ID_MISMATCH";
  if (field === "schemeId" || field === "schemeCode" || field === "scheme") return "SCHEME_MISMATCH";
  if (field === "productSpecId") return "PRODUCT_SPEC_MISMATCH";
  if (field === "catalogProductId") return "CATALOG_PRODUCT_MISMATCH";
  if (field === "specClass") return "SPEC_CLASS_MISMATCH";
  if (field.startsWith("metric:") || /^(?:K|TOTAL_R|PRODUCT_R)(?::\d+)?$/.test(field)
    || field === "targetValue" || field === "targetK" || field === "targetResistance") return "METRIC_OUT_OF_RANGE";
  if (field === "thicknessMm" || field === "thicknessMin" || field === "thicknessMax" || field === "thickness") return "THICKNESS_MISMATCH";
  if (field === "substrateMaterial") return "SUBSTRATE_MATERIAL_MISMATCH";
  if (field === "substrateThickness") return "SUBSTRATE_THICKNESS_MISMATCH";
  if (field === "regionCode") return "REGION_MISMATCH";
  if (field === "standardLimitId") return "STANDARD_MISMATCH";
  if (field === "buildingType") return "BUILDING_TYPE_MISMATCH";
  if (field === "structureType") return "STRUCTURE_TYPE_MISMATCH";
  if (field === "documentIds" || field === "knowledgeVersionIds") return "DOCUMENT_MISMATCH";
  if (field.startsWith("exclude:")) return "EXCLUDED";
  if (field.startsWith("unresolved:")) return "UNRESOLVED_CONDITION";
  return "OTHER";
}

export interface ThermalQueryDebugInput {
  query: ThermalQueryState;
  lifecycle?: QueryLifecycleMode | null;
  /** 正式命中条数（可能大于实际返回条数） */
  matchedCount?: number;
  /** 实际返回给回答的候选 ID */
  returnedCandidateIds?: string[];
  /** 未完全满足硬条件的候选（含失败条件） */
  nearby?: RejectedCandidateDebug[];
  /** 工具侧最终采用的 filters */
  toolFilters?: unknown;
  /** 原始用户输入（原话） */
  rawText?: string;
  /** 分阶段过滤计数：全量 → 体系 → 指标 → 厚度 → 全部硬条件（缺省则只输出总数） */
  stageCounts?: {
    beforeAll?: number | null;
    afterFamily?: number | null;
    afterMetric?: number | null;
    afterThickness?: number | null;
    afterAllHard?: number | null;
  };
}

export interface ThermalQueryDebugSnapshot {
  /** 原始用户输入 */
  rawText: string | null;
  lifecycle: QueryLifecycleMode | null;
  intent: string | null;
  thickness: string | null;
  /** 解析出的指标 → 查询语义 */
  queryModes: Array<{ metric: string; mode: ThermalLookupMode; targetValue: number; tolerance: number | null }>;
  /** 硬条件实体（systemId / schemeId / 建筑类型 …） */
  entities: Record<string, string | string[]>;
  /** 体系族 / 类别提示（如「薄抹灰」解析成多条 systemIds） */
  familyHints: string[];
  hardConstraints: Array<{ field: string; value: string | string[] }>;
  softPreferences: Record<string, unknown>;
  toolFilters: unknown;
  counts: { matched: number; nearby: number; returned: number };
  /** 分阶段过滤计数：看 N 在哪一步掉到 0 */
  stageCounts: {
    beforeAll: number | null;
    afterFamily: number | null;
    afterMetric: number | null;
    afterThickness: number | null;
    afterAllHard: number | null;
  };
  rejected: RejectedCandidateDebug[];
  /** 命中候选中各候选的被拒原因归类计数（便于定位主要杀手条件） */
  rejectedByReason: Array<{ reason: RejectedReason; count: number }>;
  unresolved: Array<{ field: string; reason: string }>;
  /**
   * matched = 0 但 nearby > 0 时，按「差得最少」排序的失败条件，
   * 用于回答「明明有接近的，为什么不算命中」。
   */
  nearestFailure: RejectedCandidateDebug[];
}

function pickEntities(query: ThermalQueryState) {
  const entities: Record<string, string | string[]> = {};
  for (const field of entityFields) {
    const value = query[field];
    if (value !== undefined && value !== null && value !== "") entities[field] = value as string;
  }
  if (query.systemIds?.length) entities.systemIds = [...query.systemIds];
  for (const field of ["thicknessMm", "thicknessMin", "thicknessMax", "substrateThickness", "preferThinner"] as const) {
    const value = query[field];
    if (value !== undefined && value !== null) entities[field] = String(value);
  }
  return entities;
}

export function buildThermalQueryDebug(input: ThermalQueryDebugInput): ThermalQueryDebugSnapshot {
  const { query } = input;
  const lookup = normalizeThermalLookupQuery(query);
  const nearby = input.nearby ?? [];
  const matchedCount = input.matchedCount ?? input.returnedCandidateIds?.length ?? 0;
  const returned = input.returnedCandidateIds?.length ?? 0;
  // 失败条件越少说明越接近命中；稳定排序便于对比。
  const nearestFailure = matchedCount === 0 && nearby.length > 0
    ? [...nearby].sort((a, b) => a.failed.length - b.failed.length).slice(0, 5)
    : [];
  return {
    rawText: input.rawText ?? null,
    lifecycle: input.lifecycle ?? null,
    intent: query.intent ?? null,
    thickness: formatLookupThickness(query) ?? null,
    queryModes: lookup.filters.map(filter => ({ metric: filter.metric, mode: filter.mode,
      targetValue: filter.targetValue, tolerance: filter.effectiveTolerance ?? filter.tolerance ?? null })),
    entities: pickEntities(query),
    familyHints: [...new Set([
      query.systemHint ?? "",
      ...(query.systemIds ?? []),
      ...(query.preferences?.entities ?? []).filter(item => item.field === "systemId").map(item => item.value)
    ].filter(Boolean))],
    hardConstraints: [
      ...(query.systemIds?.length ? [{ field: "systemIds", value: [...query.systemIds] }] : []),
      ...lookup.filters.map(filter => ({ field: `metric:${filter.metric}`, value: `${filter.mode} ${filter.targetValue}` })),
      ...(query.thicknessMm != null ? [{ field: "thicknessMm", value: String(query.thicknessMm) }] : []),
      ...(query.thicknessMin != null ? [{ field: "thicknessMin", value: String(query.thicknessMin) }] : []),
      ...(query.thicknessMax != null ? [{ field: "thicknessMax", value: String(query.thicknessMax) }] : [])
    ],
    softPreferences: { ...(query.preferences ?? {}) },
    toolFilters: input.toolFilters,
    counts: { matched: matchedCount, nearby: nearby.length, returned },
    stageCounts: {
      beforeAll: input.stageCounts?.beforeAll ?? null,
      afterFamily: input.stageCounts?.afterFamily ?? null,
      afterMetric: input.stageCounts?.afterMetric ?? null,
      afterThickness: input.stageCounts?.afterThickness ?? null,
      afterAllHard: input.stageCounts?.afterAllHard ?? null
    },
    rejected: nearby,
    rejectedByReason: [...nearby.reduce((acc, item) => {
      for (const reason of item.reasons ?? item.failed.map(classifyRejection)) acc.set(reason, (acc.get(reason) ?? 0) + 1);
      return acc;
    }, new Map<RejectedReason, number>())].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    unresolved: (query.unresolved ?? []).map(item => ({ field: item.field, reason: item.reason })),
    nearestFailure
  };
}

/** 单行摘要（日志用），把最关键的信息压缩到一行。 */
export function summarizeThermalQueryDebug(snapshot: ThermalQueryDebugSnapshot): string {
  const modes = snapshot.queryModes.map(item => `${item.metric}${item.mode === "MAX_LIMIT" ? "<=" : item.mode === "MIN_LIMIT" ? ">=" : item.mode === "EXACT" ? "=" : "~"}${item.targetValue}`).join(",") || "-";
  const blocked = snapshot.nearestFailure.length
    ? snapshot.nearestFailure.map(item => `${item.id}:${item.failed.join("+")}`).join(" ")
    : "-";
  return [
    `lifecycle=${snapshot.lifecycle ?? "-"}`,
    `metric=${modes}`,
    `entity=${JSON.stringify(snapshot.entities)}`,
    `thickness=${snapshot.thickness ?? "-"}`,
    `matched=${snapshot.counts.matched}`,
    `nearby=${snapshot.counts.nearby}`,
    `unresolved=${snapshot.unresolved.map(item => item.field).join("|") || "-"}`,
    `blockedBy=${blocked}`
  ].join(" ");
}

/** 供测试/调试把 ConstraintMatch 转成快照需要的形状。 */
export function toRejectedCandidateDebug(id: string, match: ConstraintMatch): RejectedCandidateDebug {
  return { id, failed: [...match.failed], matched: [...match.matched],
    reasons: [...new Set(match.failed.map(classifyRejection))] };
}

/**
 * 输出诊断日志。宿主 logger 可能只有部分级别（测试替身），这里全部按可选调用，
 * 诊断失败绝不能影响查询主流程。
 */
export function logThermalQueryDebug(
  logger: { debug?: (payload: object, message: string) => void; warn?: (payload: object, message: string) => void } | undefined,
  snapshot: ThermalQueryDebugSnapshot
): void {
  logger?.debug?.({ thermalQueryDebug: snapshot }, "热工查询诊断");
  if (snapshot.counts.matched === 0 && snapshot.counts.nearby > 0) {
    logger?.warn?.({ thermalQueryDebug: summarizeThermalQueryDebug(snapshot) }, "热工查询无正式命中但存在接近候选");
  }
}
