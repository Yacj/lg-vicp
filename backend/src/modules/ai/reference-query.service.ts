import { decideDomainTurn, isReferenceRead } from "./ai-domain-turn-decision.js";
import { resolveReferenceRead, type ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { buildThermalQueryDebug, logThermalQueryDebug, toRejectedCandidateDebug } from "../thermal/thermal-query-debug.js";
import { parseSemanticQuery } from "./semantic-query.service.js";
import { publishCandidateResult } from "./candidate-result.service.js";
import { resolveComplianceRead } from "./compliance-read.service.js";
import { resolveConfirmedReferenceAnswer } from "./ai-reference-pages.service.js";

/**
 * 未启用 Agent 的查表仍走同一查询状态与约束服务，不能让普通 streamText 绕过事实门禁。
 *
 * 本函数只负责「查询 + 冻结事实」，**不再直接产出最终文案**：
 * 返回的 Allowed Fact Set 交给调用方（LLM 生成 → validateAnswerFacts 校验 → fallback），
 * 这样既能恢复 LLM 的自然表达，又能保证数值/来源/条件仍然由代码把关。
 */
export async function resolveReferenceQueryWithoutAgent(ctx: ReferenceReadContext) {
  const decision = ctx.domainDecision ?? decideDomainTurn(ctx.userMessage ?? "", ctx.taskState?.lastReferenceLookup);
  if (isReferenceRead(decision) || decision.intent === "COMPARE_CANDIDATES") return resolveReferenceRead({ ...ctx, domainDecision: decision });
  if (decision.intent === "COMPLIANCE_CHECK") return resolveComplianceRead(ctx);
  if (decision.intent === "CLARIFY") {
    const facts = buildAllowedAnswerFacts({ unresolved: [{ field: "intent", reason: decision.unresolved?.[0]
      ?? "请确认适用的地区标准和建筑类型后判断是否达标。" }] }, []);
    if (decision.semantic?.requestedEffect === "REPORT_GENERATION") facts.canonicalAnswers[0] += "\n正式方案报告需要先明确最终方案并显式确认，形成已确认方案快照；是否达标还需独立核验正式标准和适用条件。本轮没有确认方案或生成报告。";
    return { facts, sources: [], referencePages: [], needsClarification: true };
  }
  if (decision.mutation !== "QUERY") {
    const facts = buildAllowedAnswerFacts({ unresolved: [{ field: "intent", reason: "本轮没有已核验的查表目标，请明确要读取的体系、档位或参数。" }] }, []);
    return { facts, sources: [], referencePages: [], needsClarification: true };
  }
  const dictionary = await loadThermalQueryDictionary(ctx.app.db);
  const resolution = await parseSemanticQuery(ctx, { systemId: ctx.conversation.insulationSystemId ?? undefined }, dictionary);
  let query: ThermalQueryState = { ...resolution.query, intent: "REFERENCE_LOOKUP" as const };
  if (resolution.needsClarification)
    query = { ...query, unresolved: query.unresolved?.length ? query.unresolved : [{ field: "query", reason: "想查哪个目标值，或这几个条件是否需要同时满足？" }] };
  if (resolution.needsClarification) {
    // 未理解的新条件不能发布空候选覆盖最近有效来源；澄清后再提交查询。
    return { facts: buildAllowedAnswerFacts(query, []), sources: [], referencePages: [], needsClarification: true };
  }
  // 图集事实读取不刷新候选，也不经正式候选/产品ID准入。后续由有权确认页读取服务执行。
  if (decision.semantic?.pageQuery) return { facts: buildAllowedAnswerFacts(query, []), sources: [], referencePages: [], needsClarification: false };
  const result = await querySolutionCandidates(ctx, query);
  const { outcome, candidates, nearbyRaw, nearbyCandidates: nearby, identityMatchedButMetricFailed: identity } = result;
  query = result.queryState;
  // 查询诊断：让「查不到」能定位到具体失败条件。
  {
    const debug = buildThermalQueryDebug({
      query,
      lifecycle: resolution.lifecycle,
      matchedCount: result.matchedCount,
      returnedCandidateIds: candidates.map(candidate => candidate.id),
      nearby: nearbyRaw.map(candidate => toRejectedCandidateDebug(candidate.id, validateCandidateAgainstQueryState(candidate, query))),
      toolFilters: query.filters,
      rawText: ctx.userMessage ?? "", semantic: resolution, stageCounts: outcome?.stageCounts, identityMatchedButMetricFailed: identity.map(candidate => candidate.id)
    });
    logThermalQueryDebug(ctx.app.log, debug);
  }
  const { pages, nearbyPages, identityPages } = result;
  const state = ctx.taskState ?? { taskType: "GENERAL" as const };
  ctx.taskState = state;
  delete state.confirmedPageLookup;
  await publishCandidateResult({ ...ctx, candidatePublication: "READ_ONLY_ADVICE" }, { query, candidates: pages.candidates, createdAt: new Date().toISOString() });
  const facts = buildAllowedAnswerFacts(query, pages.candidates, ctx.userMessage ?? "", result.matchedCount, {
    nearbyCandidates: nearbyPages.candidates, identityMatchedButMetricFailed: identityPages.candidates, sourcePages: [...pages.sources, ...identityPages.sources] as Array<{ pageLabel?: string | null }>,
    queryDiagnostics: result.queryDiagnostics, metricScope: result.metricScope, missingMetricFields: result.missingMetricFields, readOnlyReferences: result.readOnlyFacts
  });
  const rendered = resolveConfirmedReferenceAnswer(result.readOnlyReferences.answer!, result.readOnlyReferences.pages);
  facts.canonicalAnswers = [rendered.text];
  return { facts, candidates: pages.candidates, readOnly: true as const,
    sources: rendered.pages.map(page => ({ documentId: page.page.documentId, pageId: page.page.pageId, title: page.page.documentTitle, pageLabel: page.page.pageLabel })),
    referencePages: rendered.pages, needsClarification: Boolean(query.unresolved?.length) };
}
