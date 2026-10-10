import { z } from "zod";
import { normalizedThermalLookupFilterSchema } from "./thermal-lookup.schemas.js";
import { getCandidateMetricValue, matchesMetric, normalizeThermalLookupQuery } from "./thermal-lookup-mode.js";

export const constraintSourceSchema = z.enum(["USER_EXPLICIT", "CONTEXT_INHERITED", "SYSTEM_DERIVED"]);
export const entityFields = ["systemId", "systemHint", "schemeId", "schemeCode", "productSpecId", "catalogProductId", "specClass", "substrateMaterial", "buildingType", "structureType", "regionCode", "standardLimitId"] as const;
export const queryExclusionSchema = z.object({ field: z.enum(entityFields), value: z.string().min(1) });
export const conditionTraceSchema = z.object({
  field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]),
  mode: z.string().optional(), source: constraintSourceSchema,
  classification: z.enum(["HARD_CONSTRAINT", "SOFT_PREFERENCE", "AMBIGUOUS"])
});
export const queryStateExtraFields = {
  substrateMaterial: z.string().optional(), substrateThickness: z.number().positive().optional(),
  regionCode: z.string().optional(), standardLimitId: z.string().optional(), buildingType: z.string().optional(), structureType: z.string().optional(),
  documentIds: z.array(z.string()).optional(), knowledgeVersionIds: z.array(z.string()).optional(),
  /** 体系族/类别命中（如「薄抹灰」）：同族多条记录时作为集合硬约束，不是唯一 systemId。 */
  systemIds: z.array(z.string()).optional(),
  exclusions: z.array(queryExclusionSchema).optional(), removedFields: z.array(z.enum(entityFields)).optional(), removedMetrics: z.array(z.enum(["K", "TOTAL_R", "PRODUCT_R"])).optional(),
  preferences: z.object({ preferLowerK: z.boolean().optional(), preferHigherR: z.boolean().optional(),
    preferThinner: z.boolean().optional(), preferThicker: z.boolean().optional(), higherRMetric: z.enum(["TOTAL_R", "PRODUCT_R"]).optional(),
    entities: z.array(z.object({ field: z.enum(entityFields), value: z.string() })).optional() }).optional(),
  unresolved: z.array(z.object({ field: z.string(), reason: z.string() })).optional(),
  conditionTrace: z.array(conditionTraceSchema).optional()
};

/** 沿用已有字段名和 filters；此 JSON 是会话查询的唯一真源。 */
export const thermalQueryStateSchema = z.object({
  intent: z.enum(["REFERENCE_LOOKUP", "THERMAL", "COMPLIANCE", "COMPARISON"]).optional(),
  filters: z.array(normalizedThermalLookupFilterSchema).optional(),
  metric: z.enum(["K", "TOTAL_R", "PRODUCT_R"]).optional(), targetValue: z.number().optional(),
  targetK: z.number().optional(), targetR: z.number().optional(),
  mode: z.enum(["EXACT", "APPROX", "MAX_LIMIT", "MIN_LIMIT"]).optional(),
  tolerance: z.number().optional(), toleranceSource: z.enum(["USER", "DEFAULT"]).optional(),
  requestedTolerance: z.number().optional(), effectiveTolerance: z.number().optional(), toleranceAdjusted: z.boolean().optional(),
  systemId: z.string().optional(), systemHint: z.string().optional(), schemeId: z.string().optional(), schemeCode: z.string().optional(),
  productSpecId: z.string().optional(), catalogProductId: z.string().optional(), specClass: z.enum(["I", "II", "III"]).optional(),
  thicknessMm: z.number().optional(), thicknessMin: z.number().optional(), thicknessMax: z.number().optional(), preferThinner: z.boolean().optional(),
  ...queryStateExtraFields
});
export type ThermalQueryState = z.infer<typeof thermalQueryStateSchema>;
export const constraintMatchSchema = z.object({ passed: z.boolean(), matched: z.array(z.string()), failed: z.array(z.string()) });
export type ConstraintMatch = z.infer<typeof constraintMatchSchema>;

