import { describe, expect, it } from "vitest";
import { parseThermalThicknessMessage } from "./thermal-lookup-thickness.js";
import {
  buildCandidateSorter,
  evaluateConditions,
  matchThermalCandidates,
  type CandidateRow
} from "./thermal-candidate-matcher.js";
import {
  DEFAULT_K_APPROX_TOLERANCE,
  inferThermalLookupMode,
  resolveConversationLookupMode,
  resolveKTolerance,
  normalizeThermalLookupQuery,
  parseThermalLookupMessage,
  resolveMetricTolerance,
  type ThermalLookupMode
} from "./thermal-lookup-mode.js";
import { thermalCandidateQuerySchema } from "./thermal-candidate.schemas.js";

describe("销售与设计院日常表达及厚度范围", () => {
  it.each([
    ["K控制在0.3以内", "K", 0.3, "MAX_LIMIT"],
    ["总热阻要达到3.3以上", "TOTAL_R", 3.3, "MIN_LIMIT"],
    ["总R要达到3.3以上", "TOTAL_R", 3.3, "MIN_LIMIT"],
    ["K在0.3左右", "K", 0.3, "APPROX"],
    ["产品层热阻大概2.9", "PRODUCT_R", 2.9, "APPROX"],
    ["产品R大概2.9", "PRODUCT_R", 2.9, "APPROX"],
    ["K要求0.3以下", "K", 0.3, "MAX_LIMIT"],
    ["传热系数做到0.3左右", "K", 0.3, "APPROX"],
    ["总热阻目标3.3", "TOTAL_R", 3.3, "APPROX"],
    ["总R达到3.3左右", "TOTAL_R", 3.3, "APPROX"],
    ["K最好不要超过0.3", "K", 0.3, "MAX_LIMIT"],
    ["K做到不超过0.3", "K", 0.3, "MAX_LIMIT"],
    ["总R做到不低于3.3", "TOTAL_R", 3.3, "MIN_LIMIT"]
  ] as const)("%s", (message, metric, targetValue, mode) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.filters).toMatchObject([{ metric, targetValue, mode }]);
  });

  it.each(["在", "控制在", "要求", "需要", "要", "要达到", "达到", "做到", "做到大概", "做到左右",
    "目标", "目标是", "希望", "希望做到", "最好", "尽量", "大概", "左右", "附近", "接近", "控制到"])("连接词 %s 不决定上下限", (bridge) => {
    const parsed = parseThermalLookupMessage(`K${bridge}0.3左右`);
    expect(parsed).toMatchObject({ needsClarification: false, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
  });

  it("保温系数不能由数值或模型猜测；明确单指标上下文才允许继承", () => {
    expect(parseThermalLookupMessage("这个保温系数做到0.3").needsClarification).toBe(true);
    expect(parseThermalLookupMessage("这个保温系数做到0.3", "K")).toMatchObject({ metric: "K", targetValue: 0.3, needsClarification: false });
    expect(parseThermalLookupMessage("最好不要超过0.3", "K")).toMatchObject({ metric: "K", targetValue: 0.3, filters: [{ mode: "MAX_LIMIT" }] });
  });

  it.each([
    ["18mm", { thicknessMm: 18 }],
    ["18毫米", { thicknessMm: 18 }],
    ["厚度18", { thicknessMm: 18 }],
    ["20mm以内", { thicknessMax: 20 }],
    ["不超过20mm", { thicknessMax: 20 }],
    ["最多20mm", { thicknessMax: 20 }],
    ["厚度控制在20以内", { thicknessMax: 20 }],
    ["最好别超过20mm", { thicknessMax: 20 }],
    ["18mm以上", { thicknessMin: 18 }],
    ["不低于18mm", { thicknessMin: 18 }],
    ["至少18mm", { thicknessMin: 18 }],
    ["18～25mm", { thicknessMin: 18, thicknessMax: 25 }],
    ["18-25mm", { thicknessMin: 18, thicknessMax: 25 }],
    ["18到25mm", { thicknessMin: 18, thicknessMax: 25 }],
    ["厚度18到25", { thicknessMin: 18, thicknessMax: 25 }]
  ])("%s", (message, query) => {
    const parsed = parseThermalThicknessMessage(message as string);
    expect(parsed).toMatchObject({ query, changed: true, needsClarification: false });
    if (!("thicknessMm" in query)) expect(parsed.query.thicknessMm).toBeUndefined();
  });

  it.each(["有没有薄一点的？", "尽量薄", "越薄越好"])("%s 不编造范围", (message) => {
    expect(parseThermalThicknessMessage(message)).toMatchObject({ query: {}, preferThinner: true, changed: false });
  });

  it.each(["K≤0.3且厚度18mm", "总R≥3.3且厚度18mm", "产品R≥2.9且厚度18mm", "PRODUCT_R>=2.9且厚度18mm"])("%s 指标比较词不能污染厚度", (message) => {
    expect(parseThermalThicknessMessage(message).query).toEqual({ thicknessMm: 18, thicknessMin: undefined, thicknessMax: undefined });
  });

  it("空格分隔数字不拼成一个目标值；K和厚度数字各自解析", () => {
    const message = "K0.3 20mm以内";
    expect(parseThermalLookupMessage(message).filters).toMatchObject([{ metric: "K", targetValue: 0.3, mode: "APPROX" }]);
    expect(parseThermalThicknessMessage(message).query).toMatchObject({ thicknessMax: 20 });
  });

  it("非法厚度区间与 OR 均澄清；范围匹配不能返回超限或不满足K/R的行", () => {
    expect(parseThermalThicknessMessage("厚度25到18").needsClarification).toBe(true);
    const filters = parseThermalLookupMessage("K不应大于0.3且总R不低于3.3").filters;
    const rows = [
      row({ rowId: "ok", thicknessMm: 20, kValue: 0.3, totalThermalResistance: 3.3 }),
      row({ rowId: "too-thick", thicknessMm: 25, kValue: 0.3, totalThermalResistance: 3.3 }),
      REAL_CASE
    ];
    expect(matchThermalCandidates(rows, { thicknessMax: 20, filters }).candidates.map((c) => c.candidateId)).toEqual(["ok"]);
  });
});

