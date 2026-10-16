import { currentConfirmedPageLookup } from "./confirmed-page-lookup-state.js";
import { readConsumableReferencePages, referencePageLocators, restoreReferencePageMatches, toReferencePageBlock } from "./ai-reference-pages.service.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import { queryConfirmedPageFacts } from "../knowledge/confirmed-page-facts.js";
import { extractSemanticFacts } from "./thermal-answer-semantics.js";
import { buildHighlights, type ReferencePageBlock } from "./reference-page.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import type { readReferenceFactHistory } from "./reference-fact-history.js";

const fields = { K: "kValue", TOTAL_R: "totalThermalResistance", PRODUCT_R: "productThermalResistance" } as const;
type Metric = keyof typeof fields;

/** 已显示确认页的事实核验；不按待核数字反选构造、不建立Candidate、不改查表状态。 */
export async function verifyVisibleConfirmedPageFact(ctx: ReferenceReadContext, history: Awaited<ReturnType<typeof readReferenceFactHistory>>, metric: Metric | null) {
  const reject = (answer: string, pages: ReferencePageBlock[] = []) => ({ answer, pages, needsClarification: true, code: "CONFIRMED_PAGE_FACT_UNRESOLVED" });
  const lookup = currentConfirmedPageLookup(ctx.taskState?.confirmedPageLookup, ctx.conversation);
  if (!lookup) return ctx.taskState?.confirmedPageLookup ? reject("最近的确认页来源已过期或会话范围不一致，请重新打开来源后核对。") : undefined;
  const scope = lookup.query;
  if (!scope.documentIds?.length || !scope.knowledgeVersionIds?.length) return reject("缺少最近实际显示的资料版本，请重新打开来源后核对。");
  const recent = history.find(row => {
    const age = Date.now() - row.createdAt.getTime();
    return age >= 0 && age <= 24 * 3600_000 && referencePageLocators(row.metadata).length;
  });
  const locators = referencePageLocators(recent?.metadata).filter(locator => scope.documentIds!.includes(locator.documentId));
  if (!locators.length) return reject("没有最近实际显示的确认页引用，请先打开对应构造和档位；不从数值反选来源。");
  const rows = await readConsumableReferencePages(ctx.app, locators.map(item => item.pageId), ctx.conversation.projectId);
  const pages: ReferencePageBlock[] = [];
  const facts = [] as ReturnType<typeof queryConfirmedPageFacts>;
  for (const locator of locators) {
    const row = rows.find(item => item.page.id === locator.pageId && item.document.id === locator.documentId && scope.knowledgeVersionIds!.includes(item.page.versionId));
    if (!row) return reject("来源已撤回、换版或无权访问，请重新查询后核对。");
    const data = readPageRecognitionMeta(row.page.metadata).confirmedStructuredData;
    if (data?.schemaVersion !== 2) return undefined; // 旧数据继续走原有核验路径。
    const block = await toReferencePageBlock(ctx.app, row);
    const restored = restoreReferencePageMatches(block, locator.item);
    if (!restored?.matches.length || !block.renderModel || !Array.isArray(locator.item.matches)
      || restored.matches.length !== locator.item.matches.length) return reject("来源确认版本或命中档位已变化，请重新打开来源后核对。");
    const available = queryConfirmedPageFacts([{ page: row.page, data, model: block.renderModel, systemId: row.document.insulationSystemId }], scope);
    const selected = available.filter(fact => restored.matches.some(match => match.optionId === fact.option.optionId && match.constructionId === fact.construction.constructionId));
    if (!selected.length || restored.matches.some(match => !selected.some(fact => fact.option.optionId === match.optionId)))
      return reject("最近显示的来源与当前查询条件不一致，请重新打开对应档位；不复用旧序号或其他行。");
    facts.push(...selected); pages.push(restored);
  }
  if (!facts.length) return reject("没有可核验的确认档位，请先打开来源。");
  const message = ctx.userMessage ?? "";
  // R的工程归属仅取每组唯一的已确认来源列，明确“产品R”仍保持产品语义。
  const rMetrics = facts.map(fact => {
    const columns = fact.construction.sourceColumns?.filter(column => column.symbol === "R");
    return columns?.length === 1 && columns[0]!.scope === "CONSTRUCTION" && columns[0]!.fieldKey === "totalThermalResistance" ? "TOTAL_R" as const
      : columns?.length === 1 && columns[0]!.scope === "PRODUCT" && columns[0]!.fieldKey === "productThermalResistance" ? "PRODUCT_R" as const : undefined;
  });
  const sourceR = rMetrics[0] && rMetrics.every(value => value === rMetrics[0]) ? { bareRMetric: rMetrics[0] } : undefined;
  const ordinary = extractSemanticFacts(message).filter(fact => fact.kind === "metric");
  const claims = extractSemanticFacts(message, sourceR).filter(fact => fact.kind === "metric");
  // 修正裸R的旧默认，仅在唯一来源列和同一原话数字可共同证明时生效。
  if (ordinary.length === 1 && claims.length === 1 && ordinary[0]!.metric === metric && claims[0]!.metric !== metric
    && (claims[0]!.metric === "TOTAL_R" || claims[0]!.metric === "PRODUCT_R")) metric = claims[0]!.metric;
  const values = [...new Set(claims.map(claim => claim.value))];
  if (!metric || values.length !== 1 || claims.some(claim => claim.metric !== metric)) return reject("请明确要核对的一个指标及数值；R的含义以所打开来源列为准。", pages);
  const thicknesses = [...new Set(extractSemanticFacts(message).flatMap(fact => fact.kind === "thickness" ? [fact.value] : []))];
  if (thicknesses.length && facts.some(fact => !thicknesses.includes(fact.option.thicknessMm!))) return reject("本轮板厚与最近显示的档位不一致，请先查询或打开对应厚度后核对。", pages);
  const key = fields[metric];
  if (facts.some(fact => fact.option[key] == null)) return reject(metric === "PRODUCT_R"
    ? "原表未单独给出完整产品热阻，无法核验该值；不会用芯层或整构造热阻替代。" : "该指标在最近确认档位中缺失，无法核验；不会补算。", pages);
  const lines = facts.map(fact => {
    const page = pages.find(item => item.page.pageId === fact.pageId)!;
    const option = fact.option, construction = fact.construction;
    const highlights = buildHighlights({ id: option.optionId, [key]: option[key]! }, construction.sourceColumns);
    const display = highlights[0]!;
    page.matches.filter(item => item.optionId === option.optionId).forEach(match => {
      delete match.answerOffset; // 新回答不沿用旧回答中的字符位置。
      match.fieldKeys = ["thicknessMm", key];
      match.highlights = buildHighlights({ id: option.optionId, thicknessMm: option.thicknessMm!, [key]: option[key]! }, construction.sourceColumns);
    });
    return `- **${construction.rawConstructionLabel || construction.constructionCode || construction.systemName || "原页构造"}**：板厚 ${option.thicknessMm}mm，${display.label}=${display.value}，与所问 ${values[0]}${option[key] === values[0] ? "一致" : "不一致"}。来源印刷页码 ${page.page.pageLabel ?? "待核"}。`;
  });
  pages.forEach(page => { page.summary = page.matches[0]!.summary; page.highlights = page.matches[0]!.highlights; });
  return { answer: [...lines, "这是资料事实核对，未确认正式方案；同值的不同构造分别保留。"].join("\n\n"), pages, needsClarification: false, code: "CONFIRMED_PAGE_FACT_VERIFY" };
}
