import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { executeThermalCalc } from "./thermal-calc.service.js";

/** drizzle 链式最小桩（同 thermal-workflow.test.ts）：rows 按调用顺序消耗 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): {
  db: any;
  insertCalls: Array<unknown>;
} {
  let i = 0;
  const insertCalls: unknown[] = [];
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    returning: async () => next(),
    orderBy: () => chain(),
    offset: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    }),
    update: () => ({
      set: () => ({ where: () => chain() })
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push(values);
        return { returning: async () => next(), then: (resolve: (v: unknown) => void) => Promise.resolve(next()).then(resolve) };
      }
    }),
    delete: () => ({
      where: () => chain()
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };
  return { db, insertCalls };
}

const actor = { id: "u-1", role: "SUPER_ADMIN", permissionCodes: [] } as any;
const request = { ip: "127.0.0.1", headers: {}, id: "req-1" } as FastifyRequest;
const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const schemeRow = {
  id: "scheme-1", systemId: "sys-1", schemeCode: "A1-1", version: 1, name: "方案 A1-1",
  substrateMaterial: "混凝土", substrateThickness: 200, status: "PUBLISHED", effectiveAt: null, expiresAt: null
};
const productLayerRow = {
  id: "layer-p", schemeId: "scheme-1", layerOrder: 1, layerType: "PRODUCT_LAYER",
  layerName: "岩棉板保温层", materialId: "mat-prod", thickness: null,
  evidenceSource: "图集 X", evidenceRef: "P8", evidenceLevel: "A"
};
const baseLayerRow = {
  id: "layer-b", schemeId: "scheme-1", layerOrder: 2, layerType: "BASE_LAYER",
  layerName: "基层墙体", materialId: "mat-base", thickness: 20,
  evidenceSource: "图集 X", evidenceRef: "P8", evidenceLevel: "A"
};
const optionRow = {
  id: "opt-1", schemeId: "scheme-1", productSpecId: "spec-1", minThickness: 10, maxThickness: 50, defaultThickness: 20
};
const ruleRow = {
  id: "rule-1", code: "VICP-CALC-1", version: 1, name: "VICP 通用热工计算规则", formulaVersion: "VICP-CALC-1",
  interiorSurfaceResistance: 0.11, exteriorSurfaceResistance: 0.04, precision: 4, roundingMode: "HALF_UP",
  compareField: "K_VALUE", compareOperator: "LTE", includeNonProductLayers: true, includeSurfaceResistances: true,
  parameterCodes: { equivalentConductivity: "lambda_eq", correctionFactor: "a_eq" },
  paramSourcePriority: [], usage: null, evidenceSource: "VICP 公式表", evidenceRef: "P1", evidenceLevel: "A",
  status: "PUBLISHED", effectiveAt: null, expiresAt: null
};
const limitRow = {
  id: "limit-1", regionCode: "310000", version: 1, regionName: "上海", basisCode: "GB50176-2016",
  basisName: "民用建筑热工设计规范", clauseRef: "3.2.1", limitKValue: 0.6,
  evidenceSource: "GB50176-2016", evidenceRef: "表3.2.1", evidenceLevel: "A",
  status: "PUBLISHED", effectiveAt: null, expiresAt: null
};
const matProd = {
  id: "mp-1", materialId: "mat-prod", version: 2, thermalConductivity: 0.03, correctionFactor: 1.2,
  evidenceSource: "图集 X", evidenceRef: "P12", evidenceLevel: "A", status: "PUBLISHED"
};
const matBase = {
  id: "mb-1", materialId: "mat-base", version: 1, thermalConductivity: 0.93, correctionFactor: null,
  evidenceSource: "图集 X", evidenceRef: "P13", evidenceLevel: "A", status: "PUBLISHED"
};

const calcInput = {
  mode: "LAYERED" as const,
  schemeId: "scheme-1",
  productSpecId: "spec-1",
  thicknessMm: 20,
  regionCode: "310000",
  ruleCode: "VICP-CALC-1",
  projectId: null
};

/** 完整 LAYERED 快照记录（returning 行） */
function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1", requestId: "req-1", mode: "LAYERED", projectId: null,
    ruleId: "rule-1", ruleVersion: 1, standardLimitId: "limit-1", limitVersion: 1,
    inputJson: calcInput, layersJson: [], parametersJson: [], ruleJson: null, standardJson: null,
    formulaJson: {}, stepsJson: [], resultJson: {}, createdById: "u-1", createdAt: new Date(),
    ...overrides
  };
}

