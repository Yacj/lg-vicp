import { expect, it } from "vitest";
import { solutionSelectionSummary } from "./solution-selection-summary.js";
it("选择后的复合请求同时获得真实参数、R口径和层次，不把Final冒充确认", () => {
  const text = solutionSelectionSummary([{ thicknessMm: 28, substrateMaterial: "砌块", substrateThickness: 180,
    kValue: .29, productThermalResistance: 3.2, totalThermalResistance: 3.5, evidenceSource: "客户正式表", evidenceRef: "SheetB",
    layers: [{ order: 1, name: "砌块", thicknessMm: 180 }, { order: 2, name: "保温板", thicknessMm: 28 }] }] as any);
  expect(text).toContain("28mm"); expect(text).toContain("保温产品这一层的热阻 R=3.2");
  expect(text).toContain("整套构造的总热阻 R₀=3.5"); expect(text).toContain("K=0.29");
  expect(text).toContain("客户正式表，SheetB"); expect(text).not.toContain("已确认");
});