/**
 * REFERENCE_LOOKUP 查询语义收口回归（APPROX vs MAX_LIMIT）。
 *
 * 真实业务强制验收 Case（必须一直保住）：
 *   系统：I 型 VICP 薄抹灰外保温系统
 *   构造：A1-3
 *   基层：蒸压灰砂砖 240mm
 *   厚度：18mm
 *   产品层热阻 2.880 / 总热阻 3.297 / K = 0.303
 *
 * 关键断言：0.303 必须能命中「0.3 左右」（APPROX），但必须被「不超过 0.3」（MAX_LIMIT）排除。
 */

const REAL_CASE = {
  rowId: "row-a1-3",
  setId: "set-atlas",
  setCode: "ATLAS-2024",
  setVersion: 1,
  setPriority: 0,
  setBuildingTypes: ["住宅"],
  schemeId: "scheme-a1-3",
  schemeCode: "A1-3",
  schemeVersion: 1,
  systemId: "system-i",
  systemCode: "EW-I",
  systemName: "I 型 VICP 薄抹灰外保温系统",
  substrateMaterial: "蒸压灰砂砖",
  substrateThickness: 240,
  atlasPage: "P22",
  productSpecId: "spec-i-18",
  specCode: "VICP-I-18",
  specVersion: 1,
  specClass: "I" as const,
  thicknessMm: 18,
  productThermalResistance: 2.88,
  totalThermalResistance: 3.297,
  kValue: 0.303,
  evidenceSource: "《VICP 保温装饰板图集》",
  evidenceRef: "P22 选用表"
  ,sourcePageId: "page-22", sourcePageLabel: "22"
};

function row(overrides: Partial<CandidateRow>): CandidateRow {
  return { ...REAL_CASE, ...overrides };
}

