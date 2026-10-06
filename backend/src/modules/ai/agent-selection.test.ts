import { describe, expect, it } from "vitest";
import {
  buildComparisonSelectionWaitState,
  parseAgentWaitState,
  resolveComparisonSelectionFromInput,
  resolveChoiceFromInput
} from "./agent-choice.js";
import type { ProductComparisonResult } from "./compare-product.js";

const comparison: ProductComparisonResult = {
  products: [
    { id: "p1", name: "VICP", summary: "A", status: "ACTIVE" },
    { id: "p2", name: "岩棉", summary: "B", status: "ACTIVE" },
    { id: "p3", name: "EPS", summary: "C", status: "ACTIVE" }
  ],
  dimensions: [],
  evidenceRefs: [],
  missingNotes: [],
  thermal: { status: "NOT_AVAILABLE", results: [] },
  ranking: null,
  scores: null
};

describe("COMPARISON_SELECTION 多选", () => {
  const waiting = buildComparisonSelectionWaitState({
    products: comparison.products,
    comparisonResult: comparison
  });

  it("默认多选且带确认生成报告，并附带 USER_SELECTION 协议", () => {
    expect(waiting.type).toBe("COMPARISON_SELECTION");
    expect(waiting.request?.type).toBe("USER_SELECTION");
    expect(waiting.request?.selectionKind).toBe("PRODUCT");
    expect(waiting.multiple).toBe(true);
    expect(waiting.minSelections).toBe(1);
    expect(waiting.confirmAction).toEqual({ type: "GENERATE_REPORT", label: "确认并生成报告" });
    expect(waiting.options).toHaveLength(3);
  });

  it("多选 1 个", () => {
    const selected = resolveComparisonSelectionFromInput(waiting, { optionIds: ["p2"] });
    expect(selected?.optionIds).toEqual(["p2"]);
  });

  it("多选 2 个", () => {
    const selected = resolveComparisonSelectionFromInput(waiting, { optionIds: ["p1", "p3"] });
    expect(selected?.optionIds).toEqual(["p1", "p3"]);
  });

  it("多选 3 个", () => {
    const selected = resolveComparisonSelectionFromInput(waiting, { optionIds: ["p1", "p2", "p3"] });
    expect(selected?.optionIds).toEqual(["p1", "p2", "p3"]);
  });

  it("确认生成报告不进入 APPROVAL", () => {
    const selected = resolveComparisonSelectionFromInput(waiting, {
      optionIds: ["p1", "p2"],
      confirmAction: "GENERATE_REPORT"
    });
    expect(selected?.confirmAction).toBe("GENERATE_REPORT");
    expect(waiting.type).not.toBe("APPROVAL");
  });

  it("刷新后仍能恢复 COMPARISON_SELECTION 等待结构", () => {
    const parsed = parseAgentWaitState({ waiting });
    expect(parsed?.type).toBe("COMPARISON_SELECTION");
    expect(parsed?.multiple).toBe(true);
    expect(parsed?.confirmAction?.type).toBe("GENERATE_REPORT");
    expect(parsed?.options.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("兼容旧 CHOICE 单选", () => {
    const choice = resolveChoiceFromInput({
      type: "CHOICE",
      options: waiting.options
    }, { optionId: "p1" });
    expect(choice?.optionId).toBe("p1");
  });
});
