import { currentConfirmedPageLookup } from "./confirmed-page-lookup-state.js";
import { loadPublishedKnowledgeReferences, resolveConfirmedReferenceAnswer } from "./ai-reference-pages.service.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

/** v2确认页没有正式Candidate时仍可给构造优缺点；不补产品R或创建候选。 */
export async function confirmedPageProsCons(ctx: ReferenceReadContext) {
  if (ctx.domainDecision?.semantic?.adviceFocus !== "PROS_CONS" || ctx.taskState?.lastReferenceLookup?.candidates.length) return undefined;
  const lookup = currentConfirmedPageLookup(ctx.taskState?.confirmedPageLookup, ctx.conversation);
  if (!lookup || !lookup.query.documentIds?.length || !lookup.query.knowledgeVersionIds?.length) return undefined;
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId || ctx.candidateQueryRevision != null) return undefined;
  const read = await loadPublishedKnowledgeReferences(ctx.app, [], session.projectId, ctx.userMessage ?? "", lookup.query);
  if (!read.authoritative || !read.readOnlyPageFacts || !read.answer) return undefined;
  const resolved = resolveConfirmedReferenceAnswer(read.answer, read.pages);
  const rows = resolved.pages.flatMap(page => page.matches.flatMap(match => {
    const construction = page.renderModel?.constructions.find(item => item.constructionId === match.constructionId);
    const option = construction?.options.find(item => item.optionId === match.optionId);
    return construction && option ? [{ page, construction, option }] : [];
  }));
  if (!rows.length) return undefined;
  const answer = ["按当前确认页的图集构造列出优点与局限：", ...rows.map(({ page, construction, option }) =>
    `- **${construction.constructionCode ?? construction.rawConstructionLabel ?? construction.systemName ?? "原表构造"}**：保温板 ${option.thicknessMm}mm${option.kValue == null ? "" : `，K=${option.kValue}`}。`
    + `优点：该构造有确认档位和可追溯原页，可按实际${construction.baseMaterial ?? "基层"}对照。`
    + "局限：仅代表此完整构造；基层、板厚或层次变化后不能直接套用。"
    + `来源：《${page.page.documentTitle}》${page.page.pageLabel ? `第${page.page.pageLabel}页` : "确认原页"}。`),
    "这是图集构造比较，不能据此替换实际墙体基层。缺少独立产品热阻、价格、寿命、防火或施工难度证据时不补值或推断优劣；未确认方案或生成报告。"].join("\n\n");
  return { answer, candidates: [] as ReferenceLookupCandidate[], referencePages: resolved.pages,
    sources: resolved.pages.map(page => ({ documentId: page.page.documentId, pageId: page.page.pageId, title: page.page.documentTitle, pageLabel: page.page.pageLabel })), verified: true, needsClarification: false };
}
