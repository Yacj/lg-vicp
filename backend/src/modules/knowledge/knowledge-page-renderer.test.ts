import { describe, expect, it } from "vitest";
import { renderKnowledgePage, resolveReferenceHighlight, OPTION_FIELD_KEYS } from "./knowledge-page-renderer.js";
import { buildReferencePageBlocks } from "../ai/reference-page.js";
import { mergeReferencePages } from "../ai/report-context-snapshot.js";

// 用户提供的 A1-3 同行数值回归；A1-4 复用数值用于验证不能靠数字文本定位。
function fixture() {
  const system = (constructionCode: string) => ({ constructionCode, systemName: "薄抹灰外保温", specClass: "I" as const,
    layers: [
      { order: 1, name: "混合砂浆", thicknessMm: 20, lambda: 0.87, alpha: 1, rValue: 0.023 },
      { order: 2, name: "I型 VICP复合保温板", thicknessMm: null, lambda: 0.005, alpha: 1.25, rValue: null }
    ], options: [
      { thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 },
      { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.617, kValue: 0.276 }
    ] });
  return { id: "page-22", pageId: "page-22", documentId: "doc", pageLabel: "22", pageTitle: "热工表",
    metadata: { confirmedStructuredData: { fullText: "页面完整原文 <script>alert(1)</script>",
      systems: [system("A1-3"), system("A1-4")], notes: ["注：按原图保留。"] } } };
}
const candidate = { id: "row", sourcePageId: "page-22", sourceDocumentId: "doc", schemeCode: "A1-3", specClass: "I",
  thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 };

