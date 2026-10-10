import { describe, expect, it } from "vitest";
import { normalizeThermalLookupQuery } from "./thermal-lookup-mode.js";
import { rankByPreferences, traceQueryState, validateCandidateAgainstQueryState, type ConstraintCandidate, type ThermalQueryState } from "./thermal-query-state.js";
import { resolveQueryEntities, type QueryEntity } from "./thermal-entity-resolver.js";
import { normalizeConversationLookupQuery } from "../ai/tools/thermal-lookup.js";
import { parseConversationTaskState } from "../ai/conversation-task.js";

const row: ConstraintCandidate = { systemId: "sys-A", systemName: "体系甲", schemeId: "scheme-A", schemeCode: "S-A", catalogProductId: "product-A",
  productSpecId: "spec-A", specClass: "I", substrateMaterial: "材料甲", substrateThickness: 200, setBuildingTypes: ["建筑甲"],
  thicknessMm: 20, kValue: 0.3, totalThermalResistance: 3.3, productThermalResistance: 2.8,
  structureType: "结构甲", regionCode: "region-A", standardLimitId: "standard-A", sourceDocumentId: "doc-A", sourceVersionId: "version-A" };
const dimensions: ThermalQueryState[] = [
  { systemId: row.systemId }, { systemHint: "体系甲" }, { schemeId: row.schemeId }, { schemeCode: row.schemeCode },
  { catalogProductId: row.catalogProductId! }, { productSpecId: row.productSpecId }, { specClass: "I" },
  { substrateMaterial: row.substrateMaterial }, { substrateThickness: 200 }, { thicknessMm: 20 }, { thicknessMin: 20 }, { thicknessMax: 20 },
  { buildingType: "建筑甲" }, { structureType: "结构甲" }, { regionCode: row.regionCode }, { standardLimitId: row.standardLimitId },
  { documentIds: ["doc-A"] }, { knowledgeVersionIds: ["version-A"] }
];

