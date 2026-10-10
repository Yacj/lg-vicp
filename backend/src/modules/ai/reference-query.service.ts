import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import { rankByPreferences, traceQueryState, validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { compactCandidateResult, LOOKUP_LIMIT, normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { emitReferencePages } from "./tools/thermal-calculate.tool.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { buildThermalQueryDebug, logThermalQueryDebug, toRejectedCandidateDebug } from "../thermal/thermal-query-debug.js";
import { interpretThermalQuestion } from "./thermal-answer-facts.js";
import { saveConversationTaskState } from "./ai-conversation-state.service.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { selectFrozenReferenceCandidateIds } from "./reference-candidate-selection.js";

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
  const resolution = normalizeConversationLookupQuery({ systemId: ctx.conversation.insulationSystemId ?? undefined }, ctx.userMessage ?? "", last, dictionary);
  let query: ThermalQueryState = { ...resolution.query, intent: "REFERENCE_LOOKUP" as const };
  if (interpretThermalQuestion(ctx.userMessage ?? "", resolution.lifecycle === "NEW_QUERY" ? undefined : last?.query.metric).needsClarification || resolution.needsClarification)
    query = { ...query, unresolved: query.unresolved?.length ? query.unresolved : [{ field: "query", reason: "想查哪个目标值，或这几个条件是否需要同时满足？" }] };
  const outcome = query.unresolved?.length ? null : await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
    ...query, targetResistance: query.targetR, neighborTolerance: 1, projectId: ctx.conversation.projectId ?? undefined
  });
  query = traceQueryState({ ...query, ...outcome?.queryState }, last?.query);
  const candidates = rankByPreferences((outcome?.candidates ?? []).map(compactCandidateResult)
    .filter(candidate => validateCandidateAgainstQueryState(candidate, query).passed), query).slice(0, LOOKUP_LIMIT);
  // 未完全满足硬条件的候选只作「最接近」说明，冻结进事实集后模型才可以引用（但不得称为命中）。
  const nearbyRaw = (outcome?.nearbyCandidates ?? []).map(compactCandidateResult);
  const nearby = nearbyRaw.filter(candidate => !validateCandidateAgainstQueryState(candidate, query).passed).slice(0, LOOKUP_LIMIT);
  // 查询诊断：让「查不到」能定位到具体失败条件。
  {
    const debug = buildThermalQueryDebug({
      query,
      lifecycle: resolution.lifecycle,
      matchedCount: outcome?.matchedCandidates?.length,
      returnedCandidateIds: candidates.map(candidate => candidate.id),
      nearby: nearbyRaw.map(candidate => toRejectedCandidateDebug(candidate.id, validateCandidateAgainstQueryState(candidate, query))),
      toolFilters: query.filters
    });
    logThermalQueryDebug(ctx.app.log, debug);
  }
  const pages = await emitReferencePages(ctx, candidates);
  const nearbyPages = await emitReferencePages({ app: ctx.app }, nearby);
  const state = ctx.taskState ?? { taskType: "GENERAL" as const };
  state.lastReferenceLookup = { query, candidates: pages.candidates, createdAt: new Date().toISOString() };
  await saveConversationTaskState(ctx.app, ctx.conversation.id, state);
  const facts = buildAllowedAnswerFacts(query, pages.candidates, ctx.userMessage ?? "", outcome?.matchedCandidates?.length, {
    nearbyCandidates: nearbyPages.candidates, sourcePages: pages.sources as Array<{ pageLabel?: string | null }>
  });
  return { facts, sources: pages.sources, needsClarification: Boolean(query.unresolved?.length) };
}
