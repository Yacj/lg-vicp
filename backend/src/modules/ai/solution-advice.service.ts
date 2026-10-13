import { resolveCandidateReference, type ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { adviceContextIsCurrent } from "./solution-advice-context.js";
import { validateCandidateAgainstQueryState } from "../thermal/thermal-query-state.js";
import type { ReferencePageBlock } from "./reference-page.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import type { FastifyReply } from "fastify";
import { writeSse } from "./ai-sse.js";

export function emitSolutionAdvice(reply: FastifyReply, result: Awaited<ReturnType<typeof resolveSolutionAdvice>>) {
  if (result.referencePages.length) writeSse(reply, "reference_pages", { referencePages: result.referencePages });
  if (result.sources.length) writeSse(reply, "sources", { sources: result.sources });
  writeSse(reply, "delta", { text: result.answer });
}

export async function resolveSolutionAdvice(ctx: ReferenceReadContext) {
  const empty = (answer: string) => ({ answer, candidates: [] as ReferenceLookupCandidate[], referencePages: [] as ReferencePageBlock[],
    sources: [] as unknown[], verified: false, needsClarification: true });
  if (ctx.domainDecision?.semantic?.adviceMode === "OUTLINE") return { ...empty("参考方案提纲：1. 需求与实际基层；2. 已确认构造及来源；3. 保温层与施工节点比选；4. 防火和固定要求核对；5. 待核实条件与适用边界。未核验候选时不填工程数值，不生成正式报告或合规证明。"), needsClarification: false };
  if (ctx.domainDecision?.semantic?.reference.scope === "NONE")
    return empty("通用参考方案可先核对实际基层、保温体系和保温层要求，再阅读对应确认构造。请指定这轮要讨论的保温体系或基层，当前独立目标不沿用旧候选数值。");
  const context = ctx.taskState?.adviceBusinessContext;
  if (context && (!adviceContextIsCurrent(context, ctx.conversation, ctx.taskState) || !context.candidateScopeActive && !ctx.domainDecision?.restoreAdviceGoal))
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
  const thicknesses = [...new Set(candidates.map(candidate => candidate.thicknessMm))];
  const sameSystem = candidates[0]?.systemName && candidates.every(candidate => candidate.systemName === candidates[0]!.systemName) ? candidates[0]!.systemName : undefined;
  const texts = [`先给你一版参考选型建议：${sameSystem ? `针对 ${sameSystem}，` : ""}以最近实际展示并已核验来源的 ${candidates.length} 个构造为范围${thicknesses.length === 1 ? `，保温板厚度为 ${thicknesses[0]}mm` : ""}，按现场已有基层匹配，不另设地区或建筑类型条件。`,
    "先核对实际基层材料和厚度，再择一采用对应构造："];
  const offsets = new Map<string, number>();
  for (const candidate of candidates) {
    const page = resolved.pages.find(page => page.page.pageId === candidate.sourcePageId)!;
    texts.push(`- ${candidate.substrateThickness}mm ${candidate.substrateMaterial}基层：${!sameSystem && candidate.systemName ? `在 ${candidate.systemName} 中` : ""}参考 ${candidate.schemeCode ?? candidate.constructionCode} 构造${thicknesses.length > 1 ? `，保温板 ${candidate.thicknessMm}mm` : ""}。依据：《${page.page.documentTitle}》${page.page.pageLabel ? `第${page.page.pageLabel}页` : "确认原页（未记录印刷页签）"}。`);
    offsets.set(candidate.id, texts.join("\n\n").length);
  }
  texts.push("基层材料通常由结构条件决定，不能为了较小的 K 值随意替换。若现场基层与上述材料或厚度不一致，先重新核对对应构造，避免套用另一基层的参数。",
    "确定基层分支后，再核对所选原页的构造层、固定、防火及节点要求；资料没有给出的材料参数不补造。这里只对已展示的候选给一般参考建议，不宣称覆盖全部可能方案，也不包含节能达标、审图或正式确认结论。");
  return { answer: texts.join("\n\n"), candidates, referencePages: resolved.pages.map(page => ({ ...page,
    matches: page.matches.map(match => ({ ...match, answerOffset: offsets.get(match.candidateId ?? "") })) })), sources: resolved.sources,
    verified: true, needsClarification: false };
}
