import { describe, expect, it } from "vitest";
import {
  FORMULA_VERSION,
  calculateThermal,
  judgeCompliance,
  roundBy,
  type CalcLayer,
  type ResolvedRules
} from "./thermal-calculator.js";

/** 规则样例（数值仅供测试，正式数据必须由后台配置审核发布） */
const rules: ResolvedRules = {
  ruleId: "rule-1",
  ruleVersion: 1,
  ruleCode: "DEFAULT",
  formulaVersion: FORMULA_VERSION,
  interiorSurfaceResistance: 0.11,
  exteriorSurfaceResistance: 0.04,
  precision: 4,
  roundingMode: "HALF_UP",
  compareField: "K_VALUE",
  compareOperator: "LTE",
  includeNonProductLayers: true,
  includeSurfaceResistances: true
};

/** VICP 产品层 + 钢筋混凝土基层（层序外到内，基层最内） */
const layers: CalcLayer[] = [
  {
    layerOrder: 1, layerType: "PRODUCT_LAYER", layerName: "VICP 真空绝热复合板",
    materialId: "mat-vicp", thicknessM: 0.04, lambda: 0.024, correctionFactor: 1.05, evidenceRef: "P12"
  },
  {
    layerOrder: 2, layerType: "BASE_LAYER", layerName: "钢筋混凝土基层",
    materialId: "mat-concrete", thicknessM: 0.2, lambda: 1.74, correctionFactor: 1, evidenceRef: "P12"
  }
];

describe("roundBy 取整（确定性）", () => {
  it("HALF_UP 四舍五入并校正浮点表示误差", () => {
    expect(roundBy(1.005, 2, "HALF_UP")).toBe(1.01);
    expect(roundBy(2.5, 0, "HALF_UP")).toBe(3);
    expect(roundBy(0.539887, 4, "HALF_UP")).toBe(0.5399);
  });

  it("HALF_EVEN 银行家舍入：0.5 进偶", () => {
    expect(roundBy(2.5, 0, "HALF_EVEN")).toBe(2);
    expect(roundBy(3.5, 0, "HALF_EVEN")).toBe(4);
    expect(roundBy(2.51, 0, "HALF_EVEN")).toBe(3);
  });

  it("TRUNCATE 截断与 NONE 不取整", () => {
    expect(roundBy(1.239, 2, "TRUNCATE")).toBe(1.23);
    expect(roundBy(1.239, 2, "NONE")).toBe(1.239);
  });
});

describe("LAYERED 分层法", () => {
  it("逐层热阻汇总 + 表面换热阻，K = 1/总热阻", () => {
    const result = calculateThermal({ mode: "LAYERED", rules, layers, standardLimit: { limitKValue: 0.6 } });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    // 产品层：0.04 / (0.024 × 1.05) = 1.587301587...
    expect(result.productResistance).toBeCloseTo(0.04 / (0.024 * 1.05), 10);
    // 基层：0.2 / 1.74 = 0.114942528...
    // 总热阻 = 产品层 + 基层 + 0.11 + 0.04
    expect(result.totalResistance).toBeCloseTo(0.04 / (0.024 * 1.05) + 0.2 / 1.74 + 0.15, 10);
    expect(result.kValue).toBeCloseTo(1 / result.totalResistance!, 10);

    expect(result.totalResistanceRounded).toBe(1.8522);
    expect(result.kValueRounded).toBe(0.5399);
    // K = 0.5399 ≤ 0.6 → 合格
    expect(result.compliant).toBe(true);
    expect(result.limitKValue).toBe(0.6);
  });

  it("步骤快照包含每层与汇总，公式族为 VICP-CALC-1", () => {
    const result = calculateThermal({ mode: "LAYERED", rules, layers });
    expect(result.steps.map((s) => s.key)).toEqual(["layer_1", "layer_2", "total_resistance", "k_value"]);
    expect(result.formulas.layerResistance).toBe("R = δ / (λ × a)");
    expect(result.formulas.kValue).toBe("K = 1 / R_total");
  });
});