/** 薄抹灰体系下的 4 个真实 K 档位（用于排序断言） */
const FOUR_LEVELS: CandidateRow[] = [
  row({ rowId: "k-302", thicknessMm: 18, kValue: 0.302, productSpecId: "s-302" }),
  row({ rowId: "k-303", thicknessMm: 18, kValue: 0.303, productSpecId: "s-303" }),
  row({ rowId: "k-305", thicknessMm: 18, kValue: 0.305, productSpecId: "s-305" }),
  row({ rowId: "k-294", thicknessMm: 18, kValue: 0.294, productSpecId: "s-294" })
];

describe("Test 1：APPROX 0.3 保留并优先 K=0.303", () => {
  it("K=0.303 落在 ±0.02 容差内，且是最接近目标的候选", () => {
    const outcome = matchThermalCandidates([row({})], { systemId: "system-i", targetK: 0.3, kMode: "APPROX" });
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]!.result.kValue).toBe(0.303);
    expect(outcome.candidates[0]!.matchedConditions).toContain("targetK");
    expect(outcome.candidates[0]!.ranking).toEqual({ kGap: 0.003, isClosestToTarget: true });
  });

  it("APPROX 不使用 kValue <= targetK 过滤（0.303 > 0.300 仍命中）", () => {
    const state = evaluateConditions(row({}), { targetK: 0.3, kMode: "APPROX" });
    expect(state.matched).toContain("targetK");
    expect(state.unmatched).not.toContain("targetK");
  });

  it("APPROX 有合理容差：0.55 不会因为「0.3 左右」被返回", () => {
    const outcome = matchThermalCandidates([row({ rowId: "k-55", kValue: 0.55 })], { targetK: 0.3, kMode: "APPROX" });
    expect(outcome.candidates).toHaveLength(0);
    expect(resolveKTolerance("APPROX")).toBe(DEFAULT_K_APPROX_TOLERANCE);
  });
});

