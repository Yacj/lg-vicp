import { describe, expect, it } from "vitest";
import {
  FORMULA_VERSION,
  calculateThermal,
  layerResistance,
  roundBy,
  type CalcLayer,
  type ResolvedRules
} from "./thermal-calculator.js";

/**
 * 计算器边界与口径契约测试。
 *
 * 目的：把「单位、λ、α、表面换热阻、include 开关、缺 α、取整、合规阈值」这些
 * 容易被静默解释的边界固定成可执行契约，避免后续改动把错值算成「看起来合理」。
 *
 * 注意：本文件只测纯函数 calculator，不涉及已发布规则/快照。任何改变已发布口径的
 * 修改都必须先派生新 formulaVersion，不能靠改这里的期望值蒙混过关。
 */

const rules = (overrides: Partial<ResolvedRules> = {}): ResolvedRules => ({
  ruleId: "rule-boundary",
  ruleVersion: 1,
  ruleCode: "BOUNDARY",
  formulaVersion: FORMULA_VERSION,
  interiorSurfaceResistance: 0.11,
  exteriorSurfaceResistance: 0.04,
  precision: 8,
  roundingMode: "NONE",
  compareField: "K_VALUE",
  compareOperator: "LTE",
  includeNonProductLayers: true,
  includeSurfaceResistances: true,
  ...overrides
});

const layer = (overrides: Partial<CalcLayer> & Pick<CalcLayer, "layerOrder" | "layerType">): CalcLayer => ({
  layerName: `层${overrides.layerOrder}`,
  materialId: null,
  thicknessM: 0.02,
  lambda: 0.03,
  correctionFactor: 1,
  ...overrides
});

describe("单位契约：厚度只接受米，calculator 不做单位推断", () => {
  it("0.025m / (0.005 × 1.25) = 4.0（甲方 25mm 板）", () => {
    expect(layerResistance(layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.025, lambda: 0.005, correctionFactor: 1.25 })))
      .toBeCloseTo(4, 12);
  });

  it("同一数值按「25」传入会放大 1000 倍：调用方必须先做 mm→m", () => {
    // 这条断言的意义是固定「calculator 不猜单位」：错单位必须由 Service/前端换算保证，
    // 不能在 calculator 里按数值大小猜 mm 还是 m。
    expect(layerResistance(layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 25, lambda: 0.005, correctionFactor: 1.25 })))
      .toBeCloseTo(4000, 9);
  });

  it("极小厚度仍按原值计算，不设静默下限", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules(),
      layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.001, lambda: 0.0025, correctionFactor: 1.25 })]
    });
    expect(outcome.valid).toBe(true);
    expect(outcome.productResistance).toBeCloseTo(0.32, 12);
  });
});

describe("λ 边界", () => {
  const bad = (lambda: number | null) => calculateThermal({
    mode: "LAYERED",
    rules: rules(),
    layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", lambda })]
  });

  it("λ 缺失 → CALC_VALUE_INVALID（不按任何默认值兜底）", () => {
    const outcome = bad(null);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(expect.objectContaining({ field: "layers[1].lambda", code: "CALC_VALUE_INVALID" }));
    expect(outcome.kValue).toBeNull();
  });

  it("λ = 0 与 λ < 0 均拒绝", () => {
    for (const value of [0, -0.03]) {
      const outcome = bad(value);
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.some((e) => e.field === "layers[1].lambda")).toBe(true);
    }
  });

  it("EQUIVALENT 下产品层不要求 λ（用当量参数），但其余层仍要求", () => {
    const outcome = calculateThermal({
      mode: "EQUIVALENT",
      rules: rules(),
      layers: [
        layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", lambda: null, correctionFactor: null, thicknessM: 0.025 }),
        layer({ layerOrder: 2, layerType: "BASE_LAYER", lambda: null, thicknessM: 0.2 })
      ],
      equivalentParams: { conductivity: 0.005, correctionFactor: 1.25 }
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.some((e) => e.field === "layers[1].lambda")).toBe(false);
    expect(outcome.errors.some((e) => e.field === "layers[2].lambda")).toBe(true);
  });
});