describe("统一查询约束不变量", () => {
  it.each(dimensions.map((query, index) => [index, query] as const))("维度 %i：匹配与缺数据必须确定性区分", (_index, query) => {
    expect(validateCandidateAgainstQueryState(row, query).passed).toBe(true);
    expect(validateCandidateAgainstQueryState({}, query).passed).toBe(false);
  });
  it.each([1, 2, 3, 5, dimensions.length])("%i 条条件始终 AND，软偏好不能放回违规行", count => {
    const query = Object.assign({}, ...dimensions.slice(0, count), { preferences: { preferThinner: true } }) as ThermalQueryState;
    const input = [row, { ...row, systemId: "sys-B", thicknessMm: 1 }, {}];
    const matched = rankByPreferences(input.filter(candidate => validateCandidateAgainstQueryState(candidate, query).passed), query);
    expect(matched).toEqual([row]);
    expect(matched.every(candidate => validateCandidateAgainstQueryState(candidate, query).passed)).toBe(true);
  });
  it("生成值覆盖三个指标和四种模式的边界，不以固定关键词作为业务逻辑", () => {
    let seed = 7321;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (const metric of ["K", "PRODUCT_R", "TOTAL_R"] as const) for (const mode of ["APPROX", "EXACT", "MAX_LIMIT", "MIN_LIMIT"] as const) {
      for (let n = 0; n < 50; n++) {
        const target = 0.1 + random() * (metric === "K" ? 2 : 10);
        const query = normalizeThermalLookupQuery({ metric, mode, targetValue: target });
        const key = metric === "K" ? "kValue" : metric === "PRODUCT_R" ? "productThermalResistance" : "totalThermalResistance";
        for (const delta of [-0.3, -0.01, 0, 0.01, 0.3]) {
          const candidate = { ...row, [key]: target + delta };
          const expected = mode === "MAX_LIMIT" ? delta <= 0 : mode === "MIN_LIMIT" ? delta >= 0 : Math.abs(delta) <= query.tolerance!;
          expect(validateCandidateAgainstQueryState(candidate, query).passed).toBe(expected);
        }
      }
    }
  });
  it("排除与来源范围也属于硬条件，未知排除字段事实不能证明通过", () => {
    expect(validateCandidateAgainstQueryState(row, { exclusions: [{ field: "systemId", value: row.systemId! }] }).passed).toBe(false);
    expect(validateCandidateAgainstQueryState(row, { documentIds: ["other"] }).failed).toContain("documentIds");
  });
  it("厚度多轮增改删和冲突更新不丢实体/多指标条件，JSON 往返保留完整状态", () => {
    let query = traceQueryState({ systemId: "sys-A", productSpecId: "spec-A", regionCode: "region-A", buildingType: "建筑甲",
      filters: normalizeThermalLookupQuery({ filters: [{ metric: "K", mode: "APPROX", targetValue: 0.3 }, { metric: "TOTAL_R", mode: "MIN_LIMIT", targetValue: 3.3 }] }).filters,
      thicknessMax: 20 });
    for (const message of ["那25以内呢", "只看30mm以上", "不限制厚度了", "刚才那个的原页", "厚度20mm以内"]) {
      const last = { query, candidates: [], createdAt: "2026-10-10" };
      query = normalizeConversationLookupQuery({}, message, last).query;
      expect(query.systemId).toBe("sys-A"); expect(query.productSpecId).toBe("spec-A");
      expect(query.regionCode).toBe("region-A"); expect(query.buildingType).toBe("建筑甲");
      expect(query.filters).toHaveLength(2);
      if (message.includes("30")) expect(query).toMatchObject({ thicknessMin: 30, thicknessMax: undefined });
      const restored = parseConversationTaskState(JSON.parse(JSON.stringify({ lastReferenceLookup: { ...last, query } }))).lastReferenceLookup;
      expect(restored?.query).toEqual(JSON.parse(JSON.stringify(query)));
    }
  });
  it("无操作或模型猜测不能修改已确认指标", () => {
    const query = normalizeConversationLookupQuery({ metric: "K", targetValue: 0.3, mode: "APPROX" }, "K0.3左右").query;
    const next = normalizeConversationLookupQuery({ filters: [{ metric: "K", targetValue: 0.7, mode: "EXACT" }] }, "刚才那个的说明", { query, candidates: [], createdAt: "2026-10-10" });
    expect(next.query.filters).toEqual(query.filters);
  });
  it("取消指标的 tombstone 在下一轮无操作时仍阻止模型复活", () => {
    const first = normalizeConversationLookupQuery({}, "K0.3左右").query;
    const removed = normalizeConversationLookupQuery({}, "取消K条件", { query: first, candidates: [], createdAt: "2026-10-10" }).query;
    expect(removed.filters).toEqual([]);
    const next = normalizeConversationLookupQuery({ filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] }, "解释一下", { query: removed, candidates: [], createdAt: "2026-10-10" }).query;
    expect(next.filters).toEqual([]);
    const restored = normalizeConversationLookupQuery({}, "K0.3左右", { query: next, candidates: [], createdAt: "2026-10-10" }).query;
    expect(restored.filters).toHaveLength(1); expect(restored.removedMetrics).not.toContain("K");
  });
  it("实体取消作为 tombstone 持久化，后续模型重复旧 ID 不能复活", () => {
    const dictionary = { entities: [{ field: "systemId" as const, value: "sys-A", names: ["体系甲"] }], aliases: [] };
    const first = normalizeConversationLookupQuery({ systemId: "sys-A" }, "体系甲，K0.3左右", undefined, dictionary).query;
    const removed = normalizeConversationLookupQuery({ systemId: "sys-A" }, "不限制体系了", { query: first, candidates: [], createdAt: "2026-10-10" }, dictionary).query;
    expect(removed.systemId).toBeUndefined(); expect(removed.removedFields).toContain("systemId");
    const next = normalizeConversationLookupQuery({ systemId: "sys-A" }, "厚度20mm以内", { query: removed, candidates: [], createdAt: "2026-10-10" }, dictionary).query;
    expect(next.systemId).toBeUndefined();
    const restored = normalizeConversationLookupQuery({}, "还是体系甲", { query: next, candidates: [], createdAt: "2026-10-10" }, dictionary).query;
    expect(restored.systemId).toBe("sys-A"); expect(restored.removedFields).not.toContain("systemId");
  });
  it("模型重复的不同厚度与型号不能改变用户未操作的硬条件", () => {
    const query = { thicknessMax: 20, specClass: "I" as const, ...normalizeThermalLookupQuery({ metric: "K", targetValue: 0.3 }) };
    const next = normalizeConversationLookupQuery({ thicknessMm: 25, specClass: "II" }, "请解释一下", { query, candidates: [], createdAt: "2026-10-10" }).query;
    expect(next.thicknessMax).toBe(20); expect(next.thicknessMm).toBeUndefined(); expect(next.specClass).toBe("I");
  });
  it("优先型号属于偏好，不能变成硬过滤；清除型号不能被模型重复参数复活", () => {
    const preferred = normalizeConversationLookupQuery({ specClass: "I" }, "K0.3左右，优先I型").query;
    expect(preferred.specClass).toBeUndefined(); expect(preferred.preferences?.entities).toContainEqual({ field: "specClass", value: "I" });
    const removed = normalizeConversationLookupQuery({ specClass: "I" }, "不限制型号了", { query: { specClass: "II" }, candidates: [], createdAt: "2026-10-10" }).query;
    expect(removed.specClass).toBeUndefined();
  });
});

