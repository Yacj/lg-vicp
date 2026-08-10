import { describe, expect, it } from "vitest";
import {
  type CandidateRow,
  evaluateConditions,
  matchThermalCandidates
} from "./thermal-candidate-matcher.js";

/** fixture：钢筋混凝土基层 200mm 方案（system S1）+ I/II 型规格 + 已发布厚度档 */
function makeRow(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    rowId: "row-1",
    setId: "set-1",
    setCode: "ATLAS-2024",
    setVersion: 2,
    setPriority: 0,
    setBuildingTypes: ["住宅", "公共建筑"],
    schemeId: "scheme-a",
    schemeCode: "A1-1",
    schemeVersion: 1,
    systemId: "system-s1",
    systemCode: "EW-EXT",
    systemName: "外墙外保温系统",
    substrateMaterial: "钢筋混凝土",
    substrateThickness: 200,
    atlasPage: "P12",
    productSpecId: "spec-i",
    specCode: "VICP-I-20",
    specVersion: 1,
    specClass: "I",
    thicknessMm: 20,
    productThermalResistance: 1.2,
    totalThermalResistance: 3.8,
    kValue: 0.32,
    evidenceSource: "《VICP外墙保温系统建筑构造图集》",
    evidenceRef: "P12 表3",
    ...overrides
  };
}

/** scheme A + I 型规格的厚度档序列：20/25/30/35mm */
const baseRows: CandidateRow[] = [
  makeRow({ rowId: "row-20", thicknessMm: 20, totalThermalResistance: 3.8, kValue: 0.32 }),
  makeRow({ rowId: "row-25", thicknessMm: 25, totalThermalResistance: 4.2, kValue: 0.25 }),
  makeRow({ rowId: "row-30", thicknessMm: 30, totalThermalResistance: 4.6, kValue: 0.22 }),
  makeRow({ rowId: "row-35", thicknessMm: 35, totalThermalResistance: 5.0, kValue: 0.19 })
];

describe("候选条件三态判定 evaluateConditions", () => {
  it("基层文本双向包含匹配（容忍 200mm钢筋混凝土 写法）", () => {
    const row = baseRows[0]!;
    const state = evaluateConditions(row, { substrateMaterial: "200mm钢筋混凝土" });
    expect(state.matched).toContain("substrateMaterial");
    expect(state.unmatched).toHaveLength(0);
  });

  it("基层厚度 ±0.5mm 命中，不符则未命中", () => {
    expect(evaluateConditions(baseRows[0]!, { substrateThickness: 200.4 }).matched).toContain("substrateThickness");
    expect(evaluateConditions(baseRows[0]!, { substrateThickness: 250 }).unmatched).toContain("substrateThickness");
  });

  it("基层厚度缺失（方案未填）标注 missing 而不排除", () => {
    const state = evaluateConditions({ ...baseRows[0]!, substrateThickness: null }, { substrateThickness: 200 });
    expect(state.missing).toContain("substrateThickness");
    expect(state.unmatched).toHaveLength(0);
  });

  it("buildingType 未配置（集数组为空）标注 missing", () => {
    const state = evaluateConditions({ ...baseRows[0]!, setBuildingTypes: [] }, { buildingType: "住宅" });
    expect(state.missing).toContain("buildingType");
  });

  it("K 值条件：kValue <= targetK 命中", () => {
    expect(evaluateConditions(baseRows[0]!, { targetK: 0.32 }).matched).toContain("targetK");
    expect(evaluateConditions(baseRows[0]!, { targetK: 0.25 }).unmatched).toContain("targetK");
  });

  it("热阻条件：totalThermalResistance >= target 命中", () => {
    expect(evaluateConditions(baseRows[1]!, { targetResistance: 4.2 }).matched).toContain("targetResistance");
    expect(evaluateConditions(baseRows[1]!, { targetResistance: 4.3 }).unmatched).toContain("targetResistance");
  });
});

describe("验收 1：200mm 钢筋混凝土、Ⅰ型 VICP、K≤0.25 返回 25mm 及以上匹配行", () => {
  it("精确返回 25/30/35 三档，20mm 不满足 K 被排除", () => {
    const outcome = matchThermalCandidates(baseRows, {
      substrateMaterial: "200mm钢筋混凝土",
      substrateThickness: 200,
      specClass: "I",
      targetK: 0.25
    });
    expect(outcome.candidates.map((c) => c.result.thicknessMm)).toEqual([25, 30, 35]);
    expect(outcome.candidates.every((c) => c.matchType === "EXACT")).toBe(true);
    expect(outcome.candidates[0]!.matchedConditions).toEqual(
      expect.arrayContaining(["substrateMaterial", "substrateThickness", "specClass", "targetK"])
    );
  });

  it("候选携带方案/系统/规格/集/证据完整来源信息", () => {
    const outcome = matchThermalCandidates(baseRows, { specClass: "I", targetK: 0.25 });
    const c = outcome.candidates[0]!;
    expect(c.scheme).toMatchObject({ code: "A1-1", substrateMaterial: "钢筋混凝土", atlasPage: "P12" });
    expect(c.system).toMatchObject({ code: "EW-EXT" });
    expect(c.productSpec).toMatchObject({ specCode: "VICP-I-20", specClass: "I" });
    expect(c.set).toMatchObject({ code: "ATLAS-2024", version: 2 });
    expect(c.evidence).toMatchObject({ ref: "P12 表3" });
  });
});

