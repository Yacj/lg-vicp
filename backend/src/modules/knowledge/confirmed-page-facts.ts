import type { KnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import { validatePageRecognitionEvidence } from "../../shared/page-recognition-evidence.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import { groundedPageAttribute } from "../../shared/confirmed-page-query.js";
import { normalizeThermalLookupQuery, getCandidateMetricValue, metricRankingGap } from "../thermal/thermal-lookup-mode.js";
import { validateCandidateAgainstQueryState, type ConstraintCandidate, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { diagnoseReferenceQuery, withoutReferenceMetrics, type ReferenceQueryDiagnostics } from "../thermal/reference-query-diagnostics.js";
import { legacyConfirmedPagePart, confirmedTableTitleSpecClass } from "../../shared/legacy-confirmed-page-scope.js";

export interface ConfirmedPageSnapshot {
  page: { id: string; versionId: string; documentId?: string; pageLabel?: string | null; pageLabelSource?: string; pageLabelVerified?: boolean };
  data: PageRecognitionResult;
  model: KnowledgePageRenderModel;
  systemId?: string | null;
}
export interface ConfirmedPageFact {
  pageId: string;
  versionId: string;
  documentId?: string;
  construction: KnowledgePageRenderModel["constructions"][number];
  option: KnowledgePageRenderModel["constructions"][number]["options"][number];
  /** 只供本轮结构化验证/诊断，不构造正式Candidate或补ID。 */
  queryFacts?: ConstraintCandidate;
}
const metricValue = (option: ConfirmedPageFact["option"], metric: "K" | "TOTAL_R" | "PRODUCT_R") => getCandidateMetricValue({
  kValue: option.kValue ?? undefined, totalThermalResistance: option.totalThermalResistance ?? undefined,
  productThermalResistance: option.productThermalResistance ?? undefined }, metric);
export function confirmedFactExtremum(facts: readonly ConfirmedPageFact[], query: ThermalQueryState) {
  const metric = query.preferences?.preferLowerK ? "K" : query.preferences?.preferHigherR ? query.preferences.higherRMetric ?? "TOTAL_R" : undefined;
  if (!metric) return undefined;
  const values = facts.flatMap(fact => { const value = metricValue(fact.option, metric); return value == null ? [] : [value]; });
  if (!values.length || values.length !== facts.length) return undefined;
  const value = query.preferences?.preferLowerK ? Math.min(...values) : Math.max(...values);
  return { metric, direction: query.preferences?.preferLowerK ? "MIN" as const : "MAX" as const, value, tiedCount: values.filter(item => item === value).length };
}
const code = (value: string) => value.normalize("NFKC").replace(/\s/g, "").replace(/^外墙/, "").toUpperCase();

/** 只读确认事实，不创建正式Candidate、产品/方案ID，也不以缺产品R为理由伪造该值。权限由调用方读取服务核验。 */
export function queryConfirmedPageFacts(snapshots: readonly ConfirmedPageSnapshot[], query: ThermalQueryState): ConfirmedPageFact[] {
  if (query.unresolved?.length) return [];
  const result: ConfirmedPageFact[] = [];
  for (const { page, data, model, systemId } of snapshots) {
    // 未修订的证据矛盾不能参与工程数值回答；纯警告/缺值仍可读取已证实的其他列。
    if (data.schemaVersion === 2 && validatePageRecognitionEvidence(data).issues.length) continue;
    if (query.pageLabel != null && visiblePageLabel(page) !== query.pageLabel) continue;
    const titleClass = confirmedTableTitleSpecClass(data.pageTitle);
    const consistentTitleClass = titleClass && !data.systems.some(system => system.specClass && system.specClass !== titleClass) ? titleClass : undefined;
    for (const [index, construction] of model.constructions.entries()) {
      const system = data.systems[index];
      if (!system) continue;
      const applicationPart = construction.applicationPart ?? (data.schemaVersion !== 2 ? legacyConfirmedPagePart(data.pageTitle) : undefined);
      if (query.applicationPart != null && query.applicationPart !== applicationPart) continue;
      if ((["roofForm", "placement"] as const).some(field => query[field] != null && query[field] !== construction[field])) continue;
      if (query.waterproofGrade && groundedPageAttribute("waterproofGrade", query.waterproofGrade) !== groundedPageAttribute("waterproofGrade", construction.waterproofGrade ?? "")) continue;
      if (query.constructionCodes?.length && !query.constructionCodes.some(value => code(value) === code(construction.constructionCode ?? ""))) continue;
      for (const [optionIndex, option] of construction.options.entries()) {
        if (option.thicknessMm == null || option.thicknessMm <= 0) continue;
        const sourceOption = system.options?.[optionIndex];
        const candidate = { systemId: systemId ?? undefined, systemName: [data.pageTitle, construction.systemName].filter(Boolean).join(" / ") || undefined,
          applicationPart, roofForm: construction.roofForm ?? undefined,
          placement: construction.placement ?? undefined, waterproofGrade: construction.waterproofGrade ? groundedPageAttribute("waterproofGrade", construction.waterproofGrade) : undefined, pageLabel: visiblePageLabel(page) ?? undefined,
          schemeId: system.schemeId ?? undefined, schemeCode: code(construction.constructionCode ?? ""),
          productSpecId: sourceOption?.productSpecId ?? undefined, catalogProductId: sourceOption?.catalogProductId,
          specClass: construction.specClass ?? consistentTitleClass, substrateMaterial: construction.baseMaterial ?? undefined,
          substrateThickness: construction.baseThicknessMm, thicknessMm: option.thicknessMm,
          productThermalResistance: option.productThermalResistance ?? undefined,
          totalThermalResistance: option.totalThermalResistance ?? undefined, kValue: option.kValue ?? undefined,
          sourceDocumentId: page.documentId, sourceVersionId: page.versionId };
        if (!validateCandidateAgainstQueryState(candidate, { ...query, schemeCode: query.schemeCode ? code(query.schemeCode) : undefined,
          constructionCodes: query.constructionCodes?.map(code), waterproofGrade: query.waterproofGrade ? groundedPageAttribute("waterproofGrade", query.waterproofGrade) ?? query.waterproofGrade : undefined }).passed) continue;
        if (normalizeThermalLookupQuery(query).filters.some(filter => getCandidateMetricValue(candidate, filter.metric) == null)) continue;
        result.push({ pageId: page.id, versionId: page.versionId, documentId: page.documentId, construction, option, queryFacts: candidate });
      }
    }
  }
  const metric = query.preferences?.preferLowerK ? "K" : query.preferences?.preferHigherR ? query.preferences.higherRMetric ?? "TOTAL_R" : undefined;
  const filters = normalizeThermalLookupQuery(query).filters;
  const distance = (fact: ConfirmedPageFact) => filters.reduce((sum, filter) => sum + metricRankingGap(metricValue(fact.option, filter.metric)!, filter.targetValue, filter.mode), 0);
  return result.sort((a, b) => {
    const av = metric ? metricValue(a.option, metric) : undefined;
    const bv = metric ? metricValue(b.option, metric) : undefined;
    return (metric ? av == null ? bv == null ? 0 : 1 : bv == null ? -1 : (av - bv) * (query.preferences?.preferLowerK ? 1 : -1) : 0)
      || (query.preferThinner || query.preferences?.preferThinner ? a.option.thicknessMm! - b.option.thicknessMm! : 0)
      || (query.preferences?.preferThicker ? b.option.thicknessMm! - a.option.thicknessMm! : 0)
      || distance(a) - distance(b)
      || a.pageId.localeCompare(b.pageId) || a.construction.constructionId.localeCompare(b.construction.constructionId)
      || a.option.thicknessMm! - b.option.thicknessMm! || a.option.optionId.localeCompare(b.option.optionId);
  });
}

export function inspectConfirmedPageFacts(snapshots: readonly ConfirmedPageSnapshot[], query: ThermalQueryState) {
  const all = queryConfirmedPageFacts(snapshots, {});
  const rows = all.map(fact => fact.queryFacts!);
  const diagnostics = diagnoseReferenceQuery(query, rows, "KNOWLEDGE_PAGE");
  const available = all.filter(fact => validateCandidateAgainstQueryState(fact.queryFacts!, withoutReferenceMetrics(query)).passed);
  if (diagnostics.missingMetrics.includes("PRODUCT_R") && available.some(fact => fact.construction.layers.some(layer => layer.rValue != null)
    || fact.option.layerValues?.some(layer => layer.rValue != null))) diagnostics.issues.push("METRIC_SCOPE_DIFFERENT");
  const rejected = snapshots.filter(snapshot => snapshot.data.schemaVersion === 2 && validatePageRecognitionEvidence(snapshot.data).issues.length).length;
  if (rejected) { diagnostics.rejectedSourceCount = rejected; diagnostics.issues.push("SOURCE_NOT_VERIFIABLE"); }
  return { facts: queryConfirmedPageFacts(snapshots, query), rows, all, diagnostics: diagnostics as ReferenceQueryDiagnostics };
}