describe("executeThermalCalc LAYERED 分层法", () => {
  it("已发布取数完整：计算成功、快照落库、审计写入、判定正确", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],                                // 1. 方案
      [productLayerRow, baseLayerRow],            // 2. 构造层
      [optionRow],                                // 3. 产品选项
      [],                                         // 4. 方案文档
      [ruleRow],                                  // 5. 已发布规则
      [],                                         // 5b. STANDARD_LIMIT facts
      [limitRow],                                 // 6. 已发布限值 fallback
      [],                                         // 7b. MATERIAL facts (产品层)
      [matProd],                                  // 7. 产品层材料参数 fallback
      [],                                         // 8b. MATERIAL facts (基层)
      [matBase],                                  // 8. 基层材料参数 fallback
      [recordRow()],                              // 9. 记录 insert returning
      []                                          // 10. 审计 insert
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, calcInput);

    expect(execution.valid).toBe(true);
    expect(execution.errors).toEqual([]);
    expect(execution.record).toMatchObject({ id: "rec-1", mode: "LAYERED" });

    const record = insertCalls[0] as Record<string, unknown>;
    // 入参快照
    expect(record.inputJson).toMatchObject({ mode: "LAYERED", schemeId: "scheme-1", thicknessMm: 20, regionCode: "310000" });
    // 构造层快照：产品层厚度取输入值（mm→m），基层取方案厚度
    const layers = record.layersJson as Array<Record<string, unknown>>;
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ layerType: "PRODUCT_LAYER", thicknessM: 0.02, lambda: 0.03, correctionFactor: 1.2 });
    expect(layers[1]).toMatchObject({ layerType: "BASE_LAYER", thicknessM: 0.02, lambda: 0.93, correctionFactor: null });
    // 参数快照：材料 id+version+来源
    const parameters = record.parametersJson as Array<Record<string, unknown>>;
    expect(parameters).toHaveLength(2);
    expect(parameters[0]).toMatchObject({ id: "mp-1", version: 2, materialId: "mat-prod", evidenceRef: "P12" });
    // 规则 / 标准快照
    expect(record.ruleJson).toMatchObject({ code: "VICP-CALC-1", formulaVersion: "VICP-CALC-1", precision: 4 });
    expect(record.standardJson).toMatchObject({ regionCode: "310000", clauseRef: "3.2.1", limitKValue: 0.6 });
    // 公式与步骤快照
    expect(record.formulaJson).toMatchObject({ layerResistance: "R = δ / (λ × a)", kValue: "K = 1 / R_total" });
    const steps = record.stepsJson as Array<Record<string, unknown>>;
    expect(steps.some((s) => s.key === "total_resistance")).toBe(true);
    expect(steps.some((s) => s.key === "k_value")).toBe(true);
    expect(steps.some((s) => s.key === "judgment")).toBe(true);
    // 结果：R = 0.02/(0.03×1.2) + 0.02/(0.93×1) + 0.15 = 0.7271；K = 1.3754 > 限值 0.6 → 不合格
    const result = record.resultJson as Record<string, unknown>;
    expect(result).toMatchObject({ valid: true, kValueRounded: 1.3754, totalResistanceRounded: 0.7271, compliant: false, limitKValue: 0.6 });

    // 审计：同事务写入计算动作
    const audit = insertCalls.at(-1) as Record<string, unknown>;
    expect(audit.action).toBe("thermal.calc_executed");
    expect(audit.targetType).toBe("thermal_calc_record");
    expect(audit.afterJson).toMatchObject({ mode: "LAYERED", kValue: 1.3754, compliant: false });
  });

  it("产品厚度超出方案允许区间 → 字段级错误且不落库", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [{ ...optionRow, minThickness: 30, maxThickness: 50 }],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, { ...calcInput, thicknessMm: 20 });
    expect(execution.valid).toBe(false);
    expect(execution.errors[0]).toMatchObject({ field: "thicknessMm", code: "CALC_THICKNESS_OUT_OF_RANGE" });
    expect(execution.record).toBeNull();
    expect(insertCalls).toHaveLength(0);
  });

  it("产品规格不在方案选项内 → CALC_OPTION_MISSING", async () => {
    const { db } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [{ ...optionRow, productSpecId: "spec-other" }],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, calcInput);
    expect(execution.valid).toBe(false);
    expect(execution.errors[0]).toMatchObject({ field: "productSpecId", code: "CALC_OPTION_MISSING" });
  });

  it("无已发布标准限值 → 计算成功但 compliant=null，提示判定暂缺", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [ruleRow],
      [],        // STANDARD_LIMIT facts
      [],        // 限值查询无结果
      [],        // MATERIAL facts
      [matProd],
      [],        // MATERIAL facts
      [matBase],
      [recordRow({ standardLimitId: null, limitVersion: null })],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, calcInput);
    expect(execution.valid).toBe(true);
    expect(execution.notes).toEqual(expect.arrayContaining([expect.stringContaining("没有已发布且生效中的标准限值")]));
    const result = (insertCalls[0] as Record<string, unknown>).resultJson as Record<string, unknown>;
    expect(result.compliant).toBeNull();
    expect(result.limitKValue).toBeNull();
    expect((insertCalls[0] as Record<string, unknown>).standardJson).toBeNull();
  });

  it("构造层材料缺少已发布参数版本 → CALC_PARAM_MISSING，不落库", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [ruleRow],
      [],        // STANDARD_LIMIT facts
      [limitRow],
      [],        // MATERIAL facts
      [matProd],
      [],        // MATERIAL facts (基层)
      []         // 基层材料参数缺失
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, calcInput);
    expect(execution.valid).toBe(false);
    expect(execution.errors.some((e) => e.code === "CALC_PARAM_MISSING")).toBe(true);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("executeThermalCalc EQUIVALENT 整体当量法", () => {
  const equivalentInput = { ...calcInput, mode: "EQUIVALENT" as const };

  it("无已发布规则 → THERMAL_CALC_RULE_NOT_PUBLISHED，拒绝自行计算", async () => {
    const { db } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      []   // 规则查询无结果
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, equivalentInput);
    expect(execution.valid).toBe(false);
    expect(execution.errors[0]).toMatchObject({ field: "ruleCode", code: "THERMAL_CALC_RULE_NOT_PUBLISHED" });
  });

  it("按规则 parameterCodes 取当量参数并计算（paramSourcePriority 优先于版本）", async () => {
    const priorityRule = {
      ...ruleRow,
      paramSourcePriority: ["TEST", "LAB"],
      usage: "THERMAL_CALC"
    };
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [priorityRule],
      [],   // STANDARD_LIMIT facts
      [],   // 无限值 → compliant null
      [],   // MATERIAL facts
      [matProd],
      [],   // MATERIAL facts
      [matBase],
      [],   // THERMAL_PARAMETER facts (当量导热系数)
      // 当量导热系数：TEST 来源 version 1 命中优先级，优先于 LAB version 3
      [
        { id: "p-lambda-lab", specId: "spec-1", parameterCode: "lambda_eq", parameterName: "当量导热系数", paramSource: "LAB", version: 3, value: 0.045, unit: "W/(m·K)", evidenceSource: "检测报告", evidenceRef: "R1", evidenceLevel: "B" },
        { id: "p-lambda-test", specId: "spec-1", parameterCode: "lambda_eq", parameterName: "当量导热系数", paramSource: "TEST", version: 1, value: 0.03, unit: "W/(m·K)", evidenceSource: "企业实测", evidenceRef: "T1", evidenceLevel: "C" }
      ],
      [],   // THERMAL_PARAMETER facts (修正系数)
      [
        { id: "p-a-lab", specId: "spec-1", parameterCode: "a_eq", parameterName: "修正系数", paramSource: "LAB", version: 3, value: 1.1, unit: null, evidenceSource: "检测报告", evidenceRef: "R2", evidenceLevel: "B" },
        { id: "p-a-test", specId: "spec-1", parameterCode: "a_eq", parameterName: "修正系数", paramSource: "TEST", version: 1, value: 1.2, unit: null, evidenceSource: "企业实测", evidenceRef: "T2", evidenceLevel: "C" }
      ],
      [recordRow({ mode: "EQUIVALENT", standardLimitId: null, limitVersion: null })],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, equivalentInput);

    expect(execution.valid).toBe(true);
    const record = insertCalls[0] as Record<string, unknown>;
    // 参数快照应包含当量参数（TEST 来源被选中），与材料参数合并
    const parameters = record.parametersJson as Array<Record<string, unknown>>;
    expect(parameters.some((p) => p.parameterCode === "lambda_eq" && p.paramSource === "TEST" && p.value === 0.03)).toBe(true);
    expect(parameters.some((p) => p.parameterCode === "a_eq" && p.paramSource === "TEST" && p.value === 1.2)).toBe(true);
    // 产品层快照写入当量参数：R = 0.02/(0.03×1.2) = 0.5556，加上基层 0.0215 与表面换热阻 0.15
    const result = record.resultJson as Record<string, unknown>;
    expect(result).toMatchObject({ valid: true, kValueRounded: 1.3754, totalResistanceRounded: 0.7271, compliant: null });
    const layers = record.layersJson as Array<Record<string, unknown>>;
    expect(layers[0]).toMatchObject({ layerType: "PRODUCT_LAYER", lambda: 0.03, correctionFactor: 1.2 });
  });

  it("当量参数缺失 → CALC_PARAM_MISSING，不落库", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [ruleRow],
      [],   // STANDARD_LIMIT facts
      [limitRow],
      [],   // MATERIAL facts
      [matProd],
      [],   // MATERIAL facts
      [matBase],
      [],   // THERMAL_PARAMETER facts
      [],   // 当量导热系数无结果
      [],   // THERMAL_PARAMETER facts
      []    // 修正系数无结果
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, equivalentInput);
    expect(execution.valid).toBe(false);
    expect(execution.errors[0]).toMatchObject({ field: "equivalentParams", code: "CALC_PARAM_MISSING" });
    expect(insertCalls).toHaveLength(0);
  });
});

