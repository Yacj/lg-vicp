import { customerQueryDiagnosticClarification } from "./domain-clarification.js";
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
import { explainCandidateAvailability } from "./candidate-availability.service.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";

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
    const availability = decision.policyReason === "SEMANTIC_AMBIGUOUS"
      && (decision.semantic?.readGoal === "SCHEMES" || decision.semantic?.clarificationTarget === "REFERENCE")
      ? await explainCandidateAvailability(ctx, "CLARIFY") : undefined;
    const customerQuestion = decision.semantic ? customerQueryDiagnosticClarification(decision.semantic, ctx.userMessage ?? "") : undefined;
    const facts = buildAllowedAnswerFacts({ unresolved: [{ field: "intent", reason: customerQuestion ?? decision.unresolved?.[0]
      ?? "请确认适用的地区标准和建筑类型后判断是否达标。" }] }, []);
    if (decision.semantic?.requestedEffect === "REPORT_GENERATION") facts.canonicalAnswers[0] += "\n正式方案报告需要先明确最终方案并显式确认，形成已确认方案快照；是否达标还需独立核验正式标准和适用条件。本轮没有确认方案或生成报告。";
    if (availability) facts.canonicalAnswers = [availability.answer];
    return { facts, sources: [], referencePages: [], needsClarification: !availability, readOnly: true as const, availability };
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
    const facts = buildAllowedAnswerFacts(query, []);
    const customerQuestion = decision.semantic ? customerQueryDiagnosticClarification(decision.semantic, ctx.userMessage ?? "") : undefined;
    if (customerQuestion) facts.canonicalAnswers = [customerQuestion];
    return { facts, sources: [], referencePages: [], needsClarification: true, queryClarification: true as const };
  }
  // 只有“显式读页”才纯只读；带指标条件的 pageQuery 仍须先查正式候选（UAT/正式行存在时可选）。
  // 若正式候选为零，再回落到已确认页只读事实；不能因 pageQuery 字段本身跳过候选。
  const pageQuery = decision.semantic?.pageQuery;
  const hasMetricConstraint = !!query.filters?.length || (pageQuery?.constraints?.some(constraint => constraint.type === "METRIC" && constraint.value != null) ?? false);
  if (pageQuery && !hasMetricConstraint) return { facts: buildAllowedAnswerFacts(query, []), sources: [], referencePages: [], needsClarification: false };
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
  // 条件与候选分开：正式来源零命中也保存完整有效查询，下一轮不能退回旧候选的较宽条件。
  // 这是查询条件上下文，不授予来源读取、候选身份或正式操作权限；执行仍重验当前来源。
  const confirmedQuery = result.readOnlyReferences.query;
  if (!query.unresolved?.length)
    state.confirmedPageLookup = { query: confirmedQuery ?? query, requestQuery: query, createdAt: new Date().toISOString(), conversationId: ctx.conversation.id,
      userId: ctx.user.id, projectId: ctx.conversation.projectId, clientApp: ctx.conversation.clientApp };
  // 带指标条件的只读页查询：只有真正找到正式候选才发布；零候选不得清空/覆盖已有候选。
  if (!pageQuery || pages.candidates.length > 0)
    await publishCandidateResult({ ...ctx, candidatePublication: "READ_ONLY_ADVICE" }, { query, candidates: pages.candidates, createdAt: new Date().toISOString() });
  const facts = buildAllowedAnswerFacts(query, pages.candidates, ctx.userMessage ?? "", result.matchedCount, {
    nearbyCandidates: nearbyPages.candidates, identityMatchedButMetricFailed: identityPages.candidates, sourcePages: [...pages.sources, ...identityPages.sources] as Array<{ pageLabel?: string | null }>,
    queryDiagnostics: result.queryDiagnostics, metricScope: result.metricScope, missingMetricFields: result.missingMetricFields, readOnlyReferences: result.readOnlyFacts
  });
  const rendered = resolveConfirmedReferenceAnswer(result.readOnlyReferences.answer!, result.readOnlyReferences.pages);
  facts.canonicalAnswers = [rendered.text];
  const base = ctx.domainDecision?.queryBase;
  const basis = base && ctx.taskState?.lastReferenceLookup?.candidates.filter(candidate => candidate.schemeId === base.schemeId && candidate.productSpecId === base.productSpecId);
  const changeContextVerified = !!base && result.queryDiagnostics?.matchedCount === 0 && basis?.length === 1
    && await referenceRowsStillCurrent(ctx.app.db, basis, { userId: ctx.user.id, projectId: ctx.conversation.projectId });
  if (changeContextVerified) facts.canonicalAnswers = [`没有查到同一做法${query.thicknessMm != null ? `在${query.thicknessMm}mm厚度下` : ""}同时满足这次条件的参考记录，因此暂时不能可靠比较调整后的保温效果。前面可核验的是${basis![0]!.thicknessMm}mm那条，原参数和来源仍可查看。已经明确的其他条件会保留；我不会拿别的构造替代，也不会推算缺少的数值。`];
  return { facts, candidates: pages.candidates, readOnly: true as const,
    changeContextVerified: !!changeContextVerified,
    sources: rendered.pages.map(page => ({ documentId: page.page.documentId, pageId: page.page.pageId, title: page.page.documentTitle, pageLabel: page.page.pageLabel })),
    referencePages: rendered.pages, needsClarification: Boolean(query.unresolved?.length) };
}
