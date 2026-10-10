import { describe, expect, it } from "vitest";
import { classifyQueryLifecycle } from "./thermal-query-lifecycle.js";
import { resolveQueryEntities, type QueryEntity } from "./thermal-entity-resolver.js";
import { validateCandidateAgainstQueryState } from "./thermal-query-state.js";
import { normalizeConversationLookupQuery } from "../ai/tools/thermal-lookup.js";
import type { LastReferenceLookup } from "../ai/conversation-task.js";

const snapshot = (message: string): LastReferenceLookup => ({ query: normalizeConversationLookupQuery({}, message).query, candidates: [], createdAt: "2026-10-10" });

describe("NEW_QUERY / CONTINUE_QUERY 生命周期", () => {
  it("Case A：上一轮 PRODUCT_R≈8.3，下一轮独立问 K≈0.3 某体系 → 不继承旧 PRODUCT_R", () => {
    const previous = snapshot("产品层热阻8.3左右");
    expect(previous.query.filters?.[0]).toMatchObject({ metric: "PRODUCT_R", targetValue: 8.3 });
    const next = normalizeConversationLookupQuery({}, "保温薄抹灰传热系数0.3方案有么", previous);
    expect(next.lifecycle).toBe("NEW_QUERY");
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3 }]);
    expect(next.query.filters).toHaveLength(1);
  });
  it("Case B：上一轮 I型 K≈0.3，下一轮「那20mm以内呢」→ 继承 K≈0.3 并新增 thicknessMax", () => {
    const previous = snapshot("I型 K0.3左右");
    const next = normalizeConversationLookupQuery({}, "那20mm以内呢？", previous);
    expect(next.lifecycle).toBe("CONTINUE_QUERY");
    expect(next.query).toMatchObject({ thicknessMax: 20, filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
  });
  it("已展示18mm正式候选时，「那20以内呢」归一厚度上限，不把20误当K", () => {
    const previous = { ...snapshot("K0.3左右"), candidates: [{ id: "a", thicknessMm: 18, kValue: 0.303 }] };
    const next = normalizeConversationLookupQuery({}, "那20以内呢", previous);
    expect(next.lifecycle).toBe("CONTINUE_QUERY");
    expect(next.needsClarification).toBe(false);
    expect(next.query).toMatchObject({ thicknessMax: 20, filters: [{ metric: "K", targetValue: 0.3 }] });
    expect(normalizeConversationLookupQuery({}, "那K0.35以内呢", previous).query.filters?.[0]).toMatchObject({ metric: "K", targetValue: 0.35 });
  });
  it("Case C：上一轮已选候选，下一轮「这个再薄一点」→ REFINE，继承全部硬条件", () => {
    const previous = { ...snapshot("K0.3左右，20mm以内"), selectedCandidateIds: ["A1-3"] };
    const next = normalizeConversationLookupQuery({}, "这个再薄一点", previous);
    expect(next.lifecycle).toBe("REFINE_QUERY");
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3 }]);
    expect(next.query.preferThinner).toBe(true);
  });
  it("省略式增改（总R3.3左右）仍是 CONTINUE，不重置旧条件", () => {
    const previous = snapshot("K不超过0.3");
    const next = normalizeConversationLookupQuery({}, "总R3.3左右", previous);
    expect(next.lifecycle).toBe("CONTINUE_QUERY");
    expect(next.query.filters).toMatchObject([{ metric: "K", mode: "MAX_LIMIT" }, { metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX" }]);
  });
  it("完整新问题含厚度以内或语气词也重置，模型旧摘要不能复活", () => {
    const previous = snapshot("产品层热阻8.3左右，60mm以内");
    const next = normalizeConversationLookupQuery({ thicknessMax: 60, filters: previous.query.filters }, "薄抹灰K0.3，20mm以内有哪些方案呢", previous);
    expect(next.lifecycle).toBe("NEW_QUERY");
    expect(next.query.filters).toHaveLength(1);
    expect(next.query.thicknessMax).toBe(20);
    const noThickness = normalizeConversationLookupQuery({ thicknessMax: 60 }, "薄抹灰K0.3有哪些方案", previous);
    expect(noThickness.query.thicknessMax).toBeUndefined();
  });
  it.each([
    ["那20mm以内呢？", "CONTINUE_QUERY"],
    ["总R改成3.5以上", "REFINE_QUERY"],
    ["保温薄抹灰传热系数0.3方案有么", "NEW_QUERY"],
    ["第一个和第三个哪个好", "COMPARE_SELECTED"]
  ] as const)("分类：%s → %s", (message, expected) => {
    expect(classifyQueryLifecycle({ message, hasPrevious: true, hasNewMetricTarget: /传热系数|总R|K0|K 0/.test(message) })).toBe(expected);
  });
});

const entities: QueryEntity[] = [
  { field: "systemId", value: "sys-i", names: ["I型 VICP薄抹灰外保温系统", "EW-I"] },
  { field: "systemId", value: "sys-ii", names: ["II型 VICP薄抹灰外保温系统", "EW-II"] },
  { field: "systemId", value: "sys-iii", names: ["III型 VICP薄抹灰外保温系统", "EW-III"] },
  { field: "systemId", value: "sys-roof", names: ["屋面保温系统", "ROOF"] }
];

describe("Entity EXACT / FAMILY", () => {
  it("独立新体系主题即使不提供指标也清旧条件，模型旧摘要不复活", () => {
    const previous = snapshot("K0.3左右，20mm以内");
    const next = normalizeConversationLookupQuery({ filters: previous.query.filters, metric: previous.query.metric, targetValue: previous.query.targetValue }, "屋面有哪些方案", previous, { entities, aliases: [] });
    expect(next.lifecycle).toBe("NEW_QUERY");
    expect(next.query.systemId).toBe("sys-roof");
    expect(next.query.filters).toEqual([]);
    expect(next.query.thicknessMax).toBeUndefined();
  });
  it("完整正式名称解析唯一 systemId（EXACT）", () => {
    const next = resolveQueryEntities("I型 VICP薄抹灰外保温系统，K0.3左右", {}, entities);
    expect(next.systemId).toBe("sys-i");
    expect(next.systemIds).toBeUndefined();
  });
  it("只说族名「薄抹灰」解析为同族 systemIds 集合（FAMILY），不要求唯一 ID", () => {
    const next = resolveQueryEntities("薄抹灰，K0.3左右", {}, entities);
    expect(next.systemId).toBeUndefined();
    expect(new Set(next.systemIds)).toEqual(new Set(["sys-i", "sys-ii", "sys-iii"]));
    expect(next.unresolved ?? []).toHaveLength(0);
  });
  it("族名是硬约束：其他体系候选不能返回", () => {
    const query = resolveQueryEntities("薄抹灰，K0.3左右", {}, entities);
    expect(validateCandidateAgainstQueryState({ systemId: "sys-i" }, query).passed).toBe(true);
    expect(validateCandidateAgainstQueryState({ systemId: "sys-roof" }, query).passed).toBe(false);
  });
  it("单体系族（屋面）直接解析唯一 systemId", () => {
    const next = resolveQueryEntities("屋面，K0.3左右", {}, entities);
    expect(next.systemId).toBe("sys-roof");
    expect(next.systemIds).toBeUndefined();
  });
  it("配置给体系族的启用别名仍解析为集合硬条件", () => {
    const next = resolveQueryEntities("薄灰K0.3", {}, entities, [{ term: "薄抹灰", alias: "薄灰" }]);
    expect(new Set(next.systemIds)).toEqual(new Set(["sys-i", "sys-ii", "sys-iii"]));
    expect(next.unresolved ?? []).toHaveLength(0);
  });
  it("取消族条件清除集合，排除族条件对每个正式ID生效", () => {
    const previous = resolveQueryEntities("薄抹灰K0.3", {}, entities);
    expect(resolveQueryEntities("取消薄抹灰", {}, entities, [], previous).systemIds).toBeUndefined();
    const excluded = resolveQueryEntities("排除薄抹灰", {}, entities);
    expect(validateCandidateAgainstQueryState({ systemId: "sys-i" }, excluded).passed).toBe(false);
    expect(validateCandidateAgainstQueryState({ systemId: "sys-roof" }, excluded).passed).toBe(true);
  });
});

describe("自然表达变体归一", () => {
  it.each([
    ["传热系数0.3", "K"], ["K值0.3", "K"], ["K0.3", "K"], ["K做到0.3", "K"]
  ] as const)("K 变体 %s → %s", (message, metric) => {
    expect(normalizeConversationLookupQuery({}, message).query.filters?.[0]?.metric).toBe(metric);
  });
  it.each([
    ["产品热阻2.8", "PRODUCT_R"], ["板自身R2.8", "PRODUCT_R"], ["保温板自身热阻2.8", "PRODUCT_R"], ["板子热阻2.8", "PRODUCT_R"]
  ] as const)("PRODUCT_R 变体 %s → %s", (message, metric) => {
    expect(normalizeConversationLookupQuery({}, message).query.filters?.[0]?.metric).toBe(metric);
  });
  it.each([
    ["总热阻3.3", "TOTAL_R"], ["整墙热阻3.3", "TOTAL_R"], ["主断面热阻3.3", "TOTAL_R"], ["墙体R0 3.3", "TOTAL_R"]
  ] as const)("TOTAL_R 变体 %s → %s", (message, metric) => {
    expect(normalizeConversationLookupQuery({}, message).query.filters?.[0]?.metric).toBe(metric);
  });
  it("倒装与口语：「保温板自身热阻，有传热8.3的么」指标已明确，绑定 PRODUCT_R≈8.3，不再澄清", () => {
    // 用户已明确「保温板自身热阻」，metric 已 resolved；同句唯一合理数值 8.3 直接绑定，
    // 即使模型误传 metric=K 也必须以用户原话为准，不得回头再问「8.3 是不是产品层热阻」。
    const next = normalizeConversationLookupQuery({ metric: "K", targetValue: 8.3 }, "保温板自身热阻，有传热8.3的么");
    expect(next.needsClarification).toBe(false);
    expect(next.query.filters?.[0]).toMatchObject({ metric: "PRODUCT_R", targetValue: 8.3, mode: "APPROX" });
  });
});
