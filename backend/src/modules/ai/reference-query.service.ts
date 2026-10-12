import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { buildThermalQueryDebug, logThermalQueryDebug, toRejectedCandidateDebug } from "../thermal/thermal-query-debug.js";
import { saveConversationTaskState } from "./ai-conversation-state.service.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { selectFrozenReferenceCandidateIds } from "./reference-candidate-selection.js";
import { parseSemanticQuery } from "./semantic-query.service.js";
import { publishCandidateResult } from "./candidate-result.service.js";

/**
 * 未启用 Agent 的查表仍走同一查询状态与约束服务，不能让普通 streamText 绕过事实门禁。
 *
 * 本函数只负责「查询 + 冻结事实」，**不再直接产出最终文案**：
 * 返回的 Allowed Fact Set 交给调用方（LLM 生成 → validateAnswerFacts 校验 → fallback），
 * 这样既能恢复 LLM 的自然表达，又能保证数值/来源/条件仍然由代码把关。
 */
export async function resolveReferenceQueryWithoutAgent(ctx: Pick<ToolRuntimeContext, "app" | "request" | "user" | "conversation" | "userMessage" | "taskState" | "onEvent">) {
  const last = ctx.taskState?.lastReferenceLookup;
  const preliminary = normalizeConversationLookupQuery({}, ctx.userMessage ?? "", last);
  if (preliminary.lifecycle === "COMPARE_SELECTED" && last) {
    if (ctx.user.clientType === "C_APP" || ctx.user.clientType === "PC_AI") {
      const { loadActiveSolution, isEditableSolution } = await import("./solution-state.service.js");
      const { compareSelectedSolution } = await import("./solution-workflow.js");
      const { solutionComparisonText } = await import("./solution-selection.js");
      const active = await loadActiveSolution(ctx);
      if (isEditableSolution(active)) {
        if (active.payload.selectedCandidateIds.length < 2) {
          const facts = buildAllowedAnswerFacts({ ...active.payload.queryStateSnapshot, unresolved: [{ field: "selection", reason: "请至少选择两个方案" }] }, []);
          return { facts, sources: [], needsClarification: true };
        }
        const comparison = compareSelectedSolution(active.payload);
        const facts = buildAllowedAnswerFacts(active.payload.queryStateSnapshot, comparison.candidates.filter(candidate => !candidate.conflicts.length), "详细参数对比", undefined,
          { nearbyCandidates: comparison.candidates.filter(candidate => candidate.conflicts.length) });
        facts.canonicalAnswers = [solutionComparisonText(comparison)];
        return { facts, sources: [], needsClarification: false };
      }
    }
    const selectedIds = selectFrozenReferenceCandidateIds(last, ctx.userMessage ?? "");
    const selected = last.candidates.filter(candidate => selectedIds?.includes(candidate.id));
    const valid = selected.length >= 2 && selected.length === selectedIds?.length && selected.every(candidate => validateCandidateAgainstQueryState(candidate, last.query).passed);
    const query = { ...last.query, intent: "COMPARISON" as const,
      unresolved: valid ? [] : [{ field: "selection", reason: "要比较当前列表里的哪两个方案？" }] };
    const facts = buildAllowedAnswerFacts(query, valid ? selected : [], "详细参数对比");
    const state = ctx.taskState!;
    state.lastReferenceLookup = { ...last, query, selectedCandidateIds: valid ? selectedIds : undefined };
    await saveConversationTaskState(ctx.app, ctx.conversation.id, state);
    return { facts, sources: [], needsClarification: !valid };
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
