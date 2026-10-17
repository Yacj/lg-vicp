import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import { rankByPreferences, traceQueryState, validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { compactCandidateResult } from "./tools/thermal-lookup.js";
import type { SolutionContext } from "./solution-state.service.js";
import { emitReferencePages } from "./tools/thermal-calculate.tool.js";
import { loadPublishedKnowledgeReferences } from "./ai-reference-pages.service.js";
import { diagnoseReferenceQuery, renderReferenceQueryDiagnostics, withoutReferenceMetrics } from "../thermal/reference-query-diagnostics.js";
import { detectReferenceSourceConflicts, renderSourceConflict, renderReferenceCandidate } from "./thermal-answer-validation.js";
import { sameReferenceConstruction } from "./reference-source-identity.js";
import { formatConfirmedLookupAnswer, type KnowledgeTestReferenceContext } from "../knowledge/knowledge-test-reference.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { storeReferencePageBlocks, type ReferencePageBlock } from "./reference-page.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { confirmedFactExtremum } from "../knowledge/confirmed-page-facts.js";

import { DEFAULT_SOLUTION_QUERY_POLICY, type SolutionCandidateQueryPolicy } from "./solution-candidate-query-policy.js";
export { DEFAULT_SOLUTION_QUERY_POLICY } from "./solution-candidate-query-policy.js";
/** 内部覆写必须写明业务用途，不能让不同入口静默改变默认口径。 */
export type SolutionQueryOverride = { reason: string; policy: Partial<Pick<SolutionCandidateQueryPolicy, "neighborTolerance" | "maxCandidates" | "nearbyLimit" | "identityLimit">> };

/** Chat/REST/Agent/refine/refresh 共用。正式库读取、硬条件、偏好、排序、截断与说明候选只在这里处理。 */
export async function querySolutionCandidates(ctx: SolutionContext & Pick<ToolRuntimeContext, "onEvent">, query: ThermalQueryState, override?: SolutionQueryOverride) {
  const policy = { ...DEFAULT_SOLUTION_QUERY_POLICY, ...override?.policy };
  if (override && !override.reason.trim()) throw new Error("候选查询策略覆写必须说明业务用途");
  const outcome = query.unresolved?.length ? null : await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
    ...query, intent: "REFERENCE_LOOKUP", targetResistance: query.targetR,
    neighborTolerance: policy.neighborTolerance, projectId: ctx.conversation.projectId ?? undefined
  });
  const queryState = traceQueryState({ ...query, ...outcome?.queryState });
  const formal = rankByPreferences((outcome?.candidates ?? []).map(compactCandidateResult)
    .filter(candidate => validateCandidateAgainstQueryState(candidate, queryState).passed), queryState);
  // 已授权结构化查询完整读取两类来源；知识事实不伪造成可Confirm的正式候选。
  const knowledge = queryState.unresolved?.length ? undefined : await loadPublishedKnowledgeReferences(ctx.app, [], ctx.conversation.projectId,
    "", queryState, { completePublishedScope: true });
  const nearbyRaw = (outcome?.nearbyCandidates ?? []).map(compactCandidateResult);
  const nearbyCandidates = nearbyRaw.filter(candidate => !validateCandidateAgainstQueryState(candidate, queryState).passed).slice(0, policy.nearbyLimit);
  const identityMatchedButMetricFailed = (outcome?.identityMatchedButMetricFailed ?? []).map(compactCandidateResult).slice(0, policy.identityLimit);
  const pageContext = { app: ctx.app, conversation: ctx.conversation };
  // 来源校验必须先于展示截断，前12条失效不能遮住后续有效行，也不能把截断计作来源失败。
  const allPages = await emitReferencePages(pageContext, formal);
  const verifiedFormal = allPages.candidates;
  const displayed = verifiedFormal.slice(0, policy.maxCandidates);
  const displayIds = new Set(displayed.map(candidate => candidate.id));
  const blocks = (allPages.blocks ?? []).flatMap(block => {
    const matches = block.matches.filter(match => displayIds.has(match.candidateId ?? ""));
    return matches.length ? [{ ...block, matches, summary: matches[0]!.summary, highlights: matches[0]!.highlights }] : [];
  });
  const sources = blocks.map(block => ({ documentId: block.page.documentId, pageId: block.page.pageId, title: block.page.documentTitle,
    pageLabel: block.page.pageLabel, pageNumber: block.page.pageNumber, physicalPageNumber: block.page.physicalPageNumber }));
  const pages = { ...allPages, candidates: displayed, blocks, sources };
  if (blocks.length) { ctx.onEvent?.("reference_pages", { referencePages: blocks, stored: storeReferencePageBlocks(blocks) }); ctx.onEvent?.("sources", { sources }); }
  const nearbyPages = await emitReferencePages(pageContext, nearbyCandidates);
  const identityPages = await emitReferencePages(pageContext, identityMatchedButMetricFailed);
  const matchedCandidates = pages.candidates;
  const matchedCount = verifiedFormal.length;
  const knowledgeRecords = (knowledge?.allConfirmedFacts ?? []).map(fact => ({ ...fact.queryFacts,
    id: fact.option.optionId, optionId: fact.option.optionId, referenceKind: "KNOWLEDGE_PAGE", sourcePageId: fact.pageId,
    sourceDocumentId: fact.documentId, sourceVersionId: fact.versionId } as ReferenceLookupCandidate));
  const rawRecords = (outcome?.sourceRows ?? []).map(row => ({ ...row, referenceKind: "THERMAL_ROW",
    optionId: verifiedFormal.find(candidate => candidate.id === row.id)?.optionId } as ReferenceLookupCandidate));
  const identityQuery = withoutReferenceMetrics(queryState);
  const scopedFormal = rawRecords.filter(row => validateCandidateAgainstQueryState(row, identityQuery).passed);
  const scopedKnowledge = knowledgeRecords.filter(row => validateCandidateAgainstQueryState(row, identityQuery).passed);
  const sourceConflicts = detectReferenceSourceConflicts([...scopedFormal, ...scopedKnowledge]);
  const sourceAssociations = scopedFormal.flatMap(row => {
    const linked = scopedKnowledge.filter(page => sameReferenceConstruction(row, page));
    return linked.length === 1 ? [{ thermalRowId: row.id, pageId: linked[0]!.sourcePageId!, optionId: linked[0]!.optionId!,
      versionId: linked[0]!.sourceVersionId!, qualification: "READ_ONLY" as const }] : [];
  });
  const diagnostics = diagnoseReferenceQuery(queryState, [...(outcome?.sourceRows ?? []), ...(knowledge?.diagnosticRows ?? [])], "JOINT");
  if (knowledge?.queryDiagnostics?.issues.includes("METRIC_SCOPE_DIFFERENT") && diagnostics.missingMetrics.includes("PRODUCT_R")) diagnostics.issues.push("METRIC_SCOPE_DIFFERENT");
  const rejectedSourceCount = formal.length - verifiedFormal.length + (knowledge?.queryDiagnostics?.rejectedSourceCount ?? 0);
  if (rejectedSourceCount) { diagnostics.rejectedSourceCount = rejectedSourceCount; diagnostics.issues.push("SOURCE_NOT_VERIFIABLE"); }
  // 原始正式行必须先绑定有效来源才能参与命中；诊断值仍仅作解释。
  diagnostics.matchedCount = verifiedFormal.length + (knowledge?.confirmedFacts?.length ?? 0);
  if (!diagnostics.matchedCount && !diagnostics.issues.length) diagnostics.issues.push("SOURCE_NOT_VERIFIABLE");
  const linkedIds = new Set(sourceAssociations.filter(item => {
    const row = verifiedFormal.find(row => row.id === item.thermalRowId), page = knowledgeRecords.find(row => row.optionId === item.optionId);
    return row && page && (["kValue", "totalThermalResistance", "productThermalResistance"] as const)
      .every(field => row[field] == null && page[field] == null || row[field] != null && page[field] != null && Math.abs(row[field]! - page[field]!) <= .00005);
  })
    .map(item => item.optionId));
  const readOnlyIds = (knowledge?.citationOptionIds ?? []).filter(id => !linkedIds.has(id));
  const readOnlyMatched = (knowledge?.confirmedFacts ?? []).filter(fact => !linkedIds.has(fact.option.optionId));
  diagnostics.matchedCount = verifiedFormal.length + readOnlyMatched.length;
  const readOnlyAnswer = readOnlyMatched.length ? formatConfirmedLookupAnswer(knowledge?.pages ?? [], readOnlyIds, queryState.filters, {
    readOnlyPageFacts: true, totalMatched: readOnlyMatched.length, totalGroups: new Set(readOnlyMatched.map(fact => fact.construction.constructionId)).size,
    readFields: queryState.readFields, extremum: confirmedFactExtremum(readOnlyMatched, queryState) }) : undefined;
  const formalHead = matchedCandidates[0];
  const formalAnswer = formalHead ? `${formalHead.sourcePageId && formalHead.sourceVersionId && formalHead.optionId
    ? "以下为满足当前筛选条件、已绑定确认原页的正式参考候选（尚未确认方案）" : "以下为满足当前筛选条件的正式参考行；只读，尚未绑定可确认原页"}：\n${renderReferenceCandidate(formalHead, false)}`
    + (formalHead.optionId ? `[[KP:${formalHead.optionId}:thicknessMm,productThermalResistance,totalThermalResistance,kValue]]` : "") : undefined;
  const answer = diagnostics.matchedCount ? [formalAnswer, readOnlyAnswer ? `以下为已确认页面的只读参考，不构成正式方案候选：\n${readOnlyAnswer}` : undefined,
    sourceConflicts.length ? sourceConflicts.map(renderSourceConflict).join("\n") : undefined,
    rejectedSourceCount ? "部分来源未通过当前确认档位校验，已排除；可核验结果如上。" : undefined,
    diagnostics.partialMissingMetrics?.length ? "部分确认记录未提供所问独立指标，结果仅覆盖具备该指标的记录。" : undefined,
    "仅覆盖当前有权访问、已发布生效的确认范围；参考值不构成计算或合规结论。"].filter(Boolean).join("\n\n") : renderReferenceQueryDiagnostics(diagnostics);
  const combinedPages = new Map<string, ReferencePageBlock>();
  for (const page of [...(pages.blocks ?? []), ...(knowledge?.pages ?? [])]) {
    const previous = combinedPages.get(page.page.pageId);
    if (!previous) combinedPages.set(page.page.pageId, { ...page, answerStyle: undefined });
    else previous.matches = [...new Map([...previous.matches, ...page.matches].map(match => [match.optionId, match])).values()];
  }
  const readOnlyReferences: KnowledgeTestReferenceContext = { pages: [...combinedPages.values()], context: knowledge?.context ?? "",
    citationOptionIds: [...new Set([...(knowledge?.citationOptionIds ?? []), ...(formalHead?.optionId ? [formalHead.optionId] : [])])], authoritative: true, readOnlyPageFacts: true, answer,
    queryDiagnostics: diagnostics, query: knowledge?.query?.documentIds?.length ? knowledge.query : queryState,
    totalMatched: diagnostics.matchedCount, totalGroups: knowledge?.totalGroups };
  return { policy, queryState, outcome, pages, nearbyPages, identityPages, candidates: matchedCandidates, matchedCandidates,
    nearbyCandidates: nearbyPages.candidates, nearbyRaw, identityMatchedButMetricFailed: identityPages.candidates,
    matchedCount, knowledge, readOnlyReferences, sourceAssociations, sourceConflicts, queryDiagnostics: diagnostics,
    candidateQualifications: matchedCandidates.map(candidate => ({ candidateId: candidate.id,
      confirmationEligible: Boolean(candidate.sourcePageId && candidate.sourceVersionId && candidate.optionId),
      qualification: candidate.sourcePageId && candidate.sourceVersionId && candidate.optionId ? "FORMAL_CANDIDATE" as const : "READ_ONLY_REFERENCE" as const })),
    readOnlyFacts: [...knowledgeRecords.filter(row => readOnlyIds.includes(row.optionId!) || sourceConflicts.some(conflict => conflict.optionId === row.optionId)),
      ...scopedFormal.filter(row => sourceConflicts.some(conflict => conflict.thermalRowId === row.id))],
    /** 零命中时的只读取值概览与「数据缺列」诊断，交给回答层区分话术 */
    metricScope: diagnostics.metricScopes.length === 1 ? diagnostics.metricScopes[0] : undefined,
    missingMetricFields: diagnostics.missingMetrics,
    matchedSystemHint: query.systemHint ? formal.length > 0 : null, isFallback: false,
    notes: [...(outcome?.notes ?? [])] };
}