export interface ConstraintCandidate {
  systemId?: string; systemName?: string; schemeId?: string; schemeCode?: string; productSpecId?: string;
  catalogProductId?: string | null; specClass?: string; substrateMaterial?: string; substrateThickness?: number | null;
  structureType?: string; setBuildingTypes?: string[]; thicknessMm?: number; kValue?: number; productThermalResistance?: number; totalThermalResistance?: number;
  sourceDocumentId?: string | null; sourceVersionId?: string | null; regionCode?: string; standardLimitId?: string;
}
export const normalizeEntityText = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function normalizeSystemName(value: string) {
  return normalizeEntityText(value).replace(/iii型|三型|3型/g, "3型").replace(/ii型|二型|2型/g, "2型").replace(/i型|一型|1型/g, "1型").replace(/vicp|vlcp/g, "").replace(/外墙外保温|外墙保温|外保温|保温|系统|体系/g, "");
}
/** 体系族名：去掉 I/II/III 型前缀后的名称片段（如「I型 VICP薄抹灰外保温系统」→「薄抹灰」）。 */
export function normalizeSystemFamily(value: string) {
  return normalizeSystemName(value).replace(/^(?:iii|ii|i|[123一二三])型/i, "").trim();
}
const sameText = (a: string | undefined | null, b: string) => !!a && normalizeEntityText(a) === normalizeEntityText(b);

/** 缺数据也不能证明满足硬条件；所有正式候选和历史复用均调用此函数。 */
export function validateCandidateAgainstQueryState(candidate: ConstraintCandidate, query: ThermalQueryState): ConstraintMatch {
  const matched: string[] = [], failed: string[] = [];
  const check = (field: string, passed: boolean) => (passed ? matched : failed).push(field);
  for (const field of entityFields) {
    const value = query[field];
    if (value === undefined) continue;
    if (field === "systemHint") check(field, !!candidate.systemName && !!normalizeSystemName(value) && normalizeSystemName(candidate.systemName).includes(normalizeSystemName(value)));
    else if (field === "buildingType") check(field, !!candidate.setBuildingTypes?.some(name => sameText(name, value)));
    else if (field === "substrateMaterial") check(field, !!candidate.substrateMaterial && normalizeEntityText(candidate.substrateMaterial).replace(/^\d+(?:\.\d+)?(?:mm|毫米)/, "") === normalizeEntityText(value).replace(/^\d+(?:\.\d+)?(?:mm|毫米)/, ""));
    else check(field, candidate[field] === value);
  }
  for (const [field, test] of [
    ["thicknessMm", (value: number) => candidate.thicknessMm === value],
    ["thicknessMin", (value: number) => candidate.thicknessMm != null && candidate.thicknessMm >= value],
    ["thicknessMax", (value: number) => candidate.thicknessMm != null && candidate.thicknessMm <= value],
    ["substrateThickness", (value: number) => candidate.substrateThickness != null && Math.abs(candidate.substrateThickness - value) <= 0.5]
  ] as const) if (query[field] !== undefined) check(field, test(query[field]!));
  // 体系族/类别命中：候选必须属于该集合，仍然是硬约束，只是不唯一。
  if (query.systemIds) check("systemIds", !!candidate.systemId && query.systemIds.includes(candidate.systemId));
  for (const [index, filter] of normalizeThermalLookupQuery(query).filters.entries())
    check(`${filter.metric}:${index}`, matchesMetric(getCandidateMetricValue(candidate, filter.metric), filter.targetValue, filter.mode, filter.tolerance));
  if (query.documentIds) check("documentIds", !!candidate.sourceDocumentId && query.documentIds.includes(candidate.sourceDocumentId));
  if (query.knowledgeVersionIds) check("knowledgeVersionIds", !!candidate.sourceVersionId && query.knowledgeVersionIds.includes(candidate.sourceVersionId));
  for (const exclusion of query.exclusions ?? []) {
    const excluded = exclusion.field === "systemHint" ? candidate.systemName : exclusion.field === "buildingType" ? candidate.setBuildingTypes?.join(" ") : candidate[exclusion.field];
    check(`exclude:${exclusion.field}`, !!excluded && !normalizeEntityText(excluded).includes(normalizeEntityText(exclusion.value)));
  }
  for (const ambiguity of query.unresolved ?? []) check(`unresolved:${ambiguity.field}`, false);
  return { passed: failed.length === 0, matched, failed };
}

