import { describe, expect, it } from "vitest";
import {
  compactCandidateResults,
  compactCandidateResult,
  lookupQuerySignature,
  filterCandidatesBySystemHint,
  filterReusableCandidates,
  inheritLookupQuery,
  normalizeConversationLookupQuery,
  parseSpecClassHint,
  sanitizeSystemHint
} from "./thermal-lookup.js";
import type { LastReferenceLookup } from "../conversation-task.js";
import { parseConversationTaskState, formatConversationTaskContext } from "../conversation-task.js";
import { resolveAnswerContract } from "../../../shared/ai-answer-contract.js";
import type { CandidateResult } from "../../thermal/thermal-candidate-matcher.js";

describe("多指标条件局部增改删与厚度跨轮修改", () => {
  const snapshot = (message: string): LastReferenceLookup => ({
    query: normalizeConversationLookupQuery({}, message).query,
    candidates: [compactCandidateResult(candidateRow(1))], createdAt: "2026-10-07T00:00:00Z"
  });
  const base = () => snapshot("K<=0.3 且 总R>=3.3");

  it.each([
    ["总R改成3.5以上", 3.5, "MIN_LIMIT"],
    ["总R3.4左右呢", 3.4, "APPROX"],
    ["总R换成3.5以上", 3.5, "MIN_LIMIT"],
    ["总R改为3.5以上", 3.5, "MIN_LIMIT"],
    ["总R调整到3.5以上", 3.5, "MIN_LIMIT"],
    ["总R提高到3.5以上", 3.5, "MIN_LIMIT"],
    ["总R降到3.4左右", 3.4, "APPROX"],
    ["总R变成3.5以上", 3.5, "MIN_LIMIT"],
    ["总R3.5以上", 3.5, "MIN_LIMIT"]
  ] as const)("%s 只更新总R", (message, targetValue, mode) => {
    const next = normalizeConversationLookupQuery({}, message, base());
    expect(next.needsClarification).toBe(false);
    expect(next.query.filters).toMatchObject([
      { metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" },
      { metric: "TOTAL_R", targetValue, mode }
    ]);
  });

  it.each(["再加总R不低于3.3", "再加一个总R不低于3.3", "同时总R不低于3.3", "另外总R不低于3.3"])("%s 新增指标", (message) => {
    const next = normalizeConversationLookupQuery({}, message, snapshot("K<=0.3"));
    expect(next.query.filters).toMatchObject([{ metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", mode: "MIN_LIMIT", targetValue: 3.3 }]);
  });

  it.each(["不限制总R了", "不用限制总R了", "取消总R", "先不看总R", "去掉总R"])("%s 不允许模型复活已删除条件", (message) => {
    const next = normalizeConversationLookupQuery({ filters: base().query.filters, metric: "TOTAL_R", targetValue: 3.3 }, message, base());
    expect(next.needsClarification).toBe(false);
    expect(next.query.filters).toMatchObject([{ metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }]);
    expect(next.query.filters).toHaveLength(1);
  });

  it("明确再加范围条件才保留同指标的多个边界", () => {
    const next = normalizeConversationLookupQuery({}, "再加一个范围条件，总R不超过4", base());
    expect(next.query.filters).toMatchObject([
      { metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", mode: "MIN_LIMIT" }, { metric: "TOTAL_R", mode: "MAX_LIMIT", targetValue: 4 }
    ]);
  });

  it("单指标取消后无旧摘要残留；多指标无指向的数字和模糊系数不能猜", () => {
    const removed = normalizeConversationLookupQuery({ targetK: 0.3 }, "不限制K了", snapshot("K0.3左右"));
    expect(removed.needsClarification).toBe(false);
    expect(removed.query.filters).toEqual([]);
    expect(removed.query.metric).toBeUndefined();
    expect(removed.query.targetValue).toBeUndefined();
    expect(removed.query.targetK).toBeUndefined();
    expect(normalizeConversationLookupQuery({}, "这个保温系数做到0.3", base()).needsClarification).toBe(true);
    expect(normalizeConversationLookupQuery({}, "最好不要超过0.3", base()).needsClarification).toBe(true);
  });

  it("厚度和R跨轮修改后，取消厚度保留全部filters，并保存来源完整字段", () => {
    const initial = snapshot("K不超过0.3，总R不低于3.3，20mm以内");
    const updated = normalizeConversationLookupQuery({ thicknessMm: 25 }, "总R改成3.5以上，厚度放宽到25", initial);
    expect(updated.needsClarification).toBe(false);
    expect(updated.query).toMatchObject({ thicknessMax: 25, filters: [
      { metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }, { metric: "TOTAL_R", mode: "MIN_LIMIT", targetValue: 3.5 }
    ] });
    expect(updated.query.thicknessMm).toBeUndefined();
    const persisted = parseConversationTaskState(JSON.parse(JSON.stringify({ lastReferenceLookup: { ...initial, query: updated.query } }))).lastReferenceLookup!;
    expect(persisted.query.thicknessMax).toBe(25);
    const removed = normalizeConversationLookupQuery({ thicknessMm: 25, metric: "K", targetValue: 0.3 }, "不限制厚度了，K条件保留。", persisted);
    expect(removed.needsClarification).toBe(false);
    expect(removed.query.filters).toEqual(updated.query.filters);
    expect([removed.query.thicknessMm, removed.query.thicknessMin, removed.query.thicknessMax]).toEqual([undefined, undefined, undefined]);
    expect(persisted.candidates[0]).toMatchObject({ productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 });
  });

  it.each(["thicknessMm", "thicknessMin", "thicknessMax"] as const)("%s 变化签名不同且禁止历史候选复用", (field) => {
    const previous = snapshot("K0.3左右");
    const next = { ...previous.query, [field]: 20 };
    expect(lookupQuerySignature(next)).not.toBe(lookupQuerySignature(previous.query));
    expect(filterReusableCandidates(previous, next)).toBeNull();
  });

  it("单位厚度变更延续原单边含义；双边范围未说改哪端则澄清", () => {
    expect(normalizeConversationLookupQuery({}, "放宽到25mm", snapshot("20mm以内K0.3左右")).query).toMatchObject({ thicknessMax: 25 });
    expect(normalizeConversationLookupQuery({}, "厚度18到25mm，K不应大于0.3，总R不低于3.3").query).toMatchObject({
      thicknessMin: 18, thicknessMax: 25, filters: [{ metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", mode: "MIN_LIMIT" }]
    });
    expect(normalizeConversationLookupQuery({}, "放宽到30mm", snapshot("厚度18到25mm，K0.3左右")).needsClarification).toBe(true);
  });
});

/** 最小候选行工厂：只填 compactCandidateResult 读取的字段 */
function candidateRow(index: number, overrides: Partial<{ systemName: string; kValue: number }> = {}): CandidateResult {
  return {
    candidateId: `row-${index}`,
    matchType: "EXACT",
    neighborGap: null,
    matchedConditions: ["targetK"],
    unmatchedConditions: [],
    missingConditions: [],
    scheme: { id: `scheme-${index}`, code: `A1-${index}`, version: 1, substrateMaterial: "蒸压灰砂砖", substrateThickness: 240, atlasPage: "P22" },
    system: { id: `sys-${index}`, code: "EW", name: overrides.systemName ?? "岩棉外保温系统" },
    productSpec: { id: `spec-${index}`, specCode: `VICP-${index}`, specVersion: 1, specClass: "I" },
    set: { id: "set-1", code: "ATLAS-2024", version: 1, priority: 0, buildingTypes: ["住宅"] },
    result: { thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: overrides.kValue ?? 0.303 },
    evidence: { source: "《图集》", ref: "P22" }
  };
}

const last: LastReferenceLookup = {
  query: { targetK: 0.3, systemHint: "薄抹灰" },
  candidates: [
    {
      id: "ii",
      specClass: "II",
      thicknessMm: 55,
      kValue: 0.294,
      systemName: "Ⅱ型VICP复合保温板 + 热固复合聚苯板（G型）薄抹灰外保温系统",
      schemeId: "s2",
      productSpecId: "p2"
    },
    {
      id: "i",
      specClass: "I",
      thicknessMm: 50,
      kValue: 0.3,
      systemName: "薄抹灰外保温",
      schemeId: "s1",
      productSpecId: "p1"
    }
  ],
  createdAt: "2026-09-21T00:00:00.000Z"
};

describe("thermal lookup helpers", () => {
  it("规格/产品/型号/方案切换清除旧依赖，显式新 ID 保留交给正式查询校验", () => {
    const previous: LastReferenceLookup = { ...last, query: { productSpecId: "spec-A18", catalogProductId: "product-A", specClass: "I", schemeId: "scheme-A" } };
    expect(inheritLookupQuery({ productSpecId: "spec-B18" }, previous)).toMatchObject({ productSpecId: "spec-B18", catalogProductId: undefined, specClass: undefined });
    expect(inheritLookupQuery({ specClass: "II" }, previous)).toMatchObject({ specClass: "II", productSpecId: undefined, catalogProductId: undefined });
    expect(inheritLookupQuery({ catalogProductId: "product-B" }, previous)).toMatchObject({ catalogProductId: "product-B", productSpecId: undefined });
    expect(inheritLookupQuery({ schemeId: "scheme-B" }, previous)).toMatchObject({ schemeId: "scheme-B", productSpecId: undefined, catalogProductId: undefined });
    expect(inheritLookupQuery({ productSpecId: "spec-B18", catalogProductId: "product-B" }, previous)).toMatchObject({ productSpecId: "spec-B18", catalogProductId: "product-B" });
  });

  it("多条件状态 JSON 保留全部条件与容差授权；厚度追问继承，任一条件变化须重查", () => {
    const query = normalizeConversationLookupQuery({}, "K0.3左右且总R3.3±5").query;
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify({ lastReferenceLookup: { query, candidates: [], createdAt: last.createdAt } }))).lastReferenceLookup!;
    expect(restored.query.filters).toHaveLength(2);
    expect(restored.query.filters?.[1]).toMatchObject({ toleranceSource: "USER", requestedTolerance: 5, tolerance: 0.2, toleranceAdjusted: true });
    const followup = normalizeConversationLookupQuery({ thicknessMm: 18 }, "18mm的呢？", restored).query;
    expect(followup.filters).toEqual(query.filters);
    const changed = normalizeConversationLookupQuery({}, "K0.3左右且总R4.2左右", restored).query;
    expect(lookupQuerySignature(changed)).not.toBe(lookupQuerySignature(query));
  });

  it("历史多指标的精度追问保持兼容；明确K时只改K并清除旧窗口", () => {
    const query = normalizeConversationLookupQuery({}, "K0.3±0.01且总R3.3±5").query;
    const snapshot = { query, candidates: [], createdAt: last.createdAt };
    const precise = normalizeConversationLookupQuery({}, "精确一点", snapshot);
    expect(precise.needsClarification).toBe(false);
    expect(precise.query.filters).toMatchObject([{ mode: "EXACT", tolerance: 0.0005 }, { mode: "EXACT", tolerance: 0.0005 }]);
    const next = normalizeConversationLookupQuery({}, "K精确等于0.3", snapshot).query;
    expect(next.filters).toMatchObject([{ mode: "EXACT", tolerance: 0.0005 }, { mode: "APPROX", tolerance: 0.2 }]);
  });

  it("只有已确认且同指标/模式的用户容差能继承；默认窗口保持 DEFAULT", () => {
    const query = normalizeConversationLookupQuery({}, "K0.3左右且总R3.3±5").query;
    const next = normalizeConversationLookupQuery({}, "K0.3左右且总R3.4左右", { query, candidates: [], createdAt: last.createdAt }).query;
    expect(next.toleranceSource).toBe("DEFAULT");
    expect(next.filters).toMatchObject([{ toleranceSource: "DEFAULT", requestedTolerance: undefined },
      { toleranceSource: "USER", requestedTolerance: 5, tolerance: 0.2 }]);
    const changedId = normalizeConversationLookupQuery({ productSpecId: "new-spec" }, "刚才那个方案", { query, candidates: [], createdAt: last.createdAt });
    expect(changedId.attributeQuestion).toBe(false);
    expect(changedId.query.productSpecId).toBe("new-spec");
  });
  it("首轮未命中仍保留查询模式与上下文，18mm 追问继续 REFERENCE_LOOKUP", () => {
    const state = parseConversationTaskState({ lastReferenceLookup: { query: { targetK: 0.3, mode: "MAX_LIMIT" }, candidates: [], createdAt: last.createdAt } });
    expect(formatConversationTaskContext(state)).toContain("上限（不超过）");
    expect(resolveAnswerContract({ message: "18mm的呢？", lastReferenceLookup: state.lastReferenceLookup })).toBe("REFERENCE_LOOKUP");
  });

  it("更换体系名称不继承旧 UUID；切换 K 模式不继承旧容差", () => {
    const previous = { ...last, query: { systemId: "old-system", systemHint: "薄抹灰", mode: "APPROX" as const, tolerance: 0.02 } };
    const inherited = inheritLookupQuery({ systemHint: "屋面", mode: "EXACT" }, previous);
    expect(inherited.systemId).toBeUndefined();
    expect(inherited.tolerance).toBeUndefined();
  });
  it("解析 Ⅱ型为 II", () => {
    expect(parseSpecClassHint("Ⅱ型")).toBe("II");
    expect(parseSpecClassHint("III型")).toBe("III");
    expect(parseSpecClassHint("I型")).toBe("I");
  });

  it("追问Ⅱ型改变型号后必须重新查询全量正式数据", () => {
    const reused = filterReusableCandidates(last, { targetK: 0.3, specClass: "II", systemHint: "薄抹灰" });
    expect(reused).toBeNull();
  });

  it("修改目标 K 与型号不能在旧 top N 里继续筛选", () => {
    const reused = filterReusableCandidates(last, { targetK: 0.295, specClass: "II", systemHint: "薄抹灰" });
    expect(reused).toBeNull();
  });

  it("体系提示明显变化时不复用上一轮", () => {
    expect(filterReusableCandidates(last, { targetK: 0.3, systemHint: "岩棉" })).toBeNull();
  });

  it("缺省字段继承上一轮查询，不继承猜测的体系 UUID", () => {
    expect(inheritLookupQuery({ specClass: "II" }, last)).toEqual({
      targetK: 0.3,
      systemHint: "薄抹灰",
      specClass: "II"
    });
    expect(sanitizeSystemHint(" 薄%抹_灰 ")).toBe("薄抹灰");
  });

  it("薄抹灰按名称严格收窄，猜不中时返回空（禁止静默回退到其他体系）", () => {
    const narrowed = filterCandidatesBySystemHint(last.candidates, "薄抹灰");
    expect(narrowed).toHaveLength(2);
    const unmatched = filterCandidatesBySystemHint(last.candidates, "屋面");
    expect(unmatched).toHaveLength(0);
  });

  it("APPROX 复用上一轮候选时不会因 kValue > targetK 被误删", () => {
    const approxLast = {
      ...last,
      query: { targetK: 0.3, systemHint: "薄抹灰", mode: "APPROX" as const },
      candidates: [
        { id: "over", kValue: 0.303, systemName: "薄抹灰外保温", schemeId: "s3", productSpecId: "p3" },
        { id: "far", kValue: 0.55, systemName: "薄抹灰外保温", schemeId: "s4", productSpecId: "p4" }
      ]
    };
    const reused = filterReusableCandidates(approxLast, { targetK: 0.3, systemHint: "薄抹灰", mode: "APPROX" });
    // 0.303 落在 ±0.02 容差内被保留；0.55 超出容差被排除
    expect(reused?.map((item) => item.id)).toEqual(["over"]);
  });

  it("MAX_LIMIT 复用仍按 kValue <= targetK 收窄", () => {
    const limitLast = {
      ...last,
      query: { targetK: 0.3, systemHint: "薄抹灰", mode: "MAX_LIMIT" as const },
      candidates: [
        { id: "over", kValue: 0.303, systemName: "薄抹灰外保温", schemeId: "s3", productSpecId: "p3" },
        { id: "under", kValue: 0.294, systemName: "薄抹灰外保温", schemeId: "s4", productSpecId: "p4" }
      ]
    };
    const reused = filterReusableCandidates(limitLast, { targetK: 0.3, systemHint: "薄抹灰", mode: "MAX_LIMIT" });
    expect(reused?.map((item) => item.id)).toEqual(["under"]);
  });
});

describe("多轮指标与正式 ID 依赖收口 F—I", () => {
  const previous: LastReferenceLookup = {
    ...last,
    query: { metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX", tolerance: 0.05,
      systemId: "sys-i", systemHint: "薄抹灰", schemeId: "scheme-a1-3", schemeCode: "A1-3",
      specClass: "I", productSpecId: "spec-i-18", catalogProductId: "product-i" }
  };

  it("18mm追问继承 TOTAL_R、目标与模式，签名变化不能复用", () => {
    const next = normalizeConversationLookupQuery({ thicknessMm: 18 }, "18mm的呢？", previous);
    expect(next.query).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX", thicknessMm: 18 });
    expect(filterReusableCandidates(previous, next.query)).toBeNull();
    expect(normalizeConversationLookupQuery({ thicknessMm: 18 }, "厚度不低于18mm的呢？", previous).query.mode).toBe("APPROX");
    expect(normalizeConversationLookupQuery({}, "厚度不低于18mm，K不超过0.3", previous).query.filters).toMatchObject([{ metric: "TOTAL_R", mode: "APPROX" }, { metric: "K", mode: "MAX_LIMIT" }]);
    expect(normalizeConversationLookupQuery({}, "总热阻3.3左右，厚度不低于18mm", previous).query.mode).toBe("APPROX");
    expect(normalizeConversationLookupQuery({}, "精确K0.303", previous).query.filters?.find((filter) => filter.metric === "K")?.mode).toBe("EXACT");
  });

  it("明确取消K后查询总R；历史双R与来源页完整保存", () => {
    const next = normalizeConversationLookupQuery({ targetK: 0.3, mode: "MAX_LIMIT" }, "不限制K了，那总热阻3.3左右呢？", last);
    expect(next.query).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX" });
    expect(next.query.targetK).toBeUndefined();
    expect(next.conflict).toBe(true);
    expect(filterReusableCandidates(last, next.query)).toBeNull();
    const candidate = compactCandidateResult({ ...candidateRow(1), sourcePageId: "page-22", sourcePageLabel: "22" });
    const snapshot = { query: next.query, candidates: [candidate], createdAt: last.createdAt };
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify({ lastReferenceLookup: snapshot }))).lastReferenceLookup;
    expect(restored).toEqual(JSON.parse(JSON.stringify(snapshot)));
    expect(formatConversationTaskContext({ taskType: "GENERAL", lastReferenceLookup: restored })).toContain("目标总热阻 3.3");
  });

  it("切体系清旧方案、规格、产品，模型重复旧ID也不能带回", () => {
    const next = normalizeConversationLookupQuery({ systemId: "sys-i", schemeId: "scheme-a1-3", schemeCode: "A1-3", productSpecId: "spec-i-18" }, "那屋面系统呢？", previous);
    expect(next.query).toMatchObject({ systemHint: "屋面", metric: "TOTAL_R", targetValue: 3.3 });
    for (const key of ["systemId", "schemeId", "schemeCode", "productSpecId", "catalogProductId"] as const) expect(next.query[key]).toBeUndefined();
  });

  it("切Ⅱ型清旧规格/产品，保留独立的方案及指标", () => {
    const next = normalizeConversationLookupQuery({ productSpecId: "spec-i-18" }, "Ⅱ型呢？", previous);
    expect(next.query).toMatchObject({ specClass: "II", metric: "TOTAL_R", targetValue: 3.3, schemeId: "scheme-a1-3" });
    expect(next.query.productSpecId).toBeUndefined();
    expect(next.query.catalogProductId).toBeUndefined();
  });

  it("切产品清旧productSpec；切方案清依赖规格和旧方案ID", () => {
    expect(inheritLookupQuery({ catalogProductId: "product-new" }, previous).productSpecId).toBeUndefined();
    const next = inheritLookupQuery({ schemeCode: "A2-1" }, previous);
    expect(next.schemeId).toBeUndefined();
    expect(next.productSpecId).toBeUndefined();
    expect(next.schemeCode).toBe("A2-1");
  });

  it("纯参数/原页指代保留原指标，新的 R 查询不能复用", () => {
    const next = normalizeConversationLookupQuery({ metric: "PRODUCT_R", targetValue: 2.9 }, "刚才那个方案产品层热阻是多少？", previous);
    expect(next.attributeQuestion).toBe(true);
    expect(lookupQuerySignature(next.query)).toBe(lookupQuerySignature(previous.query));
    expect(normalizeConversationLookupQuery({}, "刚才那个方案总热阻3.4左右呢？", previous).attributeQuestion).toBe(false);
    expect(normalizeConversationLookupQuery({}, "刚才那页，容差上下0.01", previous).attributeQuestion).toBe(false);
    expect(normalizeConversationLookupQuery({}, "刚才那个方案改为不超过目标呢？", previous).attributeQuestion).toBe(false);
  });

  it("LLM容差无授权被忽略；旧历史容差也不可信；用户明确容差受上限限制", () => {
    expect(normalizeConversationLookupQuery({ targetK: 0.3, tolerance: 5 }, "K0.3左右").query.tolerance).toBe(0.02);
    const untrusted = { ...previous, query: { ...previous.query, tolerance: 5 } };
    expect(normalizeConversationLookupQuery({}, "18mm的呢？", untrusted).query.tolerance).toBe(0.05);
    const explicit = normalizeConversationLookupQuery({}, "K=0.3±0.01");
    expect(explicit.query).toMatchObject({ metric: "K", mode: "APPROX", tolerance: 0.01, toleranceSource: "USER" });
    expect(normalizeConversationLookupQuery({}, "总R3.3上下5").query.tolerance).toBe(0.2);
    const explicitLast = { ...last, query: explicit.query };
    expect(normalizeConversationLookupQuery({ thicknessMm: 18 }, "18mm的呢？", explicitLast).query.tolerance).toBe(0.01);
    const added = normalizeConversationLookupQuery({}, "总R3.3左右", explicitLast).query;
    expect(added.filters).toMatchObject([{ metric: "K", tolerance: 0.01 }, { metric: "TOTAL_R", tolerance: 0.05, toleranceSource: "DEFAULT" }]);
  });

  it.each(["metric", "targetValue", "mode", "tolerance", "systemId", "systemHint", "schemeId", "schemeCode", "specClass", "catalogProductId", "productSpecId", "thicknessMm"])("关键字段 %s 变化必须重查", (field) => {
    const value = field === "metric" ? "PRODUCT_R" : field === "mode" ? "MIN_LIMIT" : ["targetValue", "tolerance", "thicknessMm"].includes(field) ? 0.03 : "new";
    const next = { ...previous.query, [field]: value } as any;
    expect(lookupQuerySignature(next)).not.toBe(lookupQuerySignature(previous.query));
    expect(filterReusableCandidates(previous, next)).toBeNull();
  });
});

describe("Test 6：systemHint 必须先过滤再 limit（不能先取全局前 12 条）", () => {
  it("全局前 12 条都不是薄抹灰，第 13 条是薄抹灰且符合 K 条件 → 仍然命中第 13 条", () => {
    const rows = Array.from({ length: 12 }, (_, i) => candidateRow(i + 1, { systemName: "岩棉外保温系统", kValue: 0.3 }));
    rows.push(candidateRow(13, { systemName: "I 型 VICP 薄抹灰外保温系统", kValue: 0.303 }));
    const result = compactCandidateResults(rows, "薄抹灰", 12);
    expect(result.map((item) => item.id)).toEqual(["row-13"]);
    expect(result[0]!.systemName).toContain("薄抹灰");
  });

  it("未给体系提示时按原顺序截断（不受过滤影响）", () => {
    const rows = Array.from({ length: 15 }, (_, i) => candidateRow(i + 1));
    const result = compactCandidateResults(rows, undefined, 12);
    expect(result).toHaveLength(12);
    expect(result[0]!.id).toBe("row-1");
  });
});

describe("Test 7：systemHint 无匹配时禁止静默回退伪装成命中", () => {
  it.each(["薄抹灰", "薄抹灰系统", "保温薄抹灰系统", "VICP薄抹灰", "薄抹灰外保温", "ＶＩＣＰ 薄抹灰 系统"])("体系别名归一：%s", (hint) => {
    const candidates = compactCandidateResults([candidateRow(1, { systemName: "I 型 VICP 薄抹灰外保温系统" })], hint);
    expect(candidates).toHaveLength(1);
  });

  it("型号不能由 I 型子串误命中 II 型体系", () => {
    expect(compactCandidateResults([candidateRow(1, { systemName: "II 型 VICP 薄抹灰外保温系统" })], "I型薄抹灰")).toHaveLength(0);
  });

  it("所有正式候选字段 round-trip；多轮上下文保留双 R 与原页", () => {
    const original = { ...candidateRow(1), sourceDocumentId: "doc-1", sourcePageId: "page-22", sourcePageLabel: "22", ranking: { kGap: 0.003, isClosestToTarget: true }, compliant: null };
    const candidate = compactCandidateResult(original);
    const lookup = { query: { targetK: 0.3, targetR: 3, thicknessMm: 18, systemId: "sys-1", schemeId: "scheme-1", schemeCode: "A1-1", productSpecId: "spec-1", mode: "APPROX" as const }, candidates: [candidate], createdAt: new Date().toISOString() };
    const restored = parseConversationTaskState(JSON.parse(JSON.stringify({ taskType: "GENERAL", lastReferenceLookup: lookup })));
    expect(restored.lastReferenceLookup).toEqual(JSON.parse(JSON.stringify(lookup)));
    const context = formatConversationTaskContext(restored);
    expect(context).toContain("外墙主断面总热阻 R₀ 3.297");
    expect(context).toContain("产品层热阻 2.88");
    expect(context).toContain("page-22");
    expect(context).toContain("方案 A1-1");
  });

  it.each(["targetK", "targetR", "thicknessMm", "mode", "specClass", "systemId", "schemeId", "productSpecId"])("签名变化 %s 强制重新读取 DB", (key) => {
    const query = { ...last.query, [key]: key.startsWith("target") || key === "thicknessMm" ? 1 : key === "mode" ? "EXACT" : "II" } as any;
    expect(lookupQuerySignature(query)).not.toBe(lookupQuerySignature(last.query));
    expect(filterReusableCandidates(last, query)).toBeNull();
  });
  it("数据库没有薄抹灰时，严格过滤结果为空（由调用方显式标注 isFallback）", () => {
    const rows = Array.from({ length: 5 }, (_, i) => candidateRow(i + 1, { systemName: "岩棉外保温系统" }));
    expect(compactCandidateResults(rows, "薄抹灰", 12)).toHaveLength(0);
    expect(filterCandidatesBySystemHint(rows.map((row) => ({ id: row.candidateId, systemName: row.system.name ?? undefined })), "薄抹灰")).toHaveLength(0);
  });
});
