import { describe, expect, it } from "vitest";
import {
  buildProductComparisonDimensions,
  freezeProductComparisonResult,
  emptyThermalState,
  type ComparisonProduct
} from "./compare-product.js";
import { buildDeterministicReportDraft, freezeReportContextSnapshot } from "./report-context-snapshot.js";
import { buildComparisonContext } from "./compare-product.js";

const products: ComparisonProduct[] = [
  { id: "vicp", name: "VICP", summary: "薄抹灰保温装饰板，施工便捷", status: "ACTIVE", knowledgeDocumentIds: ["doc-1"] },
  { id: "rockwool", name: "岩棉", summary: "传统保温材料", status: "ACTIVE" },
  { id: "eps", name: "EPS", summary: null, status: "ACTIVE" }
];

describe("动态 Comparison Dimension", () => {
  it("2 产品对比使用目录字段，不打分不排名", () => {
    const built = buildProductComparisonDimensions({ products: products.slice(0, 2) });
    expect(built.dimensions.find((item) => item.key === "name")?.items).toHaveLength(2);
    expect(built.dimensions.some((item) => item.key === "score" || item.key === "rank")).toBe(false);
  });

  it("3 产品对比保留全部产品", () => {
    const built = buildProductComparisonDimensions({ products });
    expect(built.dimensions[0]?.items.map((item) => item.productId)).toEqual(["vicp", "rockwool", "eps"]);
  });

  it("用户关注性能时从简介匹配，不编造", () => {
    const built = buildProductComparisonDimensions({
      products: products.slice(0, 2),
      focus: ["性能"]
    });
    const focus = built.dimensions.find((item) => item.key === "focus:性能");
    expect(focus?.sourceType).toBe("USER_REQUIREMENT");
  });

  it("用户关注性价比但资料不足", () => {
    const built = buildProductComparisonDimensions({
      products: products.slice(0, 2),
      focus: ["性价比"]
    });
    const cost = built.dimensions.find((item) => item.key === "focus:性价比");
    expect(cost?.insufficient).toBe(true);
    expect(cost?.items.every((item) => item.value == null && item.insufficient)).toBe(true);
    expect(built.missingNotes.join("")).toMatch(/性价比/);
  });

  it("没有热工结果仍可对比", () => {
    const built = buildProductComparisonDimensions({
      products: products.slice(0, 2),
      thermal: emptyThermalState()
    });
    expect(built.dimensions.some((item) => item.sourceType === "THERMAL" && !item.insufficient)).toBe(false);
  });

  it("未来注入 thermal result 不影响主流程", () => {
    const built = buildProductComparisonDimensions({
      products: products.slice(0, 2),
      thermal: { status: "AVAILABLE", results: [{ kValue: 0.32 }] }
    });
    expect(built.dimensions.some((item) => item.key === "thermal")).toBe(true);
  });
});

describe("Report Context Snapshot", () => {
  it("快照内容稳定，无热工结果仍可生成报告", () => {
    const built = buildProductComparisonDimensions({ products: products.slice(0, 3), focus: ["性价比"] });
    const result = freezeProductComparisonResult({
      products,
      dimensions: built.dimensions,
      evidenceRefs: built.evidenceRefs,
      missingNotes: built.missingNotes,
      thermal: emptyThermalState(),
      ranking: null,
      scores: null
    });
    const context = buildComparisonContext({
      conversationId: "conv-1",
      productIds: ["vicp", "rockwool", "eps"],
      result
    });
    const snapshot = freezeReportContextSnapshot({
      id: "snap-1",
      conversationId: "conv-1",
      reportType: "PRODUCT_COMPARISON",
      selectedProductIds: ["vicp", "rockwool"],
      confirmedRequirements: ["性价比"],
      comparisonContext: context,
      comparisonResult: result,
      sourceRefs: result.evidenceRefs,
      thermalResults: [],
      createdAt: "2026-09-20T00:00:00.000Z"
    });
    expect(snapshot.thermalResults).toEqual([]);
    expect(snapshot.comparisonResult.ranking).toBeNull();
    expect(snapshot.comparisonResult.scores).toBeNull();
    const draft = buildDeterministicReportDraft(snapshot);
    expect(draft.title).toContain("产品对比");
    expect(draft.sections.some((item) => item.heading === "热工结果")).toBe(false);
    expect(draft.summary).toMatch(/热工结果当前不可用/);
    expect(JSON.stringify(draft)).toContain("VICP");
    expect(draft.disclaimer).toContain("不构成唯一最优结论");
    expect(draft.sections.find((item) => item.heading === "差异说明与适用条件")?.content).toContain("系统未做固定评分");
  });

  it("有热工结果时报告展示热工，不改变产品选择", () => {
    const built = buildProductComparisonDimensions({
      products: products.slice(0, 2),
      thermal: { status: "AVAILABLE", results: [{ kValue: 0.3 }] }
    });
    const result = freezeProductComparisonResult({
      products: products.slice(0, 2),
      dimensions: built.dimensions,
      evidenceRefs: built.evidenceRefs,
      missingNotes: [],
      thermal: { status: "AVAILABLE", results: [{ kValue: 0.3 }] },
      ranking: null,
      scores: null
    });
    const snapshot = freezeReportContextSnapshot({
      id: "snap-2",
      conversationId: "conv-1",
      reportType: "PRODUCT_COMPARISON",
      selectedProductIds: ["vicp"],
      confirmedRequirements: [],
      comparisonContext: buildComparisonContext({
        conversationId: "conv-1",
        productIds: ["vicp", "rockwool"],
        result
      }),
      comparisonResult: result,
      sourceRefs: result.evidenceRefs,
      thermalResults: [{ kValue: 0.3 }],
      createdAt: "2026-09-20T00:00:00.000Z"
    });
    const draft = buildDeterministicReportDraft(snapshot);
    expect(draft.sections.some((item) => item.heading === "热工结果")).toBe(true);
    expect(snapshot.selectedProductIds).toEqual(["vicp"]);
  });
});
