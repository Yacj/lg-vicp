import { validateCandidateAgainstQueryState } from "../thermal/thermal-query-state.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";
import { readConsumableReferencePages, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { assertSolutionAccess, loadActiveSolution } from "./solution-state.service.js";
import { bindReferencePageMatch, storeReferencePageBlocks, type ReferencePageBlock } from "./reference-page.js";
import { resolveVisibleCandidateIds } from "./reference-candidate-selection.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import { decideDomainTurn } from "./ai-domain-turn-decision.js";

export type ReferenceReadContext = Pick<ToolRuntimeContext, "app" | "request" | "user" | "conversation" | "userMessage" | "taskState" | "onEvent" | "domainDecision" | "candidateQueryRevision"> & { candidatePublication?: "READ_ONLY_ADVICE" };
/** 重验会话/客户端/项目，只读取当前确认来源，不重新绑定旧optionId。 */
export async function resolveCandidateReference(ctx: ReferenceReadContext) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const decision = ctx.domainDecision ?? decideDomainTurn(ctx.userMessage ?? "", ctx.taskState?.lastReferenceLookup);
  let lookup = ctx.taskState?.lastReferenceLookup;
  const reject = (reason: string) => ({ candidates: [] as ReferenceLookupCandidate[], pages: [] as ReferencePageBlock[], sources: [] as unknown[], reason, query: ctx.taskState?.lastReferenceLookup?.query ?? {} });
  if (conversation.projectId !== ctx.conversation.projectId) return reject("会话所属项目已变化，请重新查询。");
  if (ctx.candidateQueryRevision != null && ctx.candidateQueryRevision !== lookup?.candidateQueryRevision) return reject("候选列表已变化，请选择最近显示的候选。");
  if (/上一轮|旧列表|之前的列表/.test(ctx.userMessage ?? "")) return reject("旧列表无法用于当前引用，请选择最近显示的候选。");
  if (decision.referenceScope === "CURRENT_SELECTED") {
    const active = await loadActiveSolution(ctx);
    if (!active || active.projectId !== conversation.projectId) return reject("当前没有已选方案，请先明确选择。");
    lookup = { query: active.payload.queryStateSnapshot, candidates: active.payload.candidates
      .filter(item => active.payload.selectedCandidateIds.includes(item.candidate.candidateId)).map(item => item.candidate),
      projectId: active.projectId, createdAt: new Date().toISOString() };
  }
  if (!lookup || !lookup.candidates.length) return reject("当前没有可定位的候选，请先查询已有档位或选择方案。");
  if (!lookup.candidateQueryRevision && decision.referenceScope !== "CURRENT_SELECTED" || lookup.candidateResultInvalid || lookup.projectId !== conversation.projectId
    || !Number.isFinite(Date.parse(lookup.createdAt)) || Date.now() - Date.parse(lookup.createdAt) > 24 * 3600_000
    || Date.parse(lookup.createdAt) > Date.now() + 60_000) return reject("当前候选已过期或所属项目不一致，请重新查询。");
  const adviceAll = decision.intent === "SOLUTION_ADVICE" && !decision.semantic?.reference.items.length;
  const reference = adviceAll || decision.referenceScope === "CURRENT_SELECTED" && /比较已选|对比已选/.test(ctx.userMessage ?? "")
    ? { ids: lookup.candidates.map(candidate => candidate.id) } : resolveVisibleCandidateIds(lookup,
      decision.semantic?.reference.items.length ? decision.semantic.reference.items.map(item => item.evidence).join("，") : ctx.userMessage ?? "");
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
  return { candidates: selected, pages, sources, reason: undefined, query: lookup.query };
}
export async function resolveReferenceRead(ctx: ReferenceReadContext) {
  const resolved = await resolveCandidateReference(ctx);
  const query = { ...resolved.query,
    ...(resolved.reason ? { unresolved: [{ field: "reference", reason: resolved.reason }] } : {}) };
  const conflicting = resolved.candidates.filter(candidate => !validateCandidateAgainstQueryState(candidate, query).passed);
  const facts = buildAllowedAnswerFacts(query, resolved.candidates, "详细参数对比", undefined, { nearbyCandidates: conflicting });
  const display = buildAllowedAnswerFacts({}, resolved.candidates, "详细参数对比").canonicalAnswers[0]!;
  facts.canonicalAnswers = [resolved.reason ?? (resolved.candidates.length
    ? `${conflicting.length ? "部分已选候选不满足当前筛选条件，仅供参数查看与比较。\n" : ""}当前候选的已核验参数：\n${display.split("\n").slice(1, -1).join("\n")}` : "当前没有可引用的候选。")];
  if (resolved.pages.length) {
    ctx.onEvent?.("reference_pages", { referencePages: resolved.pages, stored: storeReferencePageBlocks(resolved.pages) });
    ctx.onEvent?.("sources", { sources: resolved.sources });
  }
  return { facts, candidates: resolved.candidates, sources: resolved.sources, referencePages: resolved.pages, needsClarification: Boolean(resolved.reason), readOnly: true as const };
}