describe("EQUIVALENT 整体当量法", () => {
  it("产品层按当量导热系数与修正系数整体计算，其余层分层并入", () => {
    const result = calculateThermal({
      mode: "EQUIVALENT",
      rules,
      layers,
      equivalentParams: { conductivity: 0.023, correctionFactor: 1 },
      standardLimit: { limitKValue: 0.5 }
    });

    expect(result.valid).toBe(true);
    // 产品层：0.04 / (0.023 × 1) = 1.739130435
    expect(result.productResistance).toBeCloseTo(0.04 / 0.023, 10);
    // 总热阻 = 1.739130435 + 0.114942529 + 0.15 = 2.004072964
    expect(result.totalResistance).toBeCloseTo(0.04 / 0.023 + 0.2 / 1.74 + 0.15, 10);
    expect(result.kValueRounded).toBe(0.499);
    // K = 0.499 ≤ 0.5 → 合格
    expect(result.compliant).toBe(true);
  });

  it("includeNonProductLayers=false 时仅产品层 + 表面换热阻", () => {
    const result = calculateThermal({
      mode: "EQUIVALENT",
      rules: { ...rules, includeNonProductLayers: false },
      layers,
      equivalentParams: { conductivity: 0.023, correctionFactor: 1 }
    });
    expect(result.totalResistance).toBeCloseTo(0.04 / 0.023 + 0.15, 10);
  });

  it("includeSurfaceResistances=false 时不并入表面换热阻", () => {
    const result = calculateThermal({
      mode: "EQUIVALENT",
      rules: { ...rules, includeSurfaceResistances: false },
      layers,
      equivalentParams: { conductivity: 0.023, correctionFactor: 1 }
    });
    expect(result.totalResistance).toBeCloseTo(0.04 / 0.023 + 0.2 / 1.74, 10);
  });
});

describe("合格判定", () => {
  it("K_VALUE + LTE：K 值不大于限值", () => {
    expect(judgeCompliance(0.5399, 0.54, "K_VALUE", "LTE")).toBe(true);
    expect(judgeCompliance(0.54, 0.54, "K_VALUE", "LTE")).toBe(true);
    expect(judgeCompliance(0.5401, 0.54, "K_VALUE", "LTE")).toBe(false);
  });

  it("TOTAL_RESISTANCE + GTE：总热阻不小于限值", () => {
    expect(judgeCompliance(1.5, 1.5, "TOTAL_RESISTANCE", "GTE")).toBe(true);
    expect(judgeCompliance(1.49, 1.5, "TOTAL_RESISTANCE", "GTE")).toBe(false);
  });

  it("判定基于取整后的展示值", () => {
    const result = calculateThermal({
      mode: "LAYERED", rules: { ...rules, precision: 2 },
      layers, standardLimit: { limitKValue: 0.55 }
    });
    // 未取整 K ≈ 0.53989 ≤ 0.55，取整后 0.54 ≤ 0.55，均合格
    expect(result.compliant).toBe(true);
  });
});

describe("字段级错误（不吞信息）", () => {
  it("产品层厚度为 0 报字段错误且不计算", () => {
    const badLayers = [{ ...layers[0]!, thicknessM: 0 }, layers[1]!];
    const result = calculateThermal({ mode: "LAYERED", rules, layers: badLayers });
    expect(result.valid).toBe(false);
    expect(result.kValue).toBeNull();
    expect(result.errors.some((e) => e.field === "layers[1].thicknessM")).toBe(true);
  });

  it("LAYERED 缺少层导热系数报字段错误", () => {
    const badLayers = [{ ...layers[0]!, lambda: null }, layers[1]!];
    const result = calculateThermal({ mode: "LAYERED", rules, layers: badLayers });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "layers[1].lambda")).toBe(true);
  });

  it("EQUIVALENT 缺少当量参数报字段错误", () => {
    const result = calculateThermal({ mode: "EQUIVALENT", rules, layers });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "equivalentParams" && e.code === "CALC_PARAM_MISSING")).toBe(true);
  });

  it("不支持的公式版本与非法精度报规则错误", () => {
    const result = calculateThermal({
      mode: "LAYERED",
      rules: { ...rules, formulaVersion: "LEGACY-99", precision: 9 },
      layers
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "rules.formulaVersion")).toBe(true);
    expect(result.errors.some((e) => e.field === "rules.precision")).toBe(true);
  });
});

describe("确定性（验收：相同输入与版本产生稳定相同结果）", () => {
  it("同输入两次计算 JSON 完全一致", () => {
    const input = { mode: "LAYERED" as const, rules, layers, standardLimit: { limitKValue: 0.6 } };
    const a = calculateThermal(input);
    const b = calculateThermal(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("EQUIVALENT 同输入两次计算 JSON 完全一致", () => {
    const input = {
      mode: "EQUIVALENT" as const,
      rules,
      layers,
      equivalentParams: { conductivity: 0.023, correctionFactor: 1.05 },
      standardLimit: { limitKValue: 0.5 }
    };
    expect(JSON.stringify(calculateThermal(input))).toBe(JSON.stringify(calculateThermal(input)));
  });
});