describe("统一指标最终收口 A—E", () => {
  it.each([
    ["K不应大于0.3", "K", "MAX_LIMIT"], ["K不得超过0.3", "K", "MAX_LIMIT"],
    ["K不高于0.3", "K", "MAX_LIMIT"], ["总热阻不应小于3.3", "TOTAL_R", "MIN_LIMIT"],
    ["总热阻不得低于3.3", "TOTAL_R", "MIN_LIMIT"], ["总热阻3.3以上", "TOTAL_R", "MIN_LIMIT"],
    ["K0.3以下", "K", "MAX_LIMIT"], ["K不应高于0.3", "K", "MAX_LIMIT"],
    ["K不应超过0.3", "K", "MAX_LIMIT"], ["K不得大于0.3", "K", "MAX_LIMIT"],
    ["总R不得小于3.3", "TOTAL_R", "MIN_LIMIT"], ["总R不应低于3.3", "TOTAL_R", "MIN_LIMIT"]
  ] as const)("规范比较词 %s", (message, metric, mode) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.filters).toMatchObject([{ metric, mode, targetValue: metric === "K" ? 0.3 : 3.3 }]);
    expect(inferThermalLookupMode(parsed.modeMessage)).toBe(mode);
    expect(matchThermalCandidates([REAL_CASE], { filters: parsed.filters }).candidates).toEqual([]);
  });

  it.each(["K小于0.3", "K<0.3", "K大于0.3", "K>0.3"])("工程筛选普通比较词包含边界：%s", (message) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.filters[0]?.mode).toBe(/小于|</.test(message) ? "MAX_LIMIT" : "MIN_LIMIT");
    expect(matchThermalCandidates([row({ kValue: 0.3 })], { filters: parsed.filters }).candidates).toHaveLength(1);
  });

  it.each([
    "有没有K不超过0.3且总热阻不低于3.3的薄抹灰方案？",
    "K<=0.3 AND TOTAL_R>=3.3", "K≤0.3，且总R≥3.3",
    "产品层热阻至少2.8，K不超过0.3"
  ])("多条件全部 AND，单项不满足也排除：%s", (message) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.filters).toHaveLength(2);
    const rows = [REAL_CASE,
      row({ rowId: "k-only", kValue: 0.295, totalThermalResistance: 3.297, productThermalResistance: 2.7 }),
      row({ rowId: "r-only", kValue: 0.303, totalThermalResistance: 3.39, productThermalResistance: 2.95 }),
      row({ rowId: "both", kValue: 0.295, totalThermalResistance: 3.39, productThermalResistance: 2.95 })];
    expect(matchThermalCandidates(rows, { filters: parsed.filters, thicknessMm: 18 }).candidates.map((c) => c.candidateId)).toEqual(["both"]);
    expect(matchThermalCandidates(rows, { filters: parsed.filters, thicknessMm: 19 }).candidates.every((c) => c.candidateId === "both")).toBe(true);
  });

  it("缺目标或 OR 必须澄清，不能只用已解析的一项", () => {
    expect(parseThermalLookupMessage("K≤0.3且总热阻要够大").needsClarification).toBe(true);
    expect(parseThermalLookupMessage("K≤0.3或者总R≥3.3").needsClarification).toBe(true);
  });

  it("旧双指标归一为两个硬条件；filters 权威且有完整 API 校验", () => {
    expect(normalizeThermalLookupQuery({ targetK: 0.3, kMode: "MAX_LIMIT", targetResistance: 3.3 }).filters)
      .toMatchObject([{ metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", mode: "MIN_LIMIT" }]);
    const filters = [{ metric: "PRODUCT_R" as const, targetValue: 2.9, mode: "APPROX" as const }];
    expect(normalizeThermalLookupQuery({ filters, targetK: 0.1 }).filters).toHaveLength(1);
    expect(thermalCandidateQuerySchema.safeParse({ filters }).success).toBe(true);
    expect(thermalCandidateQuerySchema.safeParse({ filters: [{ metric: "K", targetValue: 11 }] }).success).toBe(false);
    expect(thermalCandidateQuerySchema.safeParse({ filters: [{ metric: "TOTAL_R" }] }).success).toBe(false);
    expect(thermalCandidateQuerySchema.safeParse({ filters: [] }).success).toBe(false);
  });

  it("容差归一可追踪且幂等，每个指标的用户窗口互不污染", () => {
    const parsed = parseThermalLookupMessage("K0.3±0.01且总R3.3±5");
    const lookup = normalizeThermalLookupQuery({ filters: parsed.filters });
    expect(lookup.filters).toMatchObject([
      { metric: "K", requestedTolerance: 0.01, effectiveTolerance: 0.01, toleranceAdjusted: false },
      { metric: "TOTAL_R", requestedTolerance: 5, effectiveTolerance: 0.2, toleranceAdjusted: true }
    ]);
    expect(normalizeThermalLookupQuery(lookup)).toEqual(lookup);
  });
  it.each([
    ["薄抹灰 K 0.3左右有方案吗？", "K", 0.3, "APPROX", true],
    ["薄抹灰 K 不超过0.3", "K", 0.3, "MAX_LIMIT", false],
    ["薄抹灰总热阻3.3左右有方案吗？", "TOTAL_R", 3.3, "APPROX", true],
    ["总热阻不低于3.3的薄抹灰方案", "TOTAL_R", 3.3, "MIN_LIMIT", false],
    ["I型产品层热阻2.9左右有什么方案？", "PRODUCT_R", 2.9, "APPROX", true],
    ["产品R不低于2.9", "PRODUCT_R", 2.9, "MIN_LIMIT", false],
    ["总R≤3.3", "TOTAL_R", 3.3, "MAX_LIMIT", true],
    ["产品R≤2.9", "PRODUCT_R", 2.9, "MAX_LIMIT", true],
    ["总R精确等于3.297", "TOTAL_R", 3.297, "EXACT", true],
    ["产品R精确等于2.88", "PRODUCT_R", 2.88, "EXACT", true],
    ["K≥0.3", "K", 0.3, "MIN_LIMIT", true]
  ] as const)("%s", (message, metric, targetValue, mode, found) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed).toMatchObject({ metric, targetValue, needsClarification: false });
    expect(inferThermalLookupMode(message)).toBe(mode);
    const outcome = matchThermalCandidates([row({})], { metric, targetValue, mode, thicknessMm: 18 });
    expect(outcome.candidates).toHaveLength(found ? 1 : 0);
    if (found) expect(outcome.candidates[0]).toMatchObject({ sourcePageId: "page-22", result: { productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 } });
  });

  it.each([
    ["传热系数K约0.3", "K", 0.3], ["K值0.3", "K", 0.3],
    ["总R3.3", "TOTAL_R", 3.3], ["R0约3.3", "TOTAL_R", 3.3],
    ["外墙主断面传热阻3.3", "TOTAL_R", 3.3], ["主断面传热阻3.3", "TOTAL_R", 3.3],
    ["产品热阻2.9", "PRODUCT_R", 2.9], ["保温板热阻2.9", "PRODUCT_R", 2.9],
    ["VICP热阻接近2.9", "PRODUCT_R", 2.9], ["产品R≈2.9", "PRODUCT_R", 2.9]
  ] as const)("指标别名 %s", (message, metric, targetValue) => {
    expect(parseThermalLookupMessage(message)).toMatchObject({ metric, targetValue });
    expect(inferThermalLookupMode(message)).toBe("APPROX");
  });

  it("模糊指标不按数值大小猜测；已明确上下文可继承", () => {
    expect(parseThermalLookupMessage("传热阻系数0.303").needsClarification).toBe(true);
    expect(parseThermalLookupMessage("传热阻系数3.297").needsClarification).toBe(true);
    expect(parseThermalLookupMessage("传热阻系数3.297", "TOTAL_R")).toMatchObject({ metric: "TOTAL_R", targetValue: 3.297, needsClarification: false });
  });

  it("前置数字及总热阻R标注可解析；厚度±不授权指标容差", () => {
    expect(parseThermalLookupMessage("3.3左右的总热阻")).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3 });
    expect(parseThermalLookupMessage("总热阻R0=3.297")).toMatchObject({ metric: "TOTAL_R", targetValue: 3.297 });
    expect(parseThermalLookupMessage("K0.3左右，厚度18±5mm").tolerance).toBeUndefined();
  });

  it.each(["K", "TOTAL_R", "PRODUCT_R"] as const)("%s 容差有硬上限，EXACT 不能放大", (metric) => {
    expect(resolveMetricTolerance(metric, "APPROX", 5)).toBe(metric === "K" ? 0.05 : 0.2);
    expect(resolveMetricTolerance(metric, "EXACT", 5)).toBe(0.0005);
    expect(resolveMetricTolerance(metric, "MAX_LIMIT", 5)).toBeUndefined();
    const targetValue = metric === "K" ? 0.3 : 3;
    expect(matchThermalCandidates([row({})], { metric, targetValue, mode: "EXACT", tolerance: 5 }).candidates).toEqual([]);
  });

  it.each(["TOTAL_R", "PRODUCT_R"] as const)("%s 三种查询距离排序并保留最接近标记", (metric) => {
    const field = metric === "TOTAL_R" ? "totalThermalResistance" : "productThermalResistance";
    const rows = [3.297, 3.31, 3.28, 3.34].map((value, index) => row({ rowId: `r-${index}`, [field]: value }));
    for (const mode of ["APPROX", "MAX_LIMIT", "MIN_LIMIT"] as ThermalLookupMode[]) {
      const result = matchThermalCandidates(rows, { metric, targetValue: 3.3, mode }).candidates;
      const expected = mode === "APPROX" ? [3.297, 3.31, 3.28, 3.34] : mode === "MAX_LIMIT" ? [3.297, 3.28] : [3.31, 3.34];
      expect(result.map((item) => item.result[field])).toEqual(expected);
      expect(result[0]?.ranking).toMatchObject({ metric, isClosestToTarget: true });
      expect(result.slice(1).every((item) => !item.ranking?.isClosestToTarget)).toBe(true);
    }
  });

  it("旧 DTO 默认口径保留；新指标优先且成对校验", () => {
    expect(normalizeThermalLookupQuery({ targetK: 0.3 })).toMatchObject({ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" });
    expect(normalizeThermalLookupQuery({ targetResistance: 3.3 })).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3, mode: "MIN_LIMIT" });
    expect(normalizeThermalLookupQuery({ metric: "PRODUCT_R", targetValue: 2.9, targetK: 0.3 })).toMatchObject({ metric: "PRODUCT_R", targetValue: 2.9, mode: "APPROX" });
    expect(thermalCandidateQuerySchema.safeParse({ metric: "TOTAL_R", targetValue: 3.3 }).success).toBe(true);
    expect(thermalCandidateQuerySchema.safeParse({ metric: "TOTAL_R" }).success).toBe(false);
    expect(thermalCandidateQuerySchema.safeParse({ targetValue: 3.3 }).success).toBe(false);
    expect(thermalCandidateQuerySchema.safeParse({ metric: "K", targetValue: 11 }).success).toBe(false);
    expect(thermalCandidateQuerySchema.safeParse({ targetK: 0.3, kMode: "APPROX", targetResistance: 3 }).success).toBe(true);
    expect(matchThermalCandidates([row({})], { targetK: 0.3, kMode: "APPROX", targetResistance: 3.3 }).candidates).toEqual([]);
    expect(matchThermalCandidates([row({})], { targetK: 0.3, mode: "APPROX" }).candidates).toHaveLength(1);
  });
});