describe("修正系数 α 边界", () => {
  it("α 缺失按 1 计算（已文档化的既有口径）", () => {
    expect(layerResistance(layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.02, lambda: 0.03, correctionFactor: null })))
      .toBeCloseTo(0.02 / 0.03, 12);
  });

  it("α = 0 与 α < 0 拒绝（不得把 0 当 1）", () => {
    for (const value of [0, -1.2]) {
      const outcome = calculateThermal({
        mode: "LAYERED",
        rules: rules(),
        layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", correctionFactor: value })]
      });
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.some((e) => e.field === "layers[1].correctionFactor")).toBe(true);
    }
  });

  it("α = 1.25 时 R 按 δ/(λ×1.25) 收缩（甲方口径）", () => {
    expect(layerResistance(layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.015, lambda: 0.0025, correctionFactor: 1.25 })))
      .toBeCloseTo(4.8, 12);
  });
});

describe("表面换热阻边界", () => {
  const baseLayers = [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.025, lambda: 0.005, correctionFactor: 1.25 })];

  it("Ri = Re = 0 合法，等价于不计表面换热阻", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules({ interiorSurfaceResistance: 0, exteriorSurfaceResistance: 0 }),
      layers: baseLayers
    });
    expect(outcome.valid).toBe(true);
    expect(outcome.totalResistance).toBeCloseTo(4, 12);
  });

  it("负的表面换热阻 → CALC_RULE_INVALID", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules({ exteriorSurfaceResistance: -0.04 }),
      layers: baseLayers
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toContainEqual(expect.objectContaining({ field: "rules.surfaceResistance", code: "CALC_RULE_INVALID" }));
  });

  it("Ri + Re 按规则原值并入 R₀，不四舍五入后再加", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules({ interiorSurfaceResistance: 0.115, exteriorSurfaceResistance: 0.043 }),
      layers: baseLayers
    });
    expect(outcome.totalResistance).toBeCloseTo(4 + 0.115 + 0.043, 12);
  });
});

describe("include* 两个开关的四种组合", () => {
  // 产品 15mm(λ0.0025,α1.25) = 4.8；固定层 10mm(λ0.08,α1.25) = 0.1；基层 200mm(λ1.87) = 0.106951871657754
  const layers = [
    layer({ layerOrder: 1, layerType: "FIXING_LAYER", thicknessM: 0.01, lambda: 0.08, correctionFactor: 1.25 }),
    layer({ layerOrder: 2, layerType: "PRODUCT_LAYER", thicknessM: 0.015, lambda: 0.0025, correctionFactor: 1.25 }),
    layer({ layerOrder: 3, layerType: "BASE_LAYER", thicknessM: 0.2, lambda: 1.87 })
  ];
  const product = 4.8;
  const fixing = 0.1;
  const base = 0.2 / 1.87;
  const surface = 0.11 + 0.04;

  const run = (includeNonProductLayers: boolean, includeSurfaceResistances: boolean) => calculateThermal({
    mode: "LAYERED",
    rules: rules({ includeNonProductLayers, includeSurfaceResistances }),
    layers
  });

  it("含非产品层 + 含表面热阻 = 全量", () => {
    const outcome = run(true, true);
    expect(outcome.totalResistance).toBeCloseTo(product + fixing + base + surface, 12);
    expect(outcome.productResistance).toBeCloseTo(product, 12);
  });

  it("不含非产品层 + 含表面热阻 = 产品层 + 表面热阻", () => {
    const outcome = run(false, true);
    expect(outcome.totalResistance).toBeCloseTo(product + surface, 12);
    // 关键契约：关闭非产品层不会把固定层算进「产品热阻」
    expect(outcome.productResistance).toBeCloseTo(product, 12);
  });

  it("含非产品层 + 不含表面热阻 = ΣR", () => {
    const outcome = run(true, false);
    expect(outcome.totalResistance).toBeCloseTo(product + fixing + base, 12);
  });

  it("两个开关都关 = 只有产品层", () => {
    const outcome = run(false, false);
    expect(outcome.totalResistance).toBeCloseTo(product, 12);
  });
});

