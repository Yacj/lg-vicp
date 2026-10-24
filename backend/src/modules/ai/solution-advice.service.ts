import { resolveCandidateReference, type ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { adviceContextIsCurrent } from "./solution-advice-context.js";
import { validateCandidateAgainstQueryState } from "../thermal/thermal-query-state.js";
import type { ReferencePageBlock } from "./reference-page.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import type { FastifyReply } from "fastify";
import { writeSse } from "./ai-sse.js";
import { confirmedPageProsCons } from "./confirmed-page-advice.js";
import { hasPublishedReferenceSource } from "./published-reference-source.js";
import { solutionSelectionSummary } from "./solution-selection-summary.js";

export function emitSolutionAdvice(reply: FastifyReply, result: Awaited<ReturnType<typeof resolveSolutionAdvice>>) {
  if (result.referencePages.length) writeSse(reply, "reference_pages", { referencePages: result.referencePages });
  if (result.sources.length) writeSse(reply, "sources", { sources: result.sources });
  writeSse(reply, "delta", { text: result.answer });
}

export async function resolveSolutionAdvice(ctx: ReferenceReadContext) {
  const pageAdvice = await confirmedPageProsCons(ctx);
  if (pageAdvice) return pageAdvice;
  const empty = (answer: string) => ({ answer, candidates: [] as ReferenceLookupCandidate[], referencePages: [] as ReferencePageBlock[],
    sources: [] as unknown[], verified: false, needsClarification: true });
  if (ctx.domainDecision?.semantic?.adviceMode === "OUTLINE") return { ...empty("参考方案提纲：1. 需求与实际基层；2. 已确认构造及来源；3. 保温层与施工节点比选；4. 防火和固定要求核对；5. 待核实条件与适用边界。未核验候选时不填工程数值，不生成正式报告或合规证明。"), needsClarification: false };
  if (ctx.domainDecision?.semantic?.adviceFocus === "PROS_CONS" && !ctx.taskState?.lastReferenceLookup?.candidates.length)
    return { ...empty("要客观说明产品的优势和短板，需要对应的检测、构造和使用条件。这轮还没有取得能支持这些结论的完整依据，我先不把一般材料特点当作VICP的性能。\n可以从保温效果所需厚度、适用基层、防火与固定节点、施工要求和成本逐项核对；已有热工参考值可以查，价格、寿命或竞品优劣需要各自有出处的资料。"), needsClarification: false };
  // 上一轮是只读原页、且当前没有正式候选时，必须说明“不能直接据此生成”，不能退回通用开场。
  if (ctx.taskState?.confirmedPageLookup && !ctx.taskState?.lastReferenceLookup?.candidates.length)
    return { ...empty("刚才显示的是已确认原页的只读参考，不是可确认的正式候选，因此不能直接基于它生成方案或报告。要用这一页，需要先把对应档位导入正式参考行并完成发布；也可以按基层/厚度重新查正式候选。"), needsClarification: false };
  if (ctx.domainDecision?.semantic?.reference.scope === "NONE")
    return { ...empty("可以先从现场基层材料和厚度开始选参考构造。我可以帮你查已发布资料中的保温厚度、热工参数和来源，再一起核对防火、固定及节点要求。可以补充基层条件，或指定希望先看的资料；项目适用标准还要单独核验，参考选型本身不代表已经达标。"), needsClarification: false };
  const context = ctx.taskState?.adviceBusinessContext;
  const actualFocus = ctx.domainDecision?.semantic?.relation === "CONTINUE" && ctx.domainDecision.referenceScope === "LATEST_VISIBLE"
    && ctx.domainDecision.referenceFocusIds?.some(id => ctx.taskState?.lastReferenceLookup?.candidates.some(candidate => candidate.id === id));
  if (context && (!adviceContextIsCurrent(context, ctx.conversation, ctx.taskState) || !context.candidateScopeActive && !ctx.domainDecision?.restoreAdviceGoal && !actualFocus))
    return empty("可以先整理参考选型思路。你这轮要讨论哪个保温体系或哪一种实际基层？之前的话题和候选范围不能直接沿用。");
  if (!ctx.taskState?.lastReferenceLookup?.candidates.length)
    return empty("通用参考方案可先按实际基层确定构造，再比选保温层厚度，最后核对固定、防火与节点要求。你准备采用哪个保温体系或哪一种基层？当前没有可核验的候选，不给出具体热工数值。");
  const resolved = await resolveCandidateReference(ctx);
  if (resolved.reason) return empty(`${resolved.reason}请先提供当前有效的参考候选，再按实际基层整理选型建议。`);
  // 合规范围不作为一般建议前置条件；只在建议视图移除，不改写正式QueryState。
  const query = { ...resolved.query, regionCode: undefined, buildingType: undefined, standardLimitId: undefined,
    exclusions: resolved.query.exclusions?.filter(item => !["regionCode", "buildingType", "standardLimitId"].includes(item.field)) };
  if (resolved.candidates.some(candidate => candidate.sourceType === "CALCULATED" || candidate.sourceType === "PRODUCT"
    || !candidate.substrateMaterial || candidate.substrateThickness == null || candidate.substrateThickness <= 0
    || [candidate.thicknessMm, candidate.productThermalResistance, candidate.totalThermalResistance, candidate.kValue].some(value => value == null || !Number.isFinite(value) || value <= 0)
    || !validateCandidateAgainstQueryState(candidate, query).passed))
    return empty("当前候选还不能同时核验基层、厚度和确认来源，无法作为完整参考选型依据。请先确认实际基层并查询对应的完整档位。");
  const candidates = resolved.candidates;
  const sourceFor = (candidate: ReferenceLookupCandidate) => {
    const page = resolved.pages.find(page => page.page.pageId === candidate.sourcePageId);
    if (page) return `《${page.page.documentTitle}》${page.page.pageLabel ? `第${page.page.pageLabel}页` : "确认原页（未记录印刷页签）"}`;
    if (hasPublishedReferenceSource(candidate)) {
      const source = candidate.publishedReferenceSource!;
      return `${source.source}，${source.reference}，参考集版本${source.setVersion}（未关联原图）`;
    }
    return null;
  };
  if (candidates.some(candidate => !sourceFor(candidate))) return empty("当前候选的来源还无法核对，请先确认对应资料，再整理参考建议。");
  if (candidates.length === 1 && ctx.domainDecision?.semantic?.adviceFocus !== "PROS_CONS") return {
    answer: `这套参考做法可以这样说明：\n${solutionSelectionSummary(candidates, ctx.domainDecision?.semantic?.referenceReadFields?.includes("layers") ?? false)}\n资料位置：${sourceFor(candidates[0]!)}。采用前可以在下方点击“加入方案”，再核对最终方案。`,
    candidates, referencePages: resolved.pages, sources: resolved.sources, verified: true, needsClarification: false
  };
  const thicknesses = [...new Set(candidates.map(candidate => candidate.thicknessMm))];
  const sameSystem = candidates[0]?.systemName && candidates.every(candidate => candidate.systemName === candidates[0]!.systemName) ? candidates[0]!.systemName : undefined;
  if (ctx.domainDecision?.semantic?.adviceFocus === "PROS_CONS") {
    const lowestK = sameSystem && thicknesses.length === 1 ? Math.min(...candidates.map(candidate => candidate.kValue!)) : undefined;
    const answer = ["按已确认图集构造列出可核验的优点与局限：", ...candidates.map(candidate => {
      const page = resolved.pages.find(page => page.page.pageId === candidate.sourcePageId);
      return `- **${candidate.schemeCode ?? candidate.constructionCode}**：${candidate.substrateMaterial} ${candidate.substrateThickness}mm基层，保温板 ${candidate.thicknessMm}mm，K=${candidate.kValue}。`
        + `优点：已有该基层与厚度的${page ? "确认档位及原页" : "已发布参考行"}，可对照既有墙体${candidate.kValue === lowestK ? "；在本次同体系同板厚的条目中K最低" : ""}。`
        + `局限：只适用于此处列明的完整构造；现场基层或厚度不同须重新核对。来源：${sourceFor(candidate)}。`;
    }), "这是图集构造比较，不能为了较小K值替换实际墙体基层。当前来源未给出可核验的价格、寿命、防火及施工难度对照，不据此作这些优劣判断，也未确认方案或生成报告。"].join("\n\n");
    return { answer, candidates, referencePages: resolved.pages, sources: resolved.sources, verified: true, needsClarification: false };
  }
  const texts = [`先给你一版参考选型建议：${sameSystem ? `针对 ${sameSystem}，` : ""}以最近实际展示并已核验来源的 ${candidates.length} 个构造为范围${thicknesses.length === 1 ? `，保温板厚度为 ${thicknesses[0]}mm` : ""}，按现场已有基层匹配，不另设地区或建筑类型条件。`,
    "先核对实际基层材料和厚度，再择一采用对应构造："];
  const offsets = new Map<string, number>();
  for (const candidate of candidates) {
    texts.push(`- ${candidate.substrateThickness}mm ${candidate.substrateMaterial}基层：${!sameSystem && candidate.systemName ? `在 ${candidate.systemName} 中` : ""}参考 ${candidate.schemeCode ?? candidate.constructionCode} 构造${thicknesses.length > 1 ? `，保温板 ${candidate.thicknessMm}mm` : ""}。依据：${sourceFor(candidate)}。`);
    offsets.set(candidate.id, texts.join("\n\n").length);
  }
  texts.push("基层材料通常由结构条件决定，不能为了较小的 K 值随意替换。若现场基层与上述材料或厚度不一致，先重新核对对应构造，避免套用另一基层的参数。",
    "确定基层分支后，再核对所选原页的构造层、固定、防火及节点要求；资料没有给出的材料参数不补造。这里只对已展示的候选给一般参考建议，不宣称覆盖全部可能方案，也不包含节能达标、审图或正式确认结论。");
  return { answer: texts.join("\n\n"), candidates, referencePages: resolved.pages.map(page => ({ ...page,
    matches: page.matches.map(match => ({ ...match, answerOffset: offsets.get(match.candidateId ?? "") })) })), sources: resolved.sources,
    verified: true, needsClarification: false };
}