describe("Test 2：MAX_LIMIT 0.3 必须排除 K=0.303", () => {
  it("同一真实 fixture：MAX_LIMIT 下 0.303 被过滤", () => {
    const outcome = matchThermalCandidates([row({})], { targetK: 0.3, kMode: "MAX_LIMIT" });
    expect(outcome.candidates).toHaveLength(0);
    const state = evaluateConditions(row({}), { targetK: 0.3, kMode: "MAX_LIMIT" });
    expect(state.unmatched).toContain("targetK");
  });

  it("缺省模式（不传 kMode）沿用历史 MAX_LIMIT 口径", () => {
    const outcome = matchThermalCandidates([row({})], { targetK: 0.3 });
    expect(outcome.candidates).toHaveLength(0);
  });
});

describe("Test 3 / Test 4：自然语言查询模式判定", () => {
  it("Test 3：没有明确约束词时按 APPROX（不能默认 MAX_LIMIT）", () => {
    expect(inferThermalLookupMode("保温薄抹灰系统传热系数0.3的方案有么？")).toBe("APPROX");
    expect(inferThermalLookupMode("薄抹灰系统K值0.3左右")).toBe("APPROX");
    expect(inferThermalLookupMode("有没有0.3附近的方案")).toBe("APPROX");
    expect(inferThermalLookupMode("接近0.3的方案")).toBe("APPROX");
  });

  it("Test 4：出现明确约束词时按 MAX_LIMIT", () => {
    expect(inferThermalLookupMode("薄抹灰系统有没有传热系数不超过0.3的方案？")).toBe("MAX_LIMIT");
    expect(inferThermalLookupMode("K≤0.3 的方案有哪些")).toBe("MAX_LIMIT");
    expect(inferThermalLookupMode("0.3以内")).toBe("MAX_LIMIT");
    expect(inferThermalLookupMode("传热系数不能高于0.3")).toBe("MAX_LIMIT");
    expect(inferThermalLookupMode("K最大0.3")).toBe("MAX_LIMIT");
  });

  it("MIN_LIMIT / EXACT 也保持明确语义", () => {
    expect(inferThermalLookupMode("K不低于0.3")).toBe("MIN_LIMIT");
    expect(inferThermalLookupMode("K≥0.3")).toBe("MIN_LIMIT");
    expect(inferThermalLookupMode("K正好等于0.303")).toBe("EXACT");
  });
});

