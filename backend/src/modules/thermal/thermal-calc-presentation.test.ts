import { describe, expect, it } from "vitest";
import { buildThermalCalcPresentation } from "./thermal-calc-presentation.js";

/**
 * 热工计算过程展示测试（P0-5）：
 * presentation 一律从冻结快照派生；数值来自计算器/图集参考数据，
 * 不暴露内部数据库 ID/debug 字段，历史记录展示不随后台参数漂移。
 */

describe("buildThermalCalcPresentation：EQUIVALENT/LAYERED", () => {
  const record = {
    mode: "EQUIVALENT",
    steps: [
      { key: "product_2", label: "产品层「VICP保温装饰板」整体当量热阻（当量导热系数 0.045 × 修正系数 1.05）", value: 0.5291005291, rounded: 0.5291, formula: "R = δ / (λ × a)" },
      { key: "layer_1", label: "构造层「水泥砂浆找平层」热阻（δ=0.02m，λ=0.93，a=1）", value: 0.02150537634, rounded: 0.0215, formula: "R = δ / (λ × a)" },
      { key: "total_resistance", label: "总热阻汇总", value: 0.5506059054, rounded: 0.5506, formula: "ΣR = ..." },
      { key: "k_value", label: "传热系数", value: 1.816197, rounded: 1.8162, formula: "K = 1 / ΣR" },
      { key: "judgment", label: "合格判定：K 值 ≤ 2.0 → 合格", value: 1.8162, rounded: 1.8162, formula: "K ≤ 限值" }
    ],
    layers: [
      { layerOrder: 1, layerType: "BASE_LAYER", layerName: "水泥砂浆找平层", materialId: "mat-1-internal", thicknessM: 0.02, lambda: 0.93, correctionFactor: 1, evidenceLevel: "A" },
      { layerOrder: 2, layerType: "PRODUCT_LAYER", layerName: "VICP保温装饰板", materialId: "mat-2-internal", thicknessM: 0.025, lambda: null, correctionFactor: null }
    ],
    standard: {
      basisCode: "DBJ50/T-428-2023", basisName: "居住建筑节能设计标准", clauseRef: "第4.2.1条", limitKValue: 2.0, evidenceLevel: "A"
    },
    result: { kValue: 1.816197, kValueRounded: 1.8162, compliant: true, limitKValue: 2.0, totalResistance: 0.5506, totalResistanceRounded: 0.5506 }
  };

  it("结果与限值来自 resultJson/standardJson 快照", () => {
    const presentation = buildThermalCalcPresentation(record);
    expect(presentation.mode).toBe("EQUIVALENT");
    expect(presentation.resultK).toBe(1.8162);
    expect(presentation.compliant).toBe(true);
    expect(presentation.limitKValue).toBe(2.0);
    expect(presentation.totalResistance).toBe(0.5506);
  });

  it("步骤带单位（K 值/热阻），判定步骤无单位", () => {
    const presentation = buildThermalCalcPresentation(record);
    const units = Object.fromEntries(presentation.steps.map((step) => [step.key, step.unit]));
    expect(units.k_value).toBe("W/(m²·K)");
    expect(units.total_resistance).toBe("(m²·K)/W");
    expect(units.product_2).toBe("(m²·K)/W");
    expect(units.judgment).toBeNull();
    // 步骤数值使用取整值
    expect(presentation.steps.find((step) => step.key === "k_value")?.value).toBe(1.8162);
  });

  it("分层展示不含内部 materialId，厚度 m → mm", () => {
    const presentation = buildThermalCalcPresentation(record);
    expect(presentation.layers).toHaveLength(2);
    const productLayer = presentation.layers[1]!;
    expect(productLayer.materialName).toBe("VICP保温装饰板");
    expect(productLayer.thicknessMm).toBeCloseTo(25);
    expect(JSON.stringify(presentation.layers)).not.toContain("mat-1-internal");
    expect(JSON.stringify(presentation)).not.toContain("materialId");
  });

  it("证据引用来自标准快照（basisName/clauseRef）", () => {
    const presentation = buildThermalCalcPresentation(record);
    expect(presentation.evidence).toMatchObject({
      title: "居住建筑节能设计标准",
      ref: "第4.2.1条",
      level: "A"
    });
  });
});

describe("buildThermalCalcPresentation：REFERENCE_TABLE", () => {
  it("查表结果取第一条候选（服务端已按集 priority 排序），证据来自参考行", () => {
    const record = {
      mode: "REFERENCE_TABLE",
      steps: [],
      layers: [],
      standard: { basisCode: "DBJ50/T-428-2023", clauseRef: "表4.2.1", limitKValue: 0.25 },
      result: {
        valid: true,
        candidates: [
          { kValue: 0.2321, kValueRounded: 0.2321, totalThermalResistance: 4.3, totalThermalResistanceRounded: 4.3, evidenceSource: "《VICP图集》", evidenceRef: "P12 表3", evidenceLevel: "A", compliant: true },
          { kValue: 0.196, kValueRounded: 0.196, evidenceSource: "《VICP图集》", evidenceRef: "P13 表3", evidenceLevel: "A", compliant: true }
        ],
        compliant: true
      }
    };
    const presentation = buildThermalCalcPresentation(record);
    expect(presentation.mode).toBe("REFERENCE_TABLE");
    expect(presentation.resultK).toBe(0.2321);
    expect(presentation.steps[0]).toMatchObject({ key: "reference_table", unit: "W/(m²·K)" });
    expect(presentation.evidence).toMatchObject({ title: "《VICP图集》", ref: "P12 表3" });
    expect(presentation.layers).toEqual([]);
  });

  it("空快照防御式解析：不产生 NaN，resultK/compliant 为 null", () => {
    const presentation = buildThermalCalcPresentation({ mode: "REFERENCE_TABLE", result: { candidates: [] }, standard: null });
    expect(presentation.resultK).toBeNull();
    expect(presentation.compliant).toBeNull();
    expect(presentation.steps).toHaveLength(1);
    expect(Number.isNaN(presentation.steps[0]!.value as number)).toBe(false);
  });
});