describe("正式目录与别名统一解析", () => {
  const entities: QueryEntity[] = [
    { field: "systemId", value: "sys-A", names: ["体系甲", "SYS-A"] }, { field: "systemId", value: "sys-B", names: ["体系乙", "SYS-B"] },
    { field: "productSpecId", value: "spec-B", names: ["规格乙"] }, { field: "regionCode", value: "region-A", names: ["地区甲"] },
    { field: "substrateMaterial", value: "材料甲", names: ["材料甲"] }
  ];
  it.each(entities)("通用字段 $field 由正式名称解析", entity => {
    expect(resolveQueryEntities(`${entity.names[0]}，K0.3左右`, {}, entities)[entity.field]).toBe(entity.value);
  });
  it("配置别名、偏好、排除、依赖清除和歧义均采用同一解析器", () => {
    expect(resolveQueryEntities("甲别称", {}, entities, [{ term: "体系甲", alias: "甲别称" }]).systemId).toBe("sys-A");
    expect(resolveQueryEntities("优先体系甲", {}, entities).systemId).toBeUndefined();
    expect(resolveQueryEntities("不要体系乙", {}, entities).exclusions).toEqual([{ field: "systemId", value: "sys-B" }]);
    expect(resolveQueryEntities("体系甲或者体系乙", {}, entities).unresolved).toHaveLength(1);
    const previous = { systemId: "sys-A", schemeId: "old", productSpecId: "old", catalogProductId: "old", systemHint: "体系甲" };
    const changed = resolveQueryEntities("换体系乙", previous, entities, [], previous);
    expect(changed.systemId).toBe("sys-B"); expect(changed.schemeId).toBeUndefined(); expect(changed.systemHint).toBeUndefined();
    expect(resolveQueryEntities("不限制体系了", previous, entities, [], previous).systemId).toBeUndefined();
  });
});


describe("歧义、冲突及历史损坏不得悄悄放宽", () => {
  it("指标歧义在无指标操作的下一轮持续存在，明确指标才清除", () => {
    const query = { systemId: "sys-A", unresolved: [{ field: "metric", reason: "请选择指标" }] };
    const last = { query, candidates: [], createdAt: "2026-10-10" };
    expect(normalizeConversationLookupQuery({}, "20mm以内", last).query.unresolved).toHaveLength(1);
    expect(normalizeConversationLookupQuery({}, "产品层热阻3左右", last).query.unresolved).toHaveLength(0);
  });
  it.each(["K", "TOTAL_R", "PRODUCT_R"] as const)("%s 冲突追加范围进入 unresolved，替换后解除", metric => {
    const query = traceQueryState({ filters: normalizeThermalLookupQuery({ filters: [
      { metric, mode: "MAX_LIMIT", targetValue: 2 }, { metric, mode: "MIN_LIMIT", targetValue: 3 }
    ] }).filters });
    expect(query.unresolved).toHaveLength(1);
    expect(validateCandidateAgainstQueryState(row, query).passed).toBe(false);
    expect(traceQueryState({ ...query, filters: query.filters!.slice(0, 1) }).unresolved).toEqual([]);
  });
  it("未知显式实体进入 unresolved，已确认偏好不因未提及消失", () => {
    const previous = { preferences: { preferLowerK: true } };
    const next = resolveQueryEntities("体系：陌生体系，20mm以内", {}, [], [], previous);
    expect(next.unresolved?.[0]?.field).toBe("systemId"); expect(next.preferences?.preferLowerK).toBe(true);
  });
  it("单字段历史损坏保留其余硬条件并要求确认，不能抛异常或静默取消", () => {
    const state = parseConversationTaskState({ lastReferenceLookup: { query: { systemId: "sys-A", thicknessMax: "坏数据" }, candidates: [], createdAt: "2026-10-10" } });
    expect(state.lastReferenceLookup?.query.systemId).toBe("sys-A");
    expect(state.lastReferenceLookup?.query.unresolved?.[0]?.field).toBe("thicknessMax");
  });
  it("裸明确指标不会采用模型 EXACT；实体和来源范围进入 trace", () => {
    expect(normalizeConversationLookupQuery({ mode: "EXACT" }, "传热系数0.3").query.mode).toBe("APPROX");
    const query = traceQueryState({ documentIds: ["doc-A"], unresolved: [{ field: "systemId", reason: "未确定" }] });
    expect(query.conditionTrace).toContainEqual(expect.objectContaining({ field: "documentIds", classification: "HARD_CONSTRAINT" }));
    expect(query.conditionTrace).toContainEqual(expect.objectContaining({ field: "systemId", classification: "AMBIGUOUS" }));
  });
});