describe("executeThermalCalc REFERENCE_TABLE 图集查表", () => {
  const refInput = { ...calcInput, mode: "REFERENCE_TABLE" as const };
  const refRow = {
    id: "row-1", setId: "set-1", schemeId: "scheme-1", productSpecId: "spec-1", thicknessMm: 20,
    productThermalResistance: 0.5556, totalThermalResistance: 0.7271, kValue: 1.3754,
    rawThickness: "20mm", rawProductResistance: "0.5556", rawTotalResistance: "0.7271", rawKValue: "1.3754",
    evidenceSource: "图集 X", evidenceRef: "P20", evidenceLevel: "A"
  };

  it("精确匹配已发布图集行 → 返回候选并判定，不重复计算", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [ruleRow],
      [],   // STANDARD_LIMIT facts
      [limitRow],
      [{ id: "set-1", code: "ATLAS-2026", version: 1, name: "图集 X", status: "PUBLISHED" }],  // 已发布集
      [{ setId: "set-1" }],   // 行级过滤匹配
      [refRow],               // 精确行 (scheme, spec, 20mm)
      [recordRow({ mode: "REFERENCE_TABLE" })],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, refInput);

    expect(execution.valid).toBe(true);
    const record = insertCalls[0] as Record<string, unknown>;
    expect(record.formulaJson).toMatchObject({ note: "直接读取已发布图集参考行，不重复计算" });
    expect(record.layersJson).toEqual([]);
    const result = record.resultJson as Record<string, unknown>;
    const candidates = result.candidates as Array<Record<string, unknown>>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      setCode: "ATLAS-2026", thicknessMm: 20, kValue: 1.3754, kValueRounded: 1.3754,
      evidenceSource: "图集 X", evidenceRef: "P20", compliant: false
    });
    expect(result.compliant).toBe(false);
  });

  it("无精确匹配行 → 空候选 + 提示禁止插值，仍落库（结果可追溯）", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [ruleRow],
      [],   // STANDARD_LIMIT facts
      [limitRow],
      [{ id: "set-1", code: "ATLAS-2026", version: 1, name: "图集 X", status: "PUBLISHED" }],
      [{ setId: "set-1" }],
      [],   // 无 25mm 精确行
      [recordRow({ mode: "REFERENCE_TABLE" })],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, { ...refInput, thicknessMm: 25 });

    expect(execution.valid).toBe(true);
    expect(execution.notes).toEqual(expect.arrayContaining([expect.stringContaining("禁止插值")]));
    const result = (insertCalls[0] as Record<string, unknown>).resultJson as Record<string, unknown>;
    expect(result.candidates).toEqual([]);
    expect(result.compliant).toBeNull();
  });

  it("无已发布参考集（含该方案/规格）→ 空候选 + 提示，无规则也可查表", async () => {
    const { db, insertCalls } = makeDb([
      [schemeRow],
      [productLayerRow, baseLayerRow],
      [optionRow],
      [],
      [],   // 规则查询无结果：REFERENCE_TABLE 允许无规则查表
      [],   // STANDARD_LIMIT facts
      [limitRow],
      [],   // 已发布集为空
      [],   // 无匹配行查询（setIds 空则跳过，不消耗行）
      [recordRow({ mode: "REFERENCE_TABLE", ruleId: null, ruleVersion: null })],
      []
    ]);
    const execution = await executeThermalCalc(app(db), request, actor, refInput);
    expect(execution.valid).toBe(true);
    expect(execution.notes.some((n) => n.includes("精确匹配行"))).toBe(true);
    const result = (insertCalls[0] as Record<string, unknown>).resultJson as Record<string, unknown>;
    expect(result.candidates).toEqual([]);
    expect(result.compliant).toBeNull();
  });
});