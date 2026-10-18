import { readReferenceFactHistory } from "./reference-fact-history.js";
import { readConsumableReferencePages, referencePageLocators, restoreReferencePageMatches, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { constructionCodes } from "./reference-candidate-selection.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { currentConfirmedPageLookup } from "./confirmed-page-lookup-state.js";

/** 无Candidate的原页回溯只消费本会话实际发送的确认引用；不重查/写入查询或候选。 */
export async function readHistoricalConfirmedPage(ctx: ReferenceReadContext) {
  const decision = ctx.domainDecision, items = decision?.semantic?.reference.items;
  const currentLookup = currentConfirmedPageLookup(ctx.taskState?.confirmedPageLookup, ctx.conversation);
  const latestPage = items?.length === 0 && decision?.semantic?.relation === "CONTINUE" && decision.semantic.referenceTime === "CURRENT"
    && decision.semantic.reference.scope === "LAST_VISIBLE_CANDIDATES" && !!currentLookup?.query.documentIds?.length && !!currentLookup.query.knowledgeVersionIds?.length;
  // 序号引用不能走此路径：它必须绑定候选 revision，不能从历史页块重建（见既有边界用例）。
  if (decision?.intent !== "REFERENCE_VIEW" || decision.mutation !== "NONE" || ctx.taskState?.lastReferenceLookup?.candidates.length
    || decision.referenceScope === "CURRENT_SELECTED" || decision.referenceScope === "CURRENT_CONFIRMED"
    || ctx.candidateQueryRevision != null || decision.semantic?.reference.revision != null
    || !items || !items.length && !latestPage || items.some(item => item.type !== "CONSTRUCTION_CODE" && item.type !== "THICKNESS")
    || items.filter(item => item.type === "CONSTRUCTION_CODE").length > 1 || items.filter(item => item.type === "THICKNESS").length > 1) return undefined;
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId) return undefined;
  const history = await readReferenceFactHistory(ctx.app, ctx.conversation.id);
  const code = items.find(item => item.type === "CONSTRUCTION_CODE")?.value;
  const thickness = items.find(item => item.type === "THICKNESS")?.value;
  // 无身份省略仅允许紧邻的实际引用，不能跳过新话题后回溯更早页面。
  for (const message of latestPage ? history.slice(0, 1) : history) {
    const age = Date.now() - message.createdAt.getTime();
    const scope = (message.metadata as { queryScope?: { id: string; userId: string; projectId: string | null; clientApp: string } })?.queryScope;
    if (age < 0 || age > 24 * 3600_000 || scope?.id !== ctx.conversation.id || scope.userId !== ctx.user.id
      || scope.projectId !== session.projectId || scope.clientApp !== ctx.conversation.clientApp) continue;
    const locators = referencePageLocators(message.metadata).filter(locator => !latestPage
      || currentLookup!.query.documentIds!.includes(locator.documentId) && currentLookup!.query.knowledgeVersionIds!.includes(String(locator.item.versionId)));
    if (!locators.length) continue;
    const rows = await readConsumableReferencePages(ctx.app, locators.map(item => item.pageId), session.projectId);
    const pages = [];
    for (const locator of locators) {
      const row = rows.find(row => row.page.id === locator.pageId && row.document.id === locator.documentId);
      if (!row) continue;
      const restored = restoreReferencePageMatches(await toReferencePageBlock(ctx.app, row), locator.item);
      if (!restored?.renderModel || !Array.isArray(locator.item.matches) || restored.matches.length !== locator.item.matches.length) continue;
      restored.matches = restored.matches.filter(match => {
        const construction = restored.renderModel!.constructions.find(item => item.constructionId === match.constructionId);
        const option = construction?.options.find(item => item.optionId === match.optionId);
        return option && (thickness == null || option.thicknessMm === thickness)
          && (code == null || constructionCodes(construction?.constructionCode ?? "").includes(String(code)));
      });
      if (restored.matches.length) {
        restored.matches.forEach(match => { delete match.answerOffset; });
        restored.answerStyle = undefined;
        restored.summary = restored.matches[0]!.summary; restored.highlights = restored.matches[0]!.highlights;
        pages.push(restored);
      }
    }
    // 多处来源不任选，也不从待核数值反选。
    if (pages.length > 1) return undefined;
    if (!pages.length) continue;
    const page = pages[0]!;
    const facts = buildAllowedAnswerFacts({}, []);
    facts.canonicalAnswers = [`以下是当前会话此前实际引用的确认原页：${page.page.documentTitle}，印刷页码 ${page.page.pageLabel ?? "待核"}。仅返回原引用及对应档位，未重新查询候选或选择方案。`];
    return { facts, candidates: [], sources: [{ documentId: page.page.documentId, pageId: page.page.pageId, title: page.page.documentTitle, pageLabel: page.page.pageLabel }],
      referencePages: pages, needsClarification: false, readOnly: true as const };
  }
  return undefined;
}
