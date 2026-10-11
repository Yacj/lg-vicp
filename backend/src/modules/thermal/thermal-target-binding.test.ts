import { describe, expect, it } from "vitest";
import {
  classifyNumberRole,
  isMetricBridge,
  parseThermalLookupMessage,
  matchesMetric,
  DEFAULT_K_APPROX_TOLERANCE,
  THERMAL_LOOKUP_RULES
} from "./thermal-lookup-mode.js";
import { matchThermalCandidates, type CandidateRow } from "./thermal-candidate-matcher.js";
import { classifyRejection, buildThermalQueryDebug, toRejectedCandidateDebug } from "./thermal-query-debug.js";
import { resolveQueryEntities, describeSystemEntityResolution, type QueryEntity } from "./thermal-entity-resolver.js";
import { validateCandidateAgainstQueryState } from "./thermal-query-state.js";
import { normalizeConversationLookupQuery } from "../ai/tools/thermal-lookup.js";
import { interpretThermalQuestion } from "../ai/thermal-answer-facts.js";

/**
 * 本轮修复锁：显式指标自然语义绑定 + False Negative 查询链路。
 * 目标：用户说清楚了不再问、资料里有必须查得到、条件明确不串条件、新问题不带旧条件。
 */

/** 指标已明确时，同句唯一数值必须自动绑定，绝不重复澄清指标。 */
describe("显式指标 + 自然语序 target 绑定（P0-1）", () => {
  it.each([
    "保温板自身热阻 有传热8.3的保温板么",
    "保温板自身热阻，有传热8.3的板吗",
    "保温板自身热阻，有传热8.3的么",
    "保温板自身热阻8.3有么",
    "保温板自身热阻，有8.3左右的吗",
    "板自身R做到8.3有吗",
    "板子的热阻能到8.3么",
    "产品热阻8.3左右有没有",
    "产品层热阻 有传热8.3的么",
    "自身R大概8.3有没有"
  ])("PRODUCT_R：%s → metric 已解析，8.3 自动绑定，不澄清", (message) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.filters).toMatchObject([{ metric: "PRODUCT_R", targetValue: 8.3, mode: "APPROX" }]);
    // interpretThermalQuestion 也不得要求澄清指标
    expect(interpretThermalQuestion(message).needsClarification).toBe(false);
  });

  it.each([
    "传热系数0.3有吗",
    "传热系数做到0.3有没有",
    "K做到0.3左右",
    "K0.3左右的方案",
    "系数0.3方案"
  ])("K：%s → K≈0.3 自动绑定", (message) => {
    expect(parseThermalLookupMessage(message)).toMatchObject({ needsClarification: false, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
  });

  it.each([
    "整墙总热阻8.3有么",
    "主断面热阻8.3左右",
    "R0做到8.3有没有",
    "总热阻8.3附近有吗"
  ])("TOTAL_R：%s → TOTAL_R≈8.3 自动绑定", (message) => {
    expect(parseThermalLookupMessage(message)).toMatchObject({ needsClarification: false, filters: [{ metric: "TOTAL_R", targetValue: 8.3, mode: "APPROX" }] });
  });

  it("指标未明确的「有传热8.3的保温板么」仍允许澄清指标（不得猜测）", () => {
    const parsed = parseThermalLookupMessage("有传热8.3的保温板么");
    expect(parsed.filters).toHaveLength(0);
    expect(parsed.needsClarification).toBe(true);
    expect(interpretThermalQuestion("有传热8.3的保温板么").needsClarification).toBe(true);
  });

  it("metric 与 target 不要求紧挨，连接词/冗余词/倒装均不阻断绑定", () => {
    for (const bridge of ["", "有没有", "能做到", "有传热", "大概", "约", "左右", "做到", "能到"]) {
      const message = `保温板自身热阻${bridge}8.3`;
      expect(parseThermalLookupMessage(message).filters, message).toMatchObject([{ metric: "PRODUCT_R", targetValue: 8.3 }]);
    }
  });
});

