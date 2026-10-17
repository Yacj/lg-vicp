import { validateCandidateAgainstQueryState } from "../thermal/thermal-query-state.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";
import { querySelectedKnowledgeCandidates, readConsumableReferencePages, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { assertSolutionAccess, getSolutionSnapshot, loadActiveSolution } from "./solution-state.service.js";
import { bindReferencePageMatch, storeReferencePageBlocks, type ReferencePageBlock } from "./reference-page.js";
import { resolveVisibleCandidateIds } from "./reference-candidate-selection.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { decideDomainTurn } from "./ai-domain-turn-decision.js";
import { readHistoricalConfirmedPage } from "./confirmed-page-reference-read.js";

export type ReferenceReadContext = Pick<ToolRuntimeContext, "app" | "request" | "user" | "conversation" | "userMessage" | "taskState" | "onEvent" | "domainDecision" | "candidateQueryRevision"> & { candidatePublication?: "READ_ONLY_ADVICE" };
/** 重验会话/客户端/项目，只读取当前确认来源，不重新绑定旧optionId。 */
export async function resolveCandidateReference(ctx: ReferenceReadContext) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const decision = ctx.domainDecision ?? decideDomainTurn(ctx.userMessage ?? "", ctx.taskState?.lastReferenceLookup);
  let lookup = ctx.taskState?.lastReferenceLookup;
  let confirmedFinalIds: string[] | undefined;
  const reject = (reason: string) => ({ candidates: [] as ReferenceLookupCandidate[], pages: [] as ReferencePageBlock[], sources: [] as unknown[], reason, query: ctx.taskState?.lastReferenceLookup?.query ?? {}, confirmedFinalIds: undefined as string[] | undefined });
  if (conversation.projectId !== ctx.conversation.projectId) return reject("会话所属项目已变化，请重新查询。");
  if (ctx.candidateQueryRevision != null && ctx.candidateQueryRevision !== lookup?.candidateQueryRevision) return reject("候选列表已变化，请选择最近显示的候选。");
  if (/上一轮|旧列表|之前的列表/.test(ctx.userMessage ?? "")) return reject("旧列表无法用于当前引用，请选择最近显示的候选。");
  const stateScope = decision.referenceScope === "CURRENT_SELECTED" || decision.referenceScope === "CURRENT_CONFIRMED";
  if (stateScope) {
    const active = await loadActiveSolution(ctx);
    if (!active || active.projectId !== conversation.projectId) return reject("当前没有已选方案，请先明确选择。");
    if (decision.referenceScope === "CURRENT_CONFIRMED") {
      if (!active.confirmedSnapshotId) return reject("当前方案尚未确认，没有可读取的已确认快照。");
      const snapshot = await getSolutionSnapshot(ctx, active.confirmedSnapshotId);
      confirmedFinalIds = snapshot.payload.finalCandidateIds;
      lookup = { query: snapshot.payload.queryStateSnapshot, candidates: [...snapshot.payload.candidates, ...snapshot.payload.alternatives],
        projectId: snapshot.projectId, createdAt: new Date().toISOString() };
    } else lookup = { query: active.payload.queryStateSnapshot, candidates: active.payload.candidates
        .filter(item => active.payload.selectedCandidateIds.includes(item.candidate.candidateId)).map(item => item.candidate),
        projectId: active.projectId, createdAt: new Date().toISOString() };
  }
  if (!lookup || !lookup.candidates.length && !(decision.intent === "REFERENCE_VIEW" && lookup.query.documentIds?.length
    && decision.semantic?.reference.items.some(item => item.type === "CONSTRUCTION_CODE"))) return reject("当前没有可定位的候选，请先查询已有档位或选择方案。");
  if (!lookup.candidateQueryRevision && !stateScope || lookup.candidateResultInvalid || lookup.projectId !== conversation.projectId
    || !Number.isFinite(Date.parse(lookup.createdAt)) || Date.now() - Date.parse(lookup.createdAt) > 24 * 3600_000
    || Date.parse(lookup.createdAt) > Date.now() + 60_000) return reject("当前候选已过期或所属项目不一致，请重新查询。");
  const wholeScope = !decision.semantic?.reference.items.length && (decision.intent === "SOLUTION_ADVICE" || stateScope
    || decision.intent === "COMPARE_CANDIDATES" && decision.semantic?.reference.scope === "LAST_VISIBLE_CANDIDATES");
  let reference = wholeScope
    ? { ids: lookup.candidates.map(candidate => candidate.id) } : resolveVisibleCandidateIds(lookup,
      decision.semantic?.reference.items.length ? decision.semantic.reference.items.map(item => item.evidence).join("，") : ctx.userMessage ?? "");
  const items = decision.semantic?.reference.items;
  const sourceCode = items?.find(item => item.type === "CONSTRUCTION_CODE");
  const sourceThickness = items?.find(item => item.type === "THICKNESS");
  if (!reference.ids && decision.intent === "REFERENCE_VIEW" && !stateScope && lookup.query.documentIds?.length && lookup.query.knowledgeVersionIds?.length
    && items?.length && items.every(item => item.type === "CONSTRUCTION_CODE" || item.type === "THICKNESS")
    && items.filter(item => item.type === "CONSTRUCTION_CODE").length <= 1 && items.filter(item => item.type === "THICKNESS").length <= 1
    && (sourceCode || sourceThickness && lookup.query.schemeCode)) {
    const sourceQuery = { ...lookup.query, schemeCode: sourceCode?.value ?? lookup.query.schemeCode, schemeId: undefined,
      ...(sourceThickness ? { thicknessMm: sourceThickness.value, thicknessMin: undefined, thicknessMax: undefined } : {}),
      filters: [], metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined, unresolved: [] };
    const sourceCandidates = await querySelectedKnowledgeCandidates(ctx.app, sourceQuery, conversation.projectId);
    if (sourceCandidates.length === 1) {
      lookup = { ...lookup, candidates: sourceCandidates, query: sourceQuery };
      reference = { ids: [sourceCandidates[0]!.id] };
    } else if (sourceCandidates.length > 1) return reject("该构造在当前资料范围有多处同厚度来源，请指定原消息或资料页签，不能任选一个。");
  }
  if (!reference.ids) return reject(reference.reason!);
  const selected = reference.ids.map(id => lookup!.candidates.find(candidate => candidate.id === id)!);
  if (decision.intent === "COMPARE_CANDIDATES" && selected.length < 2) return reject("请指定至少两个当前候选进行比较。");
  if (selected.some(candidate => candidate.sourceType !== "CALCULATED" && (!candidate.sourcePageId || !candidate.optionId))) return reject("当前候选没有可核验的确认原页，请重新查询。");
  if (!await referenceRowsStillCurrent(ctx.app.db, selected, { userId: ctx.user.id, projectId: conversation.projectId })) return reject("正式候选已撤回或事实变化，请重新查询。");
  const rows = await readConsumableReferencePages(ctx.app, selected.flatMap(candidate => candidate.sourcePageId ? [candidate.sourcePageId] : []), conversation.projectId);
  const pages: ReferencePageBlock[] = [];
  for (const candidate of selected) {
    if (candidate.sourceType === "CALCULATED" && !candidate.sourcePageId) {
      if (decision.intent === "REFERENCE_VIEW") return reject("该候选来自正式计算记录，未关联图集原页；可以查看计算参数。");
      continue;
    }
    const row = rows.find(({ page }) => page.id === candidate.sourcePageId && (!candidate.sourceVersionId || page.versionId === candidate.sourceVersionId)
      && (!candidate.sourceDocumentId || page.documentId === candidate.sourceDocumentId));
    if (!row) return reject("来源已撤回、换版或无权访问，请重新查询。");
    const block = await toReferencePageBlock(ctx.app, row);
    const match = bindReferencePageMatch(candidate, { ...block.page, renderModel: block.renderModel });
    if (!match || match.optionId !== candidate.optionId) return reject("原页确认档位已变化，请重新查询；旧引用不能绑定到新档位。");
    const existing = pages.find(page => page.page.pageId === block.page.pageId);
    if (existing) existing.matches.push(match);
    else pages.push({ ...block, matches: [match], summary: match.summary, highlights: match.highlights });
  }
  const sources = pages.map(page => ({ documentId: page.page.documentId, pageId: page.page.pageId,
    title: page.page.documentTitle, pageLabel: page.page.pageLabel, physicalPageNumber: page.page.physicalPageNumber }));
  return { candidates: selected, pages, sources, reason: undefined, query: lookup.query, confirmedFinalIds };
}
export async function resolveReferenceRead(ctx: ReferenceReadContext) {
  const historicalPage = await readHistoricalConfirmedPage(ctx);
  if (historicalPage) return historicalPage;
  const resolved = await resolveCandidateReference(ctx);
  const query = { ...resolved.query,
    ...(resolved.reason ? { unresolved: [{ field: "reference", reason: resolved.reason }] } : {}) };
  const conflicting = resolved.candidates.filter(candidate => !validateCandidateAgainstQueryState(candidate, query).passed);
  const facts = buildAllowedAnswerFacts(query, resolved.candidates, "详细参数对比", undefined, { nearbyCandidates: conflicting });
  const display = resolved.candidates.map(candidate => `${resolved.confirmedFinalIds ? resolved.confirmedFinalIds.includes(candidate.id) ? "已确认最终方案：\n" : "冻结备选方案：\n" : ""}${buildAllowedAnswerFacts({}, [candidate], "详细参数").canonicalAnswers[0]!.split("\n").slice(1, -1).join("\n")}`).join("\n");
  const comparison = ctx.domainDecision?.semantic?.comparison;
  const key = comparison?.metric === "PRODUCT_R" ? "productThermalResistance" : comparison?.metric === "TOTAL_R" ? "totalThermalResistance" : "kValue";
  const complete = comparison && resolved.candidates.length > 0 && resolved.candidates.every(candidate => typeof candidate[key] === "number");
  const extreme = complete ? (comparison.direction === "MIN" ? Math.min : Math.max)(...resolved.candidates.map(candidate => candidate[key]!)) : undefined;
  const winners = extreme === undefined ? [] : resolved.candidates.filter(candidate => candidate[key] === extreme);
  const conclusion = comparison ? complete
    ? `在本次已展示的 ${resolved.candidates.length} 条完整构造中，${winners.map(candidate => candidate.constructionCode ?? candidate.schemeCode ?? candidate.id).join("、")} 的 ${comparison.metric} ${comparison.direction === "MIN" ? "最低" : "最高"}，为 ${extreme}。此结论仅针对当前列表，不代表全库极值，也不能据此替换项目实际基层。\n`
    : "当前候选存在该指标缺失，无法判断完整列表的极值。\n" : "";
  facts.canonicalAnswers = [resolved.reason ?? (resolved.candidates.length
    ? `${conclusion}${conflicting.length ? "部分已选候选不满足当前筛选条件，仅供参数查看与比较。\n" : ""}当前候选的已核验参数：\n${display}` : "当前没有可引用的候选。")];
  if (resolved.pages.length) {
    ctx.onEvent?.("reference_pages", { referencePages: resolved.pages, stored: storeReferencePageBlocks(resolved.pages) });
    ctx.onEvent?.("sources", { sources: resolved.sources });
  }
  return { facts, candidates: resolved.candidates, sources: resolved.sources, referencePages: resolved.pages, needsClarification: Boolean(resolved.reason), readOnly: true as const };
}
