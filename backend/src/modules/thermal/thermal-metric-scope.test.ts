import { describe, expect, it } from "vitest";
import { calculateThermal, type CalcLayer, type ResolvedRules } from "./thermal-calculator.js";
import { renderAllowedFactsForModel } from "../ai/thermal-answer-validation.js";

/**
 * 阶段3：产品热阻口径与事实标签。
 *
 * 甲方分层案例：芯材热阻 R=4.8，完整复合产品热阻 R=5.0。
 * 当前 VICP-CALC-1 的 LAYERED 只累加 PRODUCT_LAYER 行，得到的是芯材/产品层热阻，
 * 不等于产品整体热阻。本阶段**不改公式、不改历史数据**，只把口径随数值一起冻结与传递，
 * 禁止把它表述成「产品整体热阻」。
 */

const rules: ResolvedRules = {
  ruleId: "rule", ruleVersion: 1, ruleCode: "VICP-CALC-1", formulaVersion: "VICP-CALC-1",
  interiorSurfaceResistance: 0.11, exteriorSurfaceResistance: 0.04, precision: 3, roundingMode: "HALF_UP",
  compareField: "K_VALUE", compareOperator: "LTE", includeNonProductLayers: true, includeSurfaceResistances: true
};

const layer = (overrides: Partial<CalcLayer> = {}): CalcLayer => ({
  layerOrder: 1, layerType: "PRODUCT_LAYER", layerName: "真空绝热芯材", materialId: null,
  thicknessM: 0.01, lambda: 0.0025, correctionFactor: 1, ...overrides
});

describe("产品热阻口径随计算结果一起冻结", () => {
  it("LAYERED 只累加产品层行，口径标记为 PRODUCT_LAYER_ROWS_ONLY", () => {
    const outcome = calculateThermal({ mode: "LAYERED", rules, layers: [layer()], equivalentParams: null, standardLimit: null });
    expect(outcome.productResistance).toBeCloseTo(4, 12);
    expect(outcome.productResistanceScope).toBe("PRODUCT_LAYER_ROWS_ONLY");
  });

  it("EQUIVALENT 按当量参数累加产品层，口径标记为 PRODUCT_EQUIVALENT_TOTAL", () => {
    const outcome = calculateThermal({ mode: "EQUIVALENT", rules, layers: [layer()], equivalentParams: { conductivity: 0.0025, correctionFactor: 1 }, standardLimit: null });
    expect(outcome.productResistance).toBeCloseTo(4, 12);
    expect(outcome.productResistanceScope).toBe("PRODUCT_EQUIVALENT_TOTAL");
  });

  it("计算无效时没有口径，不产生可误读的默认值", () => {
    const outcome = calculateThermal({ mode: "LAYERED", rules, layers: [layer({ thicknessM: 0 })], equivalentParams: null, standardLimit: null });
    expect(outcome.valid).toBe(false);
    expect(outcome.productResistanceScope).toBeNull();
  });

  it("加入口径标记不改变任何已发布数值", () => {
    const withScope = calculateThermal({ mode: "LAYERED", rules, layers: [layer()], equivalentParams: null, standardLimit: null });
    expect(withScope.totalResistanceRounded).toBe(4.15);
    expect(withScope.kValueRounded).toBe(0.241);
  });
});

describe("事实清单不得把产品层热阻说成产品整体", () => {
  const renderWithScope = (scope: "PRODUCT_LAYER_ROWS_ONLY" | "PRODUCT_EQUIVALENT_TOTAL") => renderAllowedFactsForModel({
    query: { filters: [] } as never, candidates: [], canonicalAnswers: [],
    calculation: { productThermalResistance: 4.8, productThermalResistanceScope: scope, totalResistance: 5.3068, kValue: 0.1884 }
  } as never);

  it("LAYERED 口径显式声明只覆盖产品层行，并禁止换算成产品整体", () => {
    const text = renderWithScope("PRODUCT_LAYER_ROWS_ONLY");
    expect(text).toContain("不得表述为「产品整体热阻」");
    expect(text).not.toContain("代表产品整体热阻");
  });

  it("EQUIVALENT 口径才可以说代表产品整体", () => {
    expect(renderWithScope("PRODUCT_EQUIVALENT_TOTAL")).toContain("代表产品整体热阻");
  });

  it("整构造总热阻不再统一说成「整墙」，屋面与装饰板不会被误称", () => {
    const text = renderAllowedFactsForModel({
      query: { filters: [] } as never, canonicalAnswers: [],
      candidates: [{ id: "c1", totalThermalResistance: 3.297, productThermalResistance: 2.88, kValue: 0.303 }]
    } as never);
    expect(text).toContain("整构造总热阻 R₀=3.297");
    expect(text).not.toContain("整墙");
  });
});