describe("Test 5：APPROX 按 |K - target| 升序", () => {
  it("0.302 → 0.303 → 0.305 → 0.294", () => {
    const outcome = matchThermalCandidates(FOUR_LEVELS, { targetK: 0.3, kMode: "APPROX" });
    expect(outcome.candidates.map((c) => c.result.kValue)).toEqual([0.302, 0.303, 0.305, 0.294]);
    expect(outcome.candidates[0]!.ranking).toEqual({ kGap: 0.002, isClosestToTarget: true });
    expect(outcome.candidates.filter((c) => c.ranking?.isClosestToTarget)).toHaveLength(1);
  });

  it("MAX_LIMIT 排序：优先最接近上限（0.294 排在更小的 K 之前）", () => {
    const rows = [row({ rowId: "k-294", kValue: 0.294 }), row({ rowId: "k-28", kValue: 0.28 })];
    const outcome = matchThermalCandidates(rows, { targetK: 0.3, kMode: "MAX_LIMIT" });
    expect(outcome.candidates.map((c) => c.result.kValue)).toEqual([0.294, 0.28]);
  });

  it("MIN_LIMIT 排序：优先最接近下限", () => {
    const rows = [row({ rowId: "k-32", kValue: 0.32 }), row({ rowId: "k-305", kValue: 0.305 })];
    const outcome = matchThermalCandidates(rows, { targetK: 0.3, kMode: "MIN_LIMIT" });
    expect(outcome.candidates.map((c) => c.result.kValue)).toEqual([0.305, 0.32]);
  });

  it("排序器可独立复用（APPROX 与 MAX_LIMIT 顺序不同）", () => {
    const rows = [row({ rowId: "k-294", kValue: 0.294 }), row({ rowId: "k-305", kValue: 0.305 })];
    const approx = matchThermalCandidates(rows, { targetK: 0.3, kMode: "APPROX" }).candidates;
    const maxLimit = matchThermalCandidates(rows, { targetK: 0.3, kMode: "MAX_LIMIT" }).candidates;
    expect(approx.map((c) => c.result.kValue)).toEqual([0.305, 0.294]);
    expect(maxLimit.map((c) => c.result.kValue)).toEqual([0.294]);
    expect(buildCandidateSorter({ targetK: 0.3, kMode: "APPROX" })).toBeTypeOf("function");
  });
});