/** 禁止危险的全局数字绑定（第七、五十二条）。 */
describe("Number Role Classification：非热工目标数值不得绑定指标", () => {
  it.each([
    ["18mm", "THICKNESS"],
    ["20mm以内", "THICKNESS"],
    ["第21页", "PAGE_NUMBER"],
    ["A1-3", "MODEL_CODE_PART"],
    ["2026版", "YEAR"]
  ] as const)("%s → %s", (message, role) => {
    const parsed = parseThermalLookupMessage(message);
    expect(parsed.filters).toHaveLength(0);
    expect(parsed.needsClarification).toBe(false);
    const numbers = (message.normalize("NFKC").match(/\d+(?:\.\d+)?/g) ?? []).map((raw) => classifyNumberRole(message.normalize("NFKC"), raw, message.normalize("NFKC").indexOf(raw)));
    expect(numbers).toContain(role);
  });

  it("指标 + 型号编码时，编码数字不得被当成热工目标", () => {
    // A1-3 属于型号编码，不是 target；此句无独立热工数值 → 不绑定（保持澄清或空条件）
    const parsed = parseThermalLookupMessage("保温板自身热阻 A1-3");
    expect(parsed.filters).toHaveLength(0);
  });

  it("K 与厚度数字各自解析，互不污染", () => {
    const parsed = parseThermalLookupMessage("K0.3 20mm以内");
    expect(parsed.filters).toMatchObject([{ metric: "K", targetValue: 0.3 }]);
    expect(parsed.filters).toHaveLength(1);
  });

  it("isMetricBridge 只放行连接/冗余词与同义指标字", () => {
    expect(isMetricBridge("", "K")).toBe(true);
    expect(isMetricBridge("做到", "K")).toBe(true);
    expect(isMetricBridge("有传热", "保温板自身热阻")).toBe(true);
    // 混入无关数值单位则不通过
    expect(isMetricBridge("-3", "K")).toBe(false);
  });
});

/** 模式推断：自然问法「有8.3的么」默认 APPROX；明确等于才 EXACT（第十、十一条）。 */
describe("查询模式推断", () => {
  it.each([
    ["保温板自身热阻8.3左右", "APPROX"],
    ["保温板自身热阻大概8.3", "APPROX"],
    ["保温板自身热阻有8.3的么", "APPROX"],
    ["保温板自身热阻做到8.3", "APPROX"],
    ["保温板自身热阻正好8.3", "EXACT"],
    ["保温板自身热阻等于8.3", "EXACT"],
    ["保温板自身热阻就是8.3", "EXACT"],
    ["保温薄抹灰K不超过0.3", "MAX_LIMIT"],
    ["薄抹灰总热阻至少3.3", "MIN_LIMIT"]
  ] as const)("%s → %s", (message, mode) => {
    expect(parseThermalLookupMessage(message).filters?.[0]?.mode).toBe(mode);
  });
});

/** K≈0.3 False Negative：体系过滤必须正确，K 过滤必须正确（第十四～三十四条）。 */
const row = (o: Partial<CandidateRow>): CandidateRow => ({
  rowId: "r", setId: "set", setCode: "ATLAS", setVersion: 1, setPriority: 0, setBuildingTypes: [],
  schemeId: "scheme", schemeCode: "A1-3", schemeVersion: 1, systemId: "sys-1", systemCode: "EW-I",
  systemName: "I型 VICP薄抹灰外保温系统", substrateMaterial: "钢筋混凝土", substrateThickness: 200, atlasPage: "22",
  productSpecId: "spec", specCode: "A1-3", specVersion: 1, specClass: "I", thicknessMm: 18,
  productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303, evidenceSource: "图集", evidenceRef: "第22页",
  ...o
});

const A13 = row({ rowId: "A1-3", schemeId: "s1", systemId: "sys-1", kValue: 0.303, thicknessMm: 18, specCode: "A1-3" });
const A21 = row({ rowId: "A2-1", schemeId: "s2", systemId: "sys-2", systemName: "II型 VICP薄抹灰外保温系统", kValue: 0.302, thicknessMm: 30, specClass: "II", specCode: "A2-1" });
const DECO = row({ rowId: "DECO", schemeId: "s3", systemId: "sys-deco", systemName: "VICP保温装饰板系统", kValue: 0.301, specCode: "D-1" });