describe("确认页面渲染与语义定位", () => {
  it("同页双构造、多厚度保持同行双R/K，公共λ/α只在层中", () => {
    const model = renderKnowledgePage(fixture())!;
    expect(model.pageLabel).toBe("22");
    expect(model.sections.filter(section => section.type === "THERMAL_SYSTEM")).toHaveLength(2);
    const [a, b] = model.sections;
    expect(a!.optionTable!.rows[0]).toMatchObject({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
    expect(a!.commonLayers![1]).toMatchObject({ lambda: 0.005, alpha: 1.25, thicknessMm: null, rValue: null });
    expect(a!.commonLayers![0]).toMatchObject({ thicknessMm: 20, lambda: 0.87, alpha: 1, rValue: 0.023 });
    expect(a!.optionTable!.rows[0]).not.toHaveProperty("lambda");
    expect(a!.optionTable!.rows[0]!.optionId).not.toBe(b!.optionTable!.rows[0]!.optionId);
    expect(a!.optionTable!.columns.map(column => column.fieldKey)).toEqual(OPTION_FIELD_KEYS);
    expect(model.sections.at(-2)?.text).toContain("<script>"); // DTO 是文本，前端必须用文本插值。
    expect(model.sections.at(-1)).toMatchObject({ type: "NOTE", text: "注：按原图保留。" });
  });
  it("单厚度和缺失/null字段不丢失，不猜测旧rValue", () => {
    const page = fixture();
    page.metadata.confirmedStructuredData.systems = [{ constructionCode: "A1-3", options: [{ thicknessMm: 18, rValue: 2.88 }] } as any];
    const row = renderKnowledgePage(page)!.sections[0]!.optionTable!.rows[0]!;
    expect(row).toMatchObject({ thicknessMm: 18, productThermalResistance: null, totalThermalResistance: null, kValue: null });
    expect(resolveReferenceHighlight(candidate, page)).toBeNull();
  });
  it("重排构造、档位和层不改变ID；人工再次确认数值即重新render", () => {
    const page = fixture();
    const before = resolveReferenceHighlight(candidate, page)!;
    page.metadata.confirmedStructuredData.systems.reverse();
    for (const system of page.metadata.confirmedStructuredData.systems) { system.options.reverse(); system.layers.reverse(); }
    expect(resolveReferenceHighlight(candidate, page)).toEqual(before);
    const system = page.metadata.confirmedStructuredData.systems.find(item => item.constructionCode === "A1-3")!;
    const option = system.options.find(item => item.thicknessMm === 18)!;
    option.kValue = 0.302;
    const section = renderKnowledgePage(page)!.sections.find(item => item.id === before.sectionId)!;
    expect(section.optionTable!.rows.find(item => item.optionId === before.optionId)!.kValue).toBe(0.302);
    expect(resolveReferenceHighlight(candidate, page)).toBeNull();
    expect(resolveReferenceHighlight({ ...candidate, kValue: 0.302 }, page)?.optionId).toBe(before.optionId);
  });
  it("高亮指向唯一option和公共层，按正式语义字段携带事实", () => {
    const page = fixture();
    const highlight = resolveReferenceHighlight(candidate, page)!;
    const section = renderKnowledgePage(page)!.sections.find(item => item.id === highlight.sectionId)!;
    expect(section.optionTable!.rows.some(row => row.optionId === highlight.optionId)).toBe(true);
    expect(section.commonLayers!.find(layer => layer.layerId === highlight.commonLayerId)?.lambda).toBe(0.005);
    expect(highlight.fieldKeys).toEqual([...OPTION_FIELD_KEYS, "lambda", "alpha"]);
    expect(highlight.facts).toMatchObject({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
    expect(resolveReferenceHighlight({ ...candidate, schemeCode: "A1-4" }, page)?.optionId).not.toBe(highlight.optionId);
  });
  it("未确认草稿与重新识别候选不能成为render/highlight事实", () => {
    expect(renderKnowledgePage({ id: "page", metadata: { draftStructuredData: fixture().metadata.confirmedStructuredData } })).toBeNull();
    expect(renderKnowledgePage({ id: "page", metadata: { confirmedStructuredData: { systems: "invalid" } } })).toBeNull();
    const page = { ...fixture(), metadata: { ...fixture().metadata, recognitionStatus: "REVIEW_REQUIRED",
      draftStructuredData: { systems: [], fullText: "未确认的新内容" } } };
    expect(renderKnowledgePage(page)?.sections[0]?.constructionCode).toBe("A1-3");
    expect(resolveReferenceHighlight(candidate, page)).not.toBeNull();
  });
  it.each([
    { sourcePageId: "other" }, { sourceDocumentId: "other" }, { schemeCode: "other" },
    { thicknessMm: 19 }, { productThermalResistance: 3.297 }, { totalThermalResistance: 2.88 }, { kValue: 0.3 }, { specClass: "II" }
  ])("跨页/构造/档位/双R冲突拒绝绑定 %j", patch => {
    expect(resolveReferenceHighlight({ ...candidate, ...patch }, fixture())).toBeNull();
  });
  it("缺页码不回退物理页序；draft中的页签也不覆盖权威页签", () => {
    const page = { ...fixture(), pageLabel: null, physicalPageNumber: 22 };
    expect(renderKnowledgePage(page)?.pageLabel).toBeNull();
  });
  it("重复档位拒绝高亮，缺构造编号仍可渲染，ID不靠index", () => {
    const page = fixture();
    const system = page.metadata.confirmedStructuredData.systems[0]!;
    system.options.push({ ...system.options[0]!, kValue: 0.304 });
    expect(resolveReferenceHighlight(candidate, page)).toBeNull();
    const ids = renderKnowledgePage(page)!.sections[0]!.optionTable!.rows.map(row => row.optionId);
    expect(new Set(ids).size).toBe(ids.length);
    system.options.reverse();
    expect(renderKnowledgePage(page)!.sections[0]!.optionTable!.rows.map(row => row.optionId).sort()).toEqual(ids.sort());
    system.constructionCode = "";
    expect(renderKnowledgePage(page)!.sections[0]!.optionTable!.rows).toHaveLength(3);
  });
  it("已绑定scheme/spec优先于代码猜测", () => {
    const page = fixture();
    const system = page.metadata.confirmedStructuredData.systems[0]! as any;
    system.schemeId = "00000000-0000-4000-8000-000000000001";
    system.options[0].productSpecId = "00000000-0000-4000-8000-000000000002";
    expect(resolveReferenceHighlight(candidate, page)).toBeNull();
    expect(resolveReferenceHighlight({ ...candidate, schemeId: system.schemeId, productSpecId: system.options[0].productSpecId }, page)).not.toBeNull();
  });
  it("SSE同页候选聚合与持久化契约保留语义高亮，不存签名URL", () => {
    const page = fixture();
    const built = buildReferencePageBlocks([candidate, { ...candidate, id: "b", schemeCode: "A1-4" }], [{ ...page,
      documentTitle: "图集", physicalPageNumber: 1, pageImageObjectKey: "page.png", imageUrl: "https://example.test/signed" }]);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0]!.semanticHighlights).toHaveLength(2);
    expect(built.blocks[0]!.matches[0]!.optionId).toBe(resolveReferenceHighlight(candidate, page)?.optionId);
    const stored = mergeReferencePages(built.stored);
    expect(stored[0]?.semanticHighlights).toEqual(built.blocks[0]?.semanticHighlights);
    expect(stored[0]?.matches?.[0]?.semanticHighlights).toEqual(built.blocks[0]?.matches[0]?.semanticHighlights);
    expect(JSON.stringify(stored)).not.toContain("https://");
    built.blocks[0]!.semanticHighlights![0]!.facts.kValue = 9;
    expect(stored[0]?.semanticHighlights?.[0]?.facts.kValue).toBe(0.303);
  });
});