describe("取整与合规阈值", () => {
  it("精度 0 与 8 合法，-1 与 9 报规则错误", () => {
    for (const precision of [0, 8]) {
      expect(calculateThermal({ mode: "LAYERED", rules: rules({ precision }), layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER" })] }).valid).toBe(true);
    }
    for (const precision of [-1, 9]) {
      const outcome = calculateThermal({ mode: "LAYERED", rules: rules({ precision }), layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER" })] });
      expect(outcome.valid).toBe(false);
      expect(outcome.errors.some((e) => e.field === "rules.precision")).toBe(true);
    }
  });

  it("NONE 保留原始值，中间过程不取整", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules({ precision: 4, roundingMode: "NONE" }),
      layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.025, lambda: 0.005, correctionFactor: 1.25 })]
    });
    expect(outcome.totalResistance).toBe(4.15);
    expect(outcome.totalResistanceRounded).toBe(4.15);
  });

  it("HALF_UP / HALF_EVEN / TRUNCATE 在同一数值上给出不同结果", () => {
    expect(roundBy(0.5555, 3, "HALF_UP")).toBe(0.556);
    expect(roundBy(0.5565, 3, "HALF_UP")).toBe(0.557);
    expect(roundBy(2.5, 0, "HALF_EVEN")).toBe(2);
    expect(roundBy(2.5, 0, "HALF_UP")).toBe(3);
    expect(roundBy(1.239, 2, "TRUNCATE")).toBe(1.23);
    // 浮点表示误差必须被 HALF_UP/TRUNCATE 校正，否则 0.1 会被截成 0.09
    expect(roundBy(0.09999999999999999, 2, "TRUNCATE")).toBe(0.1);
    expect(roundBy(1.005, 2, "HALF_UP")).toBe(1.01);
  });

  it("合规判定基于取整后的展示值：K=0.54002 取整为 0.54 时按 0.54 判定", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules({ precision: 4, roundingMode: "HALF_UP", compareField: "K_VALUE", compareOperator: "LTE" }),
      layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.042885, lambda: 0.024, correctionFactor: 1.05 })],
      standardLimit: { limitKValue: 0.54 }
    });
    expect(outcome.kValue!).toBeGreaterThan(0.54);
    expect(outcome.kValueRounded).toBe(0.54);
    // 这是既有报审口径（判定用展示值），必须被显式固定，不能被「更严格」的直觉悄悄改掉。
    expect(outcome.compliant).toBe(true);
  });

  it("TOTAL_RESISTANCE + GTE 按取整后的 R₀ 判定", () => {
    const layers = [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.025, lambda: 0.005, correctionFactor: 1.25 })];
    const atLimit = calculateThermal({
      mode: "LAYERED",
      rules: rules({ precision: 4, roundingMode: "HALF_UP", compareField: "TOTAL_RESISTANCE", compareOperator: "GTE" }),
      layers,
      standardLimit: { limitKValue: 4.15 }
    });
    expect(atLimit.totalResistanceRounded).toBe(4.15);
    expect(atLimit.compliant).toBe(true);

    const above = calculateThermal({
      mode: "LAYERED",
      rules: rules({ precision: 4, roundingMode: "HALF_UP", compareField: "TOTAL_RESISTANCE", compareOperator: "GTE" }),
      layers,
      standardLimit: { limitKValue: 4.1501 }
    });
    expect(above.compliant).toBe(false);
  });

  it("没有标准限值时不给合规结论（compliant=null）", () => {
    const outcome = calculateThermal({
      mode: "LAYERED",
      rules: rules(),
      layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER" })]
    });
    expect(outcome.compliant).toBeNull();
    expect(outcome.limitKValue).toBeNull();
    expect(outcome.steps.some((step) => step.key === "judgment")).toBe(false);
  });
});

describe("EQUIVALENT 多产品层不覆写前层结果", () => {
  it("两个产品层按厚度累加，等价于「产品总厚 / (λ_eq × a_eq)」", () => {
    const outcome = calculateThermal({
      mode: "EQUIVALENT",
      rules: rules(),
      layers: [
        layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.01, lambda: null, correctionFactor: null }),
        layer({ layerOrder: 2, layerType: "PRODUCT_LAYER", thicknessM: 0.015, lambda: null, correctionFactor: null })
      ],
      equivalentParams: { conductivity: 0.005, correctionFactor: 1.25 }
    });
    expect(outcome.valid).toBe(true);
    // 0.010/0.00625 + 0.015/0.00625 = 1.6 + 2.4 = 4.0（覆写实现会得到 2.4）
    expect(outcome.productResistance).toBeCloseTo(4, 12);
    expect(outcome.steps.filter((step) => step.key.startsWith("product_"))).toHaveLength(2);
    expect(outcome.totalResistance).toBeCloseTo(4 + 0.15, 12);
  });

  it("单产品层时累加与覆写结果完全一致（不影响已发布单层规则）", () => {
    const single = calculateThermal({
      mode: "EQUIVALENT",
      rules: rules(),
      layers: [layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thicknessM: 0.025, lambda: null, correctionFactor: null })],
      equivalentParams: { conductivity: 0.005, correctionFactor: 1.25 }
    });
    expect(single.productResistance).toBe(4);
    expect(single.totalResistance).toBe(4.15);
  });
});