describe("K≈0.3 薄抹灰候选匹配（False Negative 定位）", () => {
  const family = { systemIds: ["sys-1", "sys-2"] };

  it("A1-3（K=0.303）/ A2-1（K=0.302）必须命中薄抹灰族 K≈0.3", () => {
    const out = matchThermalCandidates([A13, A21], { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX", tolerance: DEFAULT_K_APPROX_TOLERANCE }], ...family } as never);
    expect(out.candidates.map((c) => c.candidateId)).toEqual(expect.arrayContaining(["A1-3", "A2-1"]));
    for (const candidate of out.candidates) expect(candidate.constraintMatch ?? true).toBeTruthy();
  });

  it("其他体系即使 K≈0.3 也必须被体系过滤拒绝（不得为提高命中而取消体系过滤）", () => {
    const out = matchThermalCandidates([A13, A21, DECO], { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX", tolerance: DEFAULT_K_APPROX_TOLERANCE }], ...family } as never);
    expect(out.candidates.map((c) => c.candidateId)).not.toContain("DECO");
  });

  it("体系过滤用 validateCandidateAgainstQueryState 时，装饰板失败原因为 SYSTEM_FAMILY_MISMATCH", () => {
    const query = { systemIds: ["sys-1", "sys-2"], filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] };
    const match = validateCandidateAgainstQueryState({ ...DECO, systemName: DECO.systemName ?? undefined }, query as never);
    expect(match.failed).toContain("systemIds");
    expect([...new Set(match.failed.map(classifyRejection))]).toContain("SYSTEM_FAMILY_MISMATCH");
  });

  it("K 容差边界读取集中配置，0.28/0.30/0.302/0.303/0.32 均命中 ±0.02 窗口", () => {
    const tolerance = THERMAL_LOOKUP_RULES.K.approximate;
    expect(tolerance).toBe(DEFAULT_K_APPROX_TOLERANCE);
    for (const value of [0.28, 0.3, 0.302, 0.303, 0.32]) {
      expect(matchesMetric(value, 0.3, "APPROX", tolerance), String(value)).toBe(true);
    }
    // 明显无关档位必须排除
    expect(matchesMetric(0.55, 0.3, "APPROX", tolerance)).toBe(false);
  });

  it("MAX_LIMIT 语义下 0.303 必须被排除（语义不得混用）", () => {
    expect(matchesMetric(0.303, 0.3, "MAX_LIMIT")).toBe(false);
    const out = matchThermalCandidates([A13], { filters: [{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }] } as never);
    expect(out.candidates).toHaveLength(0);
  });
});

/** 拒绝原因细化 + Debug Trace（第十六、二十八～三十条）。 */
describe("Debug Trace 与 Rejected Reasons", () => {
  const entities: QueryEntity[] = [
    { field: "systemId", value: "sys-1", names: ["I型 VICP薄抹灰外保温系统"] },
    { field: "systemId", value: "sys-2", names: ["II型 VICP薄抹灰外保温系统"] },
    { field: "systemId", value: "sys-deco", names: ["VICP保温装饰板系统"] }
  ];

  it("完整 trace：rawText / metric / entity family / 阶段计数 / 拒绝原因", () => {
    const query = resolveQueryEntities("保温薄抹灰传热系数0.3方案有么", {}, entities);
    expect(query.systemIds).toEqual(["sys-1", "sys-2"]);
    expect(query.systemId).toBeUndefined();
    const parsed = parseThermalLookupMessage("保温薄抹灰传热系数0.3方案有么");
    expect(parsed).toMatchObject({ needsClarification: false, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });

    const snapshot = buildThermalQueryDebug({
      query: { ...query, filters: parsed.filters, intent: "REFERENCE_LOOKUP" },
      rawText: "保温薄抹灰传热系数0.3方案有么",
      matchedCount: 2,
      returnedCandidateIds: ["A1-3", "A2-1"],
      stageCounts: { beforeAll: 3, afterFamily: 2, afterMetric: 2, afterThickness: 2, afterAllHard: 2 },
      nearby: [toRejectedCandidateDebug("DECO", { passed: false, matched: [], failed: ["systemIds", "K:0"] })]
    });
    expect(snapshot.rawText).toBe("保温薄抹灰传热系数0.3方案有么");
    expect(snapshot.queryModes).toEqual([{ metric: "K", mode: "APPROX", targetValue: 0.3, tolerance: DEFAULT_K_APPROX_TOLERANCE }]);
    expect(snapshot.familyHints).toEqual(expect.arrayContaining(["sys-1", "sys-2"]));
    expect(snapshot.stageCounts).toMatchObject({ beforeAll: 3, afterFamily: 2, afterAllHard: 2 });
    expect(snapshot.rejected[0]!.reasons).toEqual(["SYSTEM_FAMILY_MISMATCH", "METRIC_OUT_OF_RANGE"]);
    expect(snapshot.rejectedByReason).toEqual(expect.arrayContaining([
      { reason: "SYSTEM_FAMILY_MISMATCH", count: 1 }, { reason: "METRIC_OUT_OF_RANGE", count: 1 }
    ]));
  });

  it("classifyRejection 覆盖主要失败维度", () => {
    expect(classifyRejection("systemIds")).toBe("SYSTEM_FAMILY_MISMATCH");
    expect(classifyRejection("schemeId")).toBe("SCHEME_MISMATCH");
    expect(classifyRejection("productSpecId")).toBe("PRODUCT_SPEC_MISMATCH");
    expect(classifyRejection("K:0")).toBe("METRIC_OUT_OF_RANGE");
    expect(classifyRejection("thicknessMax")).toBe("THICKNESS_MISMATCH");
    expect(classifyRejection("specClass")).toBe("SPEC_CLASS_MISMATCH");
    expect(classifyRejection("regionCode")).toBe("REGION_MISMATCH");
    expect(classifyRejection("standardLimitId")).toBe("STANDARD_MISMATCH");
    expect(classifyRejection("substrateMaterial")).toBe("SUBSTRATE_MATERIAL_MISMATCH");
  });
});

/** 实体解析诊断：明确「薄抹灰」到底解析成什么（第二十三、二十四条）。 */
describe("Entity Resolver 诊断", () => {
  const entities: QueryEntity[] = [
    { field: "systemId", value: "sys-1", names: ["I型 VICP薄抹灰外保温系统"] },
    { field: "systemId", value: "sys-2", names: ["II型 VICP薄抹灰外保温系统"] },
    { field: "systemId", value: "sys-3", names: ["III型 VICP薄抹灰外保温系统"] },
    { field: "systemId", value: "sys-deco", names: ["VICP保温装饰板系统"] }
  ];

  it("「薄抹灰」→ FAMILY，familyIds 含同族三个正式体系，不含装饰板", () => {
    const resolution = describeSystemEntityResolution("保温薄抹灰传热系数0.3方案有么", entities);
    expect(resolution.matchType).toBe("FAMILY");
    expect(resolution.family).toBe("薄抹灰");
    expect(new Set(resolution.familyIds)).toEqual(new Set(["sys-1", "sys-2", "sys-3"]));
    expect(resolution.familyIds).not.toContain("sys-deco");
  });

  it("完整体系全名 → EXACT，解析唯一 systemId", () => {
    const resolution = describeSystemEntityResolution("I型 VICP薄抹灰外保温系统 K0.3", entities);
    expect(resolution.matchType).toBe("EXACT");
    expect(resolution.systemId).toBe("sys-1");
  });

  it("未匹配正式名称 → NONE，不得凭文本猜测", () => {
    expect(describeSystemEntityResolution("某种不存在的体系 K0.3", entities).matchType).toBe("NONE");
  });
});

/** Query Reset / Inheritance（第三十五～三十八条）。 */
describe("新查询重置与追问继承", () => {
  it("上一轮 PRODUCT_R≈8.3，下一轮独立问薄抹灰 K≈0.3 → NEW_QUERY，不串条件", () => {
    const previous = normalizeConversationLookupQuery({}, "产品层热阻8.3左右");
    const next = normalizeConversationLookupQuery({}, "保温薄抹灰传热系数0.3方案有么", previous);
    expect(next.lifecycle).toBe("NEW_QUERY");
    const lookup = next.query.filters ?? [];
    expect(lookup).toMatchObject([{ metric: "K", targetValue: 0.3 }]);
    expect(lookup.some((filter) => filter.metric === "PRODUCT_R")).toBe(false);
  });

  it("追问「那20mm以内呢」→ CONTINUE，保留 K≈0.3 并新增厚度上限", () => {
    const previous = normalizeConversationLookupQuery({}, "保温薄抹灰K0.3左右");
    const next = normalizeConversationLookupQuery({}, "那20mm以内呢", previous);
    expect(next.lifecycle).toBe("CONTINUE_QUERY");
    expect(next.query).toMatchObject({ thicknessMax: 20, filters: [{ metric: "K", targetValue: 0.3 }] });
  });
});
