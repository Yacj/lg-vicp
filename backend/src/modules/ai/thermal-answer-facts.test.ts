import { describe, expect, it } from "vitest";
import { bindConfirmedPageFacts, interpretThermalQuestion, THERMAL_FACT_RULES } from "./thermal-answer-facts.js";
import { parseConversationTaskState, type ReferenceLookupCandidate } from "./conversation-task.js";
import { normalizeReferenceLookupForModel, normalizeToolResultForModel } from "./tools/tool-result-normalizer.js";
import { formatAnswerContractPrompt, resolveAnswerContract } from "../../shared/ai-answer-contract.js";
import { formatSourceForUser } from "./ai-source.mapper.js";

const a: ReferenceLookupCandidate = { id: "A4-1-60", schemeCode: "A4-1", thicknessMm: 60,
  productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12,
  sourceDocumentId: "doc", sourcePageId: "page", sourcePageLabel: "33" };
const page = { pageId: "page", documentId: "doc", pageLabel: "33", metadata: {
  confirmedStructuredData: { systems: [{ constructionCode: "A4-1",
    layers: [{ name: "I型VICP双层保温板", lambda: 0.005, alpha: 1.5 }],
    options: [{ thicknessMm: 60, productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12 }] }] }
} };

describe("热工原子事实与回答契约", () => {
  it("A4-1 60mm双R/K及λ/α由同页唯一确认档位绑定且会话不丢字段", () => {
    const bound = bindConfirmedPageFacts(a, page);
    expect(bound.warnings).toEqual([]);
    expect(bound.candidate).toMatchObject({ ...a, lambda: 0.005, alpha: 1.5 });
    const restored = parseConversationTaskState({ lastReferenceLookup: { query: {}, candidates: [bound.candidate], createdAt: "now" } });
    expect(restored.lastReferenceLookup?.candidates[0]).toEqual(bound.candidate);
  });
  it("有冲突、不同文档或重复档位时保留候选主事实且不借用其他α", () => {
    const conflicting = structuredClone(page);
    conflicting.metadata.confirmedStructuredData.systems[0]!.options[0]!.productThermalResistance = 9.333;
    const result = bindConfirmedPageFacts(a, conflicting);
    expect(result.candidate.productThermalResistance).toBe(8);
    expect(result.candidate.alpha).toBeUndefined();
    expect(bindConfirmedPageFacts({ ...a, alpha: 1.25, lambda: 0.004 }, conflicting).candidate.alpha).toBeUndefined();
    expect(result.warnings.join()).toContain("冲突");
    expect(bindConfirmedPageFacts(a, { ...page, documentId: "other" }).warnings).not.toEqual([]);
    const duplicate = structuredClone(page);
    duplicate.metadata.confirmedStructuredData.systems.push(duplicate.metadata.confirmedStructuredData.systems[0]!);
    expect(bindConfirmedPageFacts(a, duplicate).candidate.alpha).toBeUndefined();
  });
  it("多个候选经过二次归一仍逐条保留，没有合并厚度/α区间", () => {
    const candidates = [{ ...a, thicknessMm: 50, alpha: 1.25 }, { ...a, id: "b", alpha: 1.5 }, { ...a, id: "c", thicknessMm: 70, alpha: 1.5, productThermalResistance: 9.333 }];
    const result = normalizeReferenceLookupForModel({ found: true, candidates, metric: "PRODUCT_R", targetValue: 8, lookupMode: "APPROX" });
    expect(result.candidates).toEqual(candidates);
    expect(result.primaryCandidate).toEqual(candidates[0]);
    expect(result.alternativeCandidates).toEqual(candidates.slice(1));
    expect(normalizeToolResultForModel("thermal", { data: result })).toEqual(result);
    expect(result.scope).toBe("CURRENT_MATCHES");
    expect(result.instruction).toContain("禁止跨候选合并字段");
    expect(result.instruction).toContain("未经工具完整范围统计证明");
  });
  it.each(["有传热8.3的保温板么", "热阻8.3", "保温系数8.3", "保温板8.3", "有8.3的保温板吗？", "热阻R≈8.3"]) ("%s 先轻量澄清而非猜K或总R", (message) => {
    expect(interpretThermalQuestion(message).needsClarification).toBe(true);
    expect(resolveAnswerContract({ message })).toBe("REFERENCE_LOOKUP");
  });
  it("历史K不能把本轮泛称热阻解释为K，保温板不能静默继承总R", () => {
    expect(interpretThermalQuestion("热阻8.3", "K").needsClarification).toBe(true);
    expect(interpretThermalQuestion("有8.3的保温板吗？", "TOTAL_R").needsClarification).toBe(true);
  });
  it.each(["产品热阻8.3左右有吗？", "总热阻8.3左右呢？", "K 0.12左右有什么？"]) ("%s 明确指标不澄清", (message) => {
    expect(interpretThermalQuestion(message).needsClarification).toBe(false);
  });
  it.each(["保温板8.3mm", "保温板8.3毫米", "保温板8.3元"])("%s 明确单位不误判热阻歧义", (message) => {
    expect(interpretThermalQuestion(message).needsClarification).toBe(false);
  });
  it("用户页码只认21，缺失时不把物理5说成印刷5", () => {
    expect(bindConfirmedPageFacts(a, { ...page, pageLabel: "21" }).candidate.sourcePageLabel).toBe("21");
    expect(bindConfirmedPageFacts(a, { ...page, pageLabel: null }).candidate.sourcePageLabel).toBeNull();
    const source = { title: "图集", pageLabel: "21", physicalPageNumber: 1 };
    expect(formatSourceForUser(source)).toContain("21页");
    expect(formatSourceForUser({ ...source, pageLabel: null, physicalPageNumber: 5 })).not.toMatch(/5页/);
  });
  it("销售简短、专业追问展开、精确近似与合规边界均进最终契约", () => {
    const prompt = formatAnswerContractPrompt("REFERENCE_LOOKUP");
    expect(prompt).toContain(THERMAL_FACT_RULES);
    expect(prompt).toContain("3～8行");
    expect(prompt).toContain("最多一个典型方案");
    expect(prompt).toContain("详细、全部、列出来、对比时才展开");
    expect(prompt).toContain("APPROX 说接近，EXACT 说正好等于");
    expect(resolveAnswerContract({ message: "A4-1的K=0.12在上海能不能用？" })).toBe("THERMAL");
  });
});
