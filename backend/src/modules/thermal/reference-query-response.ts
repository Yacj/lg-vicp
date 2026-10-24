import { normalizeThermalLookupQuery, type ThermalLookupMetric } from "./thermal-lookup-mode.js";
import type { ReferenceQueryDiagnostics, ReferenceQueryIssue } from "./reference-query-diagnostics.js";
import type { ThermalQueryState } from "./thermal-query-state.js";

const labels: Record<ThermalLookupMetric, string> = {
  PRODUCT_R: "保温板自身热阻", TOTAL_R: "整构造总热阻", K: "传热系数 K"
};
/** 客服表达只消费查询结论；诊断取值、命中计数和权限细节仍完整留在审计合同中。 */
export function referenceQueryReplyFacts(d: ReferenceQueryDiagnostics, query: ThermalQueryState) {
  const priority: ReferenceQueryIssue[] = ["CONDITIONS_CONFLICT", "QUERY_UNRESOLVED", "NO_READABLE_PUBLISHED_DATA",
    "IDENTITY_NOT_FOUND", "METRIC_NOT_PROVIDED", "NO_MATCHING_VALUE", "SOURCE_NOT_VERIFIABLE", "METRIC_SCOPE_DIFFERENT"];
  const reason = priority.find(issue => d.issues.includes(issue));
  const identity = [query.systemHint, query.specClass && `${query.specClass}型`, query.schemeCode,
    query.substrateMaterial, query.substrateThickness == null ? undefined : `基层${query.substrateThickness}mm`,
    query.thicknessMm == null ? undefined : `板厚${query.thicknessMm}mm`, query.pageLabel,
    query.thicknessMin == null ? undefined : `板厚${query.thicknessMinExclusive ? "严格大于" : "不小于"}${query.thicknessMin}mm`,
    query.thicknessMax == null ? undefined : `板厚${query.thicknessMaxExclusive ? "严格小于" : "不大于"}${query.thicknessMax}mm`]
    .filter((value): value is string => Boolean(value));
  return {
    reason, limitedToCurrentDocuments: true as const, matchedCount: d.matchedCount,
    identity, specifiedSourceScope: Boolean(query.documentIds?.length || query.knowledgeVersionIds?.length || query.referenceSetIds?.length),
    // 名称角色是Backend已核验字段，不能在自然表达时退化成无类型字符串后重新猜类别。
    identityDetails: [
      { role: "SYSTEM", label: "体系名称", value: query.systemHint },
      { role: "SPEC_CLASS", label: "型号", value: query.specClass },
      { role: "CONSTRUCTION", label: "构造编号", value: query.schemeCode },
      { role: "SUBSTRATE", label: "基层材料", value: query.substrateMaterial }
    ].filter((item): item is { role: string; label: string; value: string } => Boolean(item.value)),
    requested: normalizeThermalLookupQuery(query).filters.map(filter => ({ metric: filter.metric, label: labels[filter.metric],
      target: filter.targetValue, operator: filter.mode, unit: filter.metric === "K" ? "W/(m²·K)" : "m²·K/W" })),
    missingMetrics: d.missingMetrics.map(metric => ({ metric, label: labels[metric] })),
    incompleteMetricCoverage: Boolean(d.partialMissingMetrics?.length),
    layerIsNotWholeProduct: d.issues.includes("METRIC_SCOPE_DIFFERENT"),
    excludedSources: Boolean(d.rejectedSourceCount || d.bindingGapCount || d.unreadableSourceCount),
    // 只建议只读帮助，不执行改条件、计算、选方案或报告。
    nextSteps: reason === "IDENTITY_NOT_FOUND" ? ["CHECK_NAME"]
      : reason === "CONDITIONS_CONFLICT" || reason === "QUERY_UNRESOLVED" ? ["CLARIFY_CONDITION"]
      : reason === "NO_MATCHING_VALUE" && Boolean(query.schemeCode || query.schemeId || query.productSpecId || query.catalogProductId) ? ["REVISE_QUERY"]
      : ["CHECK_PRODUCT_DETAILS", "REVISE_QUERY"]
  };
}
export type ReferenceQueryReplyFacts = ReturnType<typeof referenceQueryReplyFacts>;

/** 模型不可用时仍按真实原因与本轮条件简短回答，不把内部诊断整段推给用户。 */
export function renderReferenceQueryResponse(d: ReferenceQueryDiagnostics, query: ThermalQueryState): string {
  const facts = referenceQueryReplyFacts(d, query);
  const conditions = facts.requested.map(item => `${item.label}${item.operator === "LT" ? "严格小于" : item.operator === "GT" ? "严格大于" : item.operator === "APPROX" ? "接近" : item.operator === "MAX_LIMIT" ? "不高于"
    : item.operator === "MIN_LIMIT" ? "不低于" : "为"} ${item.target} ${item.unit}`).join("、");
  const scope = facts.identity.length ? `在${facts.identity.join("、")}这些条件下，` : "";
  switch (facts.reason) {
    case "NO_MATCHING_VALUE": return `${scope}目前资料里暂没查到${conditions || "符合这些条件"}的记录。${facts.incompleteMetricCoverage ? "有些表格没有单列这个参数，暂时无法一并核对。" : ""}\n${facts.nextSteps.includes("CHECK_PRODUCT_DETAILS") ? "如果有具体板材名称或厚度，我可以继续帮你核对。" : "需要的话，我可以帮你调整筛选条件后再查。"}`;
    case "IDENTITY_NOT_FOUND": return `资料里暂时没对应上${facts.identity.length ? `“${facts.identity.join("、")}”` : "你说的名称或来源"}。可以说一下具体产品或体系名称吗？${conditions ? `你给出的${conditions}条件会保留。` : ""}`;
    case "METRIC_NOT_PROVIDED": return `${scope}这部分资料没有单独记录${facts.missingMetrics.map(item => item.label).join("、")}，暂时不能按这一项筛选。${facts.layerIsNotWholeProduct ? "材料层或芯材的热阻，不能代替整块保温板的热阻。" : ""}\n可以提供具体板材名称或厚度，我再帮你核对。`;
    case "NO_READABLE_PUBLISHED_DATA": return "目前能查阅的资料里，还没有这项查询所需的数据。可以提供具体产品名称或资料名称，我再帮你找找。";
    case "CONDITIONS_CONFLICT": return "这几个筛选条件互相矛盾。请确认希望保留哪些条件，我再继续查。";
    case "QUERY_UNRESOLVED": return "还有一个查询条件没确认清楚，需要先核对后再查；已经明确的条件会保留。";
    case "SOURCE_NOT_VERIFIABLE": return "找到的相关记录还缺少可核对的来源或规格对应关系，暂时不能作为可选方案。可以先核对原表或具体板材信息。";
    case "METRIC_SCOPE_DIFFERENT": return "资料中记录的是材料层或芯材热阻，不能直接当作整块保温板的热阻。需要再核对板材自身的参数。";
    default: return "我需要先核对这项查询的结果，再给你准确答复。";
  }
}