describe("局部操作不能复活或改写其他条件", () => {
  it("无操作时模型旧摘要字段也不能切换指标/目标", () => {
    const first = normalizeConversationLookupQuery({}, "K0.3左右").query;
    const next = normalizeConversationLookupQuery({ metric: "TOTAL_R", targetValue: 9, targetR: 9, mode: "EXACT" }, "解释一下", { query: first, candidates: [], createdAt: "2026-10-10" }).query;
    expect(next.filters).toEqual(first.filters);
  });
  it("切规格清旧型号；模型体系提示不能删除历史正式体系ID", () => {
    const dictionary = { entities: [{ field: "productSpecId" as const, value: "spec-B", names: ["规格乙"] }], aliases: [] };
    const last = { query: { systemId: "sys-A", specClass: "I" as const, productSpecId: "spec-A" }, candidates: [], createdAt: "2026-10-10" };
    expect(normalizeConversationLookupQuery({ systemHint: "模型猜测" }, "解释一下", last, dictionary).query.systemId).toBe("sys-A");
    expect(normalizeConversationLookupQuery({}, "换规格乙", last, dictionary).query.specClass).toBeUndefined();
  });
  it("新增排除保留旧排除；取消排除不删除硬体系或其他排除", () => {
    const entities: QueryEntity[] = [{ field: "systemId", value: "sys-B", names: ["体系乙"] }];
    const previous = { systemId: "sys-A", exclusions: [{ field: "substrateMaterial" as const, value: "材料丙" }] };
    const excluded = resolveQueryEntities("排除体系乙", {}, entities, [], previous);
    expect(excluded.exclusions).toHaveLength(2);
    const removed = resolveQueryEntities("取消排除体系乙", {}, entities, [], excluded);
    expect(removed.exclusions).toEqual(previous.exclusions);
    expect(normalizeConversationLookupQuery({}, "取消排除体系乙", { query: { ...excluded, systemId: "sys-A" }, candidates: [], createdAt: "2026-10-10" }, { entities, aliases: [] }).query.systemId).toBe("sys-A");
  });
});


it("实体 unresolved 在无实体操作轮次不能消失", () => {
  const query = { unresolved: [{ field: "systemId", reason: "请确认体系" }] };
  const result = normalizeConversationLookupQuery({}, "20mm以内", { query, candidates: [], createdAt: "2026-10-10" }, { entities: [], aliases: [] });
  expect(result.query.unresolved).toHaveLength(1);
  expect(validateCandidateAgainstQueryState(row, result.query).passed).toBe(false);
});


it.each(["传热8.3", "保温性能0.3", "差不多3左右", "R3.3"])("未明确指标 %s 进入歧义，不接受模型猜测", message => {
  const result = normalizeConversationLookupQuery({ metric: "TOTAL_R", targetValue: 3 }, message);
  expect(result.needsClarification).toBe(true); expect(result.query.unresolved?.[0]?.field).toBe("metric");
});
it.each(["K低一点更好", "产品层热阻高一点更好", "整墙热阻越高越好"])("无数值偏好 %s 不要求新的目标，不改变硬指标", message => {
  const dictionary = { entities: [], aliases: [] };
  const first = normalizeConversationLookupQuery({}, "K0.3左右", undefined, dictionary).query;
  const next = normalizeConversationLookupQuery({}, message, { query: first, candidates: [], createdAt: "2026-10-10" }, dictionary);
  expect(next.needsClarification).toBe(false); expect(next.query.filters).toEqual(first.filters);
  expect(next.query.preferences?.preferLowerK || next.query.preferences?.preferHigherR).toBe(true);
});
it("OR 歧义不能被下一轮厚度操作清除，明确 AND 才解除", () => {
  const first = normalizeConversationLookupQuery({}, "K≤0.3或者总R≥3.3").query;
  const second = normalizeConversationLookupQuery({}, "20mm以内", { query: first, candidates: [], createdAt: "2026-10-10" }).query;
  expect(second.unresolved).toContainEqual(expect.objectContaining({ field: "relationship" }));
  const third = normalizeConversationLookupQuery({}, "条件都要满足", { query: second, candidates: [], createdAt: "2026-10-10" }).query;
  expect(third.unresolved?.some(item => item.field === "relationship")).toBe(false);
});


it.each(["PRODUCT_R", "TOTAL_R"] as const)("已明确 %s 后裸R数值继承指标，不再重复问", metric => {
  const first = normalizeConversationLookupQuery({}, `${metric}3左右`).query;
  const next = normalizeConversationLookupQuery({}, "R3.5左右", { query: first, candidates: [], createdAt: "2026-10-10" });
  expect(next.needsClarification).toBe(false); expect(next.query).toMatchObject({ metric, targetValue: 3.5, mode: "APPROX" });
});