describe("回归保护：模式不影响非 K 维度语义", () => {
  it.each([
    { targetK: 0.3, kMode: "MAX_LIMIT" as const },
    { specClass: "II" as const },
    { systemId: "system-other" },
    { targetResistance: 4 },
    { substrateMaterial: "钢筋混凝土" }
  ])("18mm exact 不绕过其他硬条件：%j", (constraints) => {
    expect(matchThermalCandidates([row({})], { thicknessMm: 18, ...constraints }).candidates).toEqual([]);
  });

  it("18mm APPROX 仍返回 A1-3 双 R，MAX_LIMIT 相邻档也不能绕过 K", () => {
    const exact = matchThermalCandidates([row({})], { thicknessMm: 18, targetK: 0.3, kMode: "APPROX" });
    expect(exact.candidates[0]?.result).toEqual({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
    expect(matchThermalCandidates([row({ thicknessMm: 20 })], { thicknessMm: 18, targetK: 0.3, kMode: "MAX_LIMIT" }).candidates).toEqual([]);
  });

  it("没有本轮语义时继承 MAX_LIMIT；用户明确语义覆盖错误 tool mode", () => {
    expect(inferThermalLookupMode("18mm的呢？")).toBeNull();
    expect(resolveConversationLookupMode("18mm的呢？", undefined, "MAX_LIMIT")).toEqual({ mode: "MAX_LIMIT", conflict: false });
    expect(resolveConversationLookupMode("0.3左右", "MAX_LIMIT", "MAX_LIMIT")).toEqual({ mode: "APPROX", conflict: true });
    expect(resolveConversationLookupMode("", undefined, undefined).mode).toBe("APPROX");
    expect(resolveConversationLookupMode("18mm的呢？", "MIN_LIMIT", "MAX_LIMIT").mode).toBe("MIN_LIMIT");
  });
  it("厚度精确档 + APPROX：厚度未命中仍按相邻规格处理", () => {
    const outcome = matchThermalCandidates(
      [row({ rowId: "t-20", thicknessMm: 20, kValue: 0.303 })],
      { thicknessMm: 18, targetK: 0.3, kMode: "APPROX" }
    );
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]!.matchType).toBe("NEIGHBOR");
  });

  it("无 targetK 时不产生 ranking（模式无关）", () => {
    const outcome = matchThermalCandidates(FOUR_LEVELS, { systemId: "system-i", kMode: "APPROX" });
    expect(outcome.candidates).toHaveLength(4);
    expect(outcome.candidates.every((c) => c.ranking === undefined)).toBe(true);
  });
});