export function traceQueryState(query: ThermalQueryState, previous?: ThermalQueryState): ThermalQueryState {
  const unresolved = (query.unresolved ?? []).filter(item => !item.field.startsWith("conflict:"));
  const addConflict = (field: string) => unresolved.push({ field: `conflict:${field}`, reason: "同一指标或厚度的边界互相冲突，请确认要保留或替换的条件。" });
  if (query.thicknessMin != null && query.thicknessMax != null && query.thicknessMin > query.thicknessMax
    || query.thicknessMm != null && (query.thicknessMin != null && query.thicknessMm < query.thicknessMin || query.thicknessMax != null && query.thicknessMm > query.thicknessMax)) addConflict("thickness");
  for (const metric of ["K", "PRODUCT_R", "TOTAL_R"] as const) {
    let lower = -Infinity, upper = Infinity;
    for (const filter of normalizeThermalLookupQuery(query).filters.filter(item => item.metric === metric)) {
      if (filter.mode === "MIN_LIMIT") lower = Math.max(lower, filter.targetValue);
      else if (filter.mode === "MAX_LIMIT") upper = Math.min(upper, filter.targetValue);
      else { lower = Math.max(lower, filter.targetValue - (filter.tolerance ?? 0)); upper = Math.min(upper, filter.targetValue + (filter.tolerance ?? 0)); }
    }
    if (lower > upper) addConflict(metric);
  }
  query = { ...query, unresolved };
  const conditionTrace: ThermalQueryState["conditionTrace"] = [];
  const add = (field: string, value: string | number | boolean, classification: "HARD_CONSTRAINT" | "SOFT_PREFERENCE", mode?: string) => {
    const old = previous?.conditionTrace?.find(item => item.field === field && item.value === value && item.mode === mode);
    conditionTrace.push({ field, value, mode, classification, source: old ? "CONTEXT_INHERITED" : "USER_EXPLICIT" });
  };
  for (const field of [...entityFields, "substrateThickness", "thicknessMm", "thicknessMin", "thicknessMax"] as const)
    if (query[field] !== undefined) add(field, query[field]!, "HARD_CONSTRAINT");
  for (const id of query.systemIds ?? []) add("systemIds", id, "HARD_CONSTRAINT");
  for (const filter of query.filters ?? []) add(filter.metric, filter.targetValue, "HARD_CONSTRAINT", filter.mode);
  for (const field of ["documentIds", "knowledgeVersionIds"] as const) for (const value of query[field] ?? []) add(field, value, "HARD_CONSTRAINT");
  for (const ambiguity of query.unresolved ?? []) conditionTrace.push({ field: ambiguity.field, value: ambiguity.reason, source: "USER_EXPLICIT", classification: "AMBIGUOUS" });
  if (query.preferThinner) add("preferThinner", true, "SOFT_PREFERENCE");
  for (const [field, value] of Object.entries(query.preferences ?? {})) if (typeof value === "boolean" && value) add(field, value, "SOFT_PREFERENCE");
  if (query.preferences?.higherRMetric) add("higherRMetric", query.preferences.higherRMetric, "SOFT_PREFERENCE");
  for (const entity of query.preferences?.entities ?? []) add(`prefer:${entity.field}`, entity.value, "SOFT_PREFERENCE");
  for (const exclusion of query.exclusions ?? []) add(`exclude:${exclusion.field}`, exclusion.value, "HARD_CONSTRAINT");
  return thermalQueryStateSchema.parse({ ...query, conditionTrace });
}

export function rankByPreferences<T extends ConstraintCandidate>(candidates: T[], query: ThermalQueryState): T[] {
  const p = query.preferences;
  const rMetric = p?.higherRMetric ?? (query.metric === "PRODUCT_R" ? "PRODUCT_R" : "TOTAL_R");
  const entityScore = (candidate: T) => (p?.entities ?? []).filter(entity =>
    entity.field === "systemHint" ? candidate.systemName && normalizeSystemName(candidate.systemName).includes(normalizeSystemName(entity.value))
      : entity.field === "buildingType" ? candidate.setBuildingTypes?.includes(entity.value) : candidate[entity.field] === entity.value).length;
  return [...candidates].sort((a, b) => entityScore(b) - entityScore(a)
    || (query.preferThinner || p?.preferThinner ? (a.thicknessMm ?? Infinity) - (b.thicknessMm ?? Infinity) : 0)
    || (p?.preferThicker ? (b.thicknessMm ?? -Infinity) - (a.thicknessMm ?? -Infinity) : 0)
    || (p?.preferLowerK ? (a.kValue ?? Infinity) - (b.kValue ?? Infinity) : 0)
    || (p?.preferHigherR ? (getCandidateMetricValue(b, rMetric) ?? -Infinity) - (getCandidateMetricValue(a, rMetric) ?? -Infinity) : 0));
}
