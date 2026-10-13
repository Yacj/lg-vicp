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
  const result = await querySolutionCandidates(ctx, query);
  const { outcome, candidates, nearbyRaw, nearbyCandidates: nearby, identityMatchedButMetricFailed: identity } = result;
  query = result.queryState;
  // 查询诊断：让「查不到」能定位到具体失败条件。
  {
    const debug = buildThermalQueryDebug({
      query,
      lifecycle: resolution.lifecycle,
      matchedCount: outcome?.matchedCandidates?.length,
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
  await publishCandidateResult(ctx, { query, candidates: pages.candidates, createdAt: new Date().toISOString() });
  const facts = buildAllowedAnswerFacts(query, pages.candidates, ctx.userMessage ?? "", outcome?.matchedCandidates?.length, {
    nearbyCandidates: nearbyPages.candidates, identityMatchedButMetricFailed: identityPages.candidates, sourcePages: [...pages.sources, ...identityPages.sources] as Array<{ pageLabel?: string | null }>
  });
  return { facts, sources: [...pages.sources, ...identityPages.sources], referencePages: [...(pages.blocks ?? []), ...(identityPages.blocks ?? [])], needsClarification: Boolean(query.unresolved?.length) };
}
