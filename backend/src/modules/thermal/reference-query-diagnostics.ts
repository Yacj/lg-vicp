import { getCandidateMetricValue, normalizeThermalLookupQuery, THERMAL_METRIC_LABELS, type ThermalLookupMetric } from "./thermal-lookup-mode.js";
import { validateCandidateAgainstQueryState, type ConstraintCandidate, type ThermalQueryState } from "./thermal-query-state.js";

export type ReferenceQueryIssue = "QUERY_UNRESOLVED" | "CONDITIONS_CONFLICT" | "NO_READABLE_PUBLISHED_DATA"
  | "IDENTITY_NOT_FOUND" | "METRIC_NOT_PROVIDED" | "METRIC_SCOPE_DIFFERENT" | "NO_MATCHING_VALUE" | "SOURCE_NOT_VERIFIABLE";
export interface ReferenceMetricScope {
  metric: ThermalLookupMetric; values: number[]; count: number; rowCount?: number; truncated?: boolean;
}
export interface ReferenceQueryDiagnostics {
  scope: "THERMAL_ROW" | "KNOWLEDGE_PAGE" | "JOINT";
  issues: ReferenceQueryIssue[];
  scannedCount: number; identityCount: number; matchedCount: number;
  missingMetrics: ThermalLookupMetric[]; metricScopes: ReferenceMetricScope[];
  partialMissingMetrics?: Array<{ metric: ThermalLookupMetric; missingRows: number; totalRows: number }>;
  /** 这里只描述实际读取的已授权范围，不探测或披露不可见资料。 */
  coverage: "AUTHORIZED_PUBLISHED_ONLY" | "AUTHORIZED_VERSION_ONLY";
  rejectedSourceCount?: number;
}
export function withoutReferenceMetrics(query: ThermalQueryState): ThermalQueryState {
  return { ...query, filters: [], metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined };
}
/** 仅校验结构化字段；不解析自然语言、不调整容差、不改变正式匹配结果。 */
export function diagnoseReferenceQuery(query: ThermalQueryState, rows: readonly ConstraintCandidate[], scope: ReferenceQueryDiagnostics["scope"],
  coverage: ReferenceQueryDiagnostics["coverage"] = "AUTHORIZED_PUBLISHED_ONLY"): ReferenceQueryDiagnostics {
  const filters = normalizeThermalLookupQuery(query).filters;
  const identity = rows.filter(row => validateCandidateAgainstQueryState(row, withoutReferenceMetrics(query)).passed);
  const matchedCount = rows.filter(row => validateCandidateAgainstQueryState(row, query).passed
    && filters.every(filter => getCandidateMetricValue(row, filter.metric) != null)).length;
  const missingMetrics = [...new Set(filters.map(filter => filter.metric))].filter(metric => identity.length > 0
    && identity.every(row => getCandidateMetricValue(row, metric) == null));
  const partialMissingMetrics = [...new Set(filters.map(filter => filter.metric))].flatMap(metric => {
    const missingRows = identity.filter(row => getCandidateMetricValue(row, metric) == null).length;
    return missingRows > 0 && missingRows < identity.length ? [{ metric, missingRows, totalRows: identity.length }] : [];
  });
  const metricScopes = [...new Set(filters.map(filter => filter.metric))].flatMap(metric => {
    // 解释某指标时只移除该指标，所有其他指标、型号、基层、厚度和资料限制仍生效。
    const other = { ...withoutReferenceMetrics(query), filters: filters.filter(filter => filter.metric !== metric) };
    const selected = identity.filter(row => validateCandidateAgainstQueryState(row, other).passed);
    const values = [...new Set(selected.flatMap(row => { const value = getCandidateMetricValue(row, metric);
      return value != null && Number.isFinite(value) ? [value] : []; }))].sort((a, b) => a - b);
    return values.length ? [{ metric, values: values.slice(0, 8), count: values.length,
      rowCount: selected.filter(row => getCandidateMetricValue(row, metric) != null).length, truncated: values.length > 8 }] : [];
  });
  const issues: ReferenceQueryIssue[] = query.unresolved?.length
    ? [query.unresolved.some(item => item.field.startsWith("conflict:")) ? "CONDITIONS_CONFLICT" : "QUERY_UNRESOLVED"]
    : !rows.length ? ["NO_READABLE_PUBLISHED_DATA"] : !identity.length ? ["IDENTITY_NOT_FOUND"]
    : missingMetrics.length ? ["METRIC_NOT_PROVIDED"] : !matchedCount ? ["NO_MATCHING_VALUE"] : [];
  return { scope, issues, scannedCount: rows.length, identityCount: identity.length, matchedCount, missingMetrics, metricScopes, partialMissingMetrics, coverage };
}
/** 失败原因只由Service诊断生成；不能从无命中推断未发布或无权资料是否存在。 */
export function renderReferenceQueryDiagnostics(d: ReferenceQueryDiagnostics): string {
  const label = d.scope === "THERMAL_ROW" ? "正式热工参考集" : d.scope === "KNOWLEDGE_PAGE" ? "已确认资料" : "本次联合读取的正式参考数据和已确认资料";
  const lines: string[] = [];
  for (const issue of d.issues) {
    if (issue === "QUERY_UNRESOLVED") lines.push("体系、指标或查询条件尚未得到可靠确认，请先补充不明确的条件。");
    if (issue === "CONDITIONS_CONFLICT") lines.push("多个筛选条件的边界互相冲突，请确认要保留或替换的条件。");
    if (issue === "NO_READABLE_PUBLISHED_DATA") lines.push(`${label}在本次可读范围内未找到可核验数据，不能据此断言其他资料也没有。`);
    if (issue === "IDENTITY_NOT_FOUND") lines.push(`${label}中没有同时符合当前体系、型号、基层、厚度及来源限制的记录，尚不能按该身份判断目标值。`);
    if (issue === "METRIC_NOT_PROVIDED") lines.push(`${label}在当前身份和厚度范围内未单独提供${d.missingMetrics.map(metric => THERMAL_METRIC_LABELS[metric]).join("、")}，无法按该指标筛选；这不等于有该指标但没有满足条件的档位。`);
    if (issue === "METRIC_SCOPE_DIFFERENT") lines.push("来源中的材料层或芯材热阻与完整产品热阻是不同指标，不能相互替代或补算。");
    if (issue === "NO_MATCHING_VALUE") lines.push(`${label}中有当前身份的数据，但未找到同时满足所述目标值及其他筛选条件的档位。`);
    if (issue === "SOURCE_NOT_VERIFIABLE") lines.push("部分参考行未能绑定当前有效确认档位，已排除；不能沿用旧引用或把它们当作正式候选。");
  }
  if (!d.matchedCount) for (const s of d.metricScopes) lines.push(`保留其余筛选条件后，${THERMAL_METRIC_LABELS[s.metric]}可核验取值${s.truncated ? `共 ${s.count} 种，本次仅列前 ${s.values.length} 种` : "为"}：${s.values.join("、")}。这些是范围内取值，未作为命中。`);
  for (const item of d.partialMissingMetrics ?? []) lines.push(`当前身份范围部分记录未单独提供${THERMAL_METRIC_LABELS[item.metric]}，结果只覆盖提供该指标的记录，不代表全部构造。`);
  lines.push(d.coverage === "AUTHORIZED_VERSION_ONLY" ? "本次仅覆盖当前授权版本的确认记录，缺失列及其他版本未补入。"
    : "本次仅覆盖有权访问、已发布且生效的确认数据；未发布、不可访问及未确认资料不在本次范围内。");
  return lines.join("\n");
}