describe("验收 2：条件不完整时返回宽泛候选与缺失标注，不伪造精确结论", () => {
  it("仅给基层材料：返回全部 4 档宽泛候选", () => {
    const outcome = matchThermalCandidates(baseRows, { substrateMaterial: "钢筋混凝土" });
    expect(outcome.candidates).toHaveLength(4);
    expect(outcome.candidates.every((c) => c.unmatchedConditions.length === 0)).toBe(true);
  });

  it("全部行基层厚度缺失时 globalMissingConditions 标注 substrateThickness", () => {
    const rows = baseRows.map((r) => ({ ...r, substrateThickness: null }));
    const outcome = matchThermalCandidates(rows, { substrateThickness: 200 });
    expect(outcome.globalMissingConditions).toContain("substrateThickness");
    expect(outcome.candidates.length).toBeGreaterThan(0);
  });

  it("全部集未配置建筑类型时 globalMissingConditions 标注 buildingType", () => {
    const rows = baseRows.map((r) => ({ ...r, setBuildingTypes: [] }));
    const outcome = matchThermalCandidates(rows, { buildingType: "住宅" });
    expect(outcome.globalMissingConditions).toContain("buildingType");
    expect(outcome.candidates).toHaveLength(4);
  });

  it("无任何条件：返回全部行（宽泛）", () => {
    const outcome = matchThermalCandidates(baseRows, {});
    expect(outcome.candidates).toHaveLength(4);
  });
});

describe("验收 3：无 22mm 标准档时返回相邻已发布规格或无结果", () => {
  it("neighborTolerance=1：返回 20/25mm 相邻档（gap=1），30mm 超出容差", () => {
    const outcome = matchThermalCandidates(baseRows, { thicknessMm: 22 });
    expect(outcome.candidates.map((c) => [c.result.thicknessMm, c.matchType, c.neighborGap])).toEqual([
      [20, "NEIGHBOR", 1],
      [25, "NEIGHBOR", 1]
    ]);
    expect(outcome.candidates[0]!.unmatchedConditions).toContain("thickness");
  });

  it("neighborTolerance=0：禁止相邻匹配，返回空候选", () => {
    const outcome = matchThermalCandidates(baseRows, { thicknessMm: 22 }, { neighborTolerance: 0 });
    expect(outcome.candidates).toHaveLength(0);
  });

  it("相邻档同样受其他条件约束（K 不满足的相邻档不返回）", () => {
    const outcome = matchThermalCandidates(baseRows, { thicknessMm: 22, targetK: 0.25 });
    expect(outcome.candidates.map((c) => c.result.thicknessMm)).toEqual([25]);
  });

  it("精确厚度有命中档时不产生相邻规格", () => {
    const outcome = matchThermalCandidates(baseRows, { thicknessMm: 25 });
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]).toMatchObject({ matchType: "EXACT", neighborGap: null });
  });

  it("区间查询不产生相邻规格，仅区间内行", () => {
    const outcome = matchThermalCandidates(baseRows, { thicknessMin: 25, thicknessMax: 30 });
    expect(outcome.candidates.map((c) => c.result.thicknessMm)).toEqual([25, 30]);
    expect(outcome.candidates.every((c) => c.matchType === "EXACT")).toBe(true);
  });
});

describe("排序规则（只按后台规则，不宣称最优）", () => {
  it("命中条件数降序：数据齐全的行排在数据缺失行之前", () => {
    const rows = [
      baseRows[1]!,
      { ...baseRows[1]!, rowId: "row-25-no-thickness", substrateThickness: null }
    ];
    const outcome = matchThermalCandidates(rows, { substrateThickness: 200, specClass: "I", targetK: 0.25 });
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates[0]!.matchedConditions.length).toBeGreaterThan(outcome.candidates[1]!.matchedConditions.length);
    expect(outcome.candidates[0]!.candidateId).toBe("row-25");
    expect(outcome.candidates[1]!.missingConditions).toContain("substrateThickness");
  });

  it("同条件厚度升序 → 集 priority 升序 → 集版本降序", () => {
    const rows = [
      // 同厚度 25mm：priority 0 的两行按版本降序（row-25c v3 先于 row-25 v2），priority 1 排后
      baseRows[1]!,
      { ...baseRows[1]!, rowId: "row-25b", setId: "set-2", setCode: "ATLAS-2023", setVersion: 9, setPriority: 1 },
      { ...baseRows[1]!, rowId: "row-25c", setId: "set-3", setCode: "ATLAS-2025", setVersion: 3, setPriority: 0 },
      // 厚度 30mm 同 priority/version：排在 25mm 之后
      baseRows[2]!
    ];
    const outcome = matchThermalCandidates(rows, {});
    expect(outcome.candidates.map((c) => c.candidateId)).toEqual(["row-25c", "row-25", "row-25b", "row-30"]);
  });

  it("EXACT 候选排在 NEIGHBOR 之前（混合场景）", () => {
    const rows = [
      ...baseRows,
      // scheme B 组：含 22mm 精确档
      { ...baseRows[1]!, rowId: "row-b-22", schemeId: "scheme-b", schemeCode: "B1-1", thicknessMm: 22, kValue: 0.26 },
      { ...baseRows[1]!, rowId: "row-b-26", schemeId: "scheme-b", schemeCode: "B1-1", thicknessMm: 26, kValue: 0.24 }
    ];
    const outcome = matchThermalCandidates(rows, { thicknessMm: 22 });
    expect(outcome.candidates[0]).toMatchObject({ candidateId: "row-b-22", matchType: "EXACT" });
    expect(outcome.candidates.slice(1).every((c) => c.matchType === "NEIGHBOR")).toBe(true);
  });
});