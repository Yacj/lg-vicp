import { describe, expect, it } from "vitest";
import { applySemanticQuery, describeNumberRoles, normalizeSemanticText, parseSemanticFastPath, type SemanticQuery } from "./semantic-query.js";
import { resolveQueryEntities } from "./thermal-entity-resolver.js";
import { identityMetricFailures, candidateIdentity } from "./thermal-candidate-identity.js";
import { validateCandidateAgainstQueryState } from "./thermal-query-state.js";
import { suggestQueryEntities } from "./thermal-entity-suggestions.js";

const dictionary = { entities: [
  { field: "systemId" as const, value: "sys-i", names: ["I型VICP薄抹灰外保温系统"], family: "薄抹灰" },
  { field: "systemId" as const, value: "sys-ii", names: ["II型VICP薄抹灰外保温系统"], family: "薄抹灰" },
  { field: "systemId" as const, value: "sys-board", names: ["保温装饰板系统"], category: "保温装饰板" },
  { field: "schemeId" as const, value: "scheme-i", names: ["A1-3"], systemId: "sys-i" },
  { field: "schemeId" as const, value: "scheme-board", names: ["A1-3"], systemId: "sys-board" }
], aliases: [{ term: "薄抹灰", alias: "外墙薄抹灰" }] };
const metric = (evidence: string, operator: "EXACT" | "APPROX" | "MAX_LIMIT" | "MIN_LIMIT" = "APPROX", value = 0.3, name: "K" | "TOTAL_R" | "PRODUCT_R" = "K"): SemanticQuery["constraints"][number] =>
  ({ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: name, operator, value, evidence, hard: true, confidence: 0.99 });
const parsed = (constraints: SemanticQuery["constraints"], queryMode: SemanticQuery["queryMode"] = "NEW_QUERY"): SemanticQuery => ({ queryMode, intent: "REFERENCE_LOOKUP", constraints, preferences: [], unresolved: [], confidence: 0.99 });

describe("统一语义分类的确定性边界", () => {
  it("Normalizer只改变格式，Fast Path只接受完整符号语法", () => {
    expect(normalizeSemanticText("Ｋ＝０．３，Ｒ₀ ≥ ３．３ ㎡·K/W")).toBe("K=0.3,R0 ≥ 3.3 m²·K/W");
    expect(parseSemanticFastPath("Ｋ <= ０．３")?.constraints[0]).toMatchObject({ metric: "K", operator: "MAX_LIMIT", value: 0.3 });
    expect(parseSemanticFastPath("K卡在0.3附近")).toBeNull();
  });
  it.each(["K正好0.3", "K是不是正好0.3", "K大概0.3", "K在0.3上下", "K别超过0.3", "K至少0.3", "K卡在0.3附近"])("语义分类的原话数字可验证：%s", message => {
    const op = message.includes("正好") ? "EXACT" : message.includes("超过") ? "MAX_LIMIT" : message.includes("至少") ? "MIN_LIMIT" : "APPROX";
    expect(applySemanticQuery(message, parsed([metric(message, op)]), dictionary).filters?.[0]).toMatchObject({ mode: op, targetValue: 0.3 });
  });
  it("开放口语由分类结果投影，族集合保持硬条件", () => {
    const message = "我想看看那种薄抹灰的，K差不多0.3，别超过20厚";
    const constraints: SemanticQuery["constraints"] = [
      { ...metric("薄抹灰"), type: "ENTITY", field: "systemId", entityText: "薄抹灰", resolvedText: "薄抹灰", metric: null, operator: null, value: null },
      metric("K差不多0.3"),
      { ...metric("别超过20厚", "MAX_LIMIT", 20), type: "THICKNESS", metric: null }
    ];
    const query = applySemanticQuery(message, parsed(constraints), dictionary);
    expect(query).toMatchObject({ systemIds: ["sys-i", "sys-ii"], thicknessMax: 20, filters: [{ metric: "K", mode: "APPROX", targetValue: 0.3 }] });
    expect(validateCandidateAgainstQueryState({ systemId: "sys-board", thicknessMm: 18, kValue: 0.301 }, query).passed).toBe(false);
  });
  it.each(["板自身R做到8.3有吗", "保温板自身热阻，有传热8.3的板么"])("唯一产品指标绑定远处目标：%s", message => {
    const query = applySemanticQuery(message, parsed([metric(message, "APPROX", 8.3, "PRODUCT_R")]), dictionary);
    expect(query.unresolved).toEqual([]);
    expect(query.filters?.[0]).toMatchObject({ metric: "PRODUCT_R", targetValue: 8.3 });
  });
  it("NEW清旧指标，CONTINUE追加厚度，REFINE只替换厚度", () => {
    const old = { filters: [{ metric: "PRODUCT_R" as const, targetValue: 8.3, mode: "APPROX" as const }] };
    const fresh = applySemanticQuery("薄抹灰K0.3有哪些方案", parsed([
      { ...metric("薄抹灰"), type: "ENTITY", field: "systemId", entityText: "薄抹灰", resolvedText: null, metric: null, operator: null, value: null }, metric("K0.3")
    ]), dictionary, old);
    expect(fresh.filters?.map(filter => filter.metric)).toEqual(["K"]);
    const follow = applySemanticQuery("那20以内呢", parsed([{ ...metric("20以内", "MAX_LIMIT", 20), type: "THICKNESS", metric: null }], "CONTINUE_QUERY"), dictionary, fresh);
    expect(follow).toMatchObject({ systemIds: ["sys-i", "sys-ii"], thicknessMax: 20, filters: [{ metric: "K" }] });
    const refine = applySemanticQuery("厚度改成25以内", parsed([{ ...metric("25以内", "MAX_LIMIT", 25), type: "THICKNESS", metric: null }], "REFINE_QUERY"), dictionary, follow);
    expect(refine.thicknessMax).toBe(25); expect(refine.filters).toEqual(follow.filters);
  });
  it("重复构造编号必须消歧，已知体系上下文可定位", () => {
    expect(resolveQueryEntities("A1-3", {}, dictionary.entities).unresolved).toContainEqual(expect.objectContaining({ field: "schemeId" }));
    expect(resolveQueryEntities("A1-3", {}, dictionary.entities, [], { systemId: "sys-i" }).schemeId).toBe("scheme-i");
    expect(resolveQueryEntities("A1-30 18mm", {}, dictionary.entities, [], { systemId: "sys-i" }).schemeId).toBeUndefined();
  });
  it("切型号清旧规格和产品；同族追问保留方案依赖", () => {
    const old = { systemIds: ["sys-i", "sys-ii"], schemeId: "scheme-i", specClass: "I" as const, productSpecId: "old-spec", catalogProductId: "old-product", thicknessMm: 18 };
    const sameFamily = resolveQueryEntities("薄抹灰", {}, dictionary.entities, [], old);
    expect(sameFamily.schemeId).toBe("scheme-i");
    const entities = [...dictionary.entities, { field: "specClass" as const, value: "II", names: ["II型", "Ⅱ型"] }];
    const next = applySemanticQuery("Ⅱ型呢", parsed([{ ...metric("Ⅱ型"), type: "ENTITY", field: "specClass", entityText: "Ⅱ型", resolvedText: "II型", metric: null, operator: null, value: null }], "REFINE_QUERY"), { ...dictionary, entities }, old);
    expect(next.specClass).toBe("II"); expect(next.productSpecId).toBeUndefined(); expect(next.catalogProductId).toBeUndefined(); expect(next.thicknessMm).toBe(18);
  });
  it("Fuzzy只给模型目录建议；模型不得省略族条件或返回未知实体", () => {
    expect(suggestQueryEntities("那种抹灰的保温系统", dictionary.entities, dictionary.aliases).some(entity => entity.value === "sys-i")).toBe(true);
    expect(applySemanticQuery("薄抹灰K0.3", parsed([metric("K0.3")]), dictionary).unresolved?.some(item => item.field === "systemId")).toBe(true);
    const unknown = { ...metric("那种抹灰的保温系统"), type: "ENTITY" as const, field: "systemId" as const,
      entityText: "那种抹灰的保温系统", resolvedText: "不存在的体系", metric: null, operator: null, value: null };
    expect(applySemanticQuery("那种抹灰的保温系统", parsed([unknown]), dictionary).unresolved?.length).toBeGreaterThan(0);
  });
  it("局部厚度上限更新/取消保留下限，取消全部厚度清偏好", () => {
    const old = { thicknessMin: 18, thicknessMax: 20, preferThinner: true };
    const refined = applySemanticQuery("厚度上限改成25以内", parsed([{ ...metric("25以内", "MAX_LIMIT", 25), type: "THICKNESS", metric: null }], "REFINE_QUERY"), dictionary, old);
    expect(refined).toMatchObject({ thicknessMin: 18, thicknessMax: 25 });
    const removed = applySemanticQuery("取消厚度上限", parsed([{ ...metric("取消厚度上限", "MAX_LIMIT"), type: "THICKNESS", operation: "REMOVE", metric: null, value: null }], "REFINE_QUERY"), dictionary, refined);
    expect(removed.thicknessMin).toBe(18); expect(removed.thicknessMax).toBeUndefined();
    const clear = applySemanticQuery("不限制厚度", parsed([{ ...metric("不限制厚度"), type: "THICKNESS", operation: "REMOVE", metric: null, operator: null, value: null }], "REFINE_QUERY"), dictionary, old);
    expect(clear.thicknessMin).toBeUndefined(); expect(clear.preferThinner).toBeUndefined();
  });
  it("基层厚度与保温厚度保持两个独立硬条件", () => {
    const query = applySemanticQuery("基层240mm，保温18mm", parsed([
      { ...metric("基层240mm", "EXACT", 240), type: "THICKNESS", field: "substrateThickness", metric: null },
      { ...metric("保温18mm", "EXACT", 18), type: "THICKNESS", metric: null }
    ]), dictionary);
    expect(query).toMatchObject({ substrateThickness: 240, thicknessMm: 18, unresolved: [] });
  });
  it("EXACT失败只保留指定身份厚度，不跳体系或厚度", () => {
    const rows = [
      { id: "r1", systemId: "sys-i", schemeId: "scheme-i", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.303 },
      { id: "r2", systemId: "sys-board", schemeId: "scheme-board", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.3 },
      { id: "r3", systemId: "sys-i", schemeId: "scheme-i", schemeCode: "A1-3", thicknessMm: 70, kValue: 0.3 }
    ];
    const query = { systemId: "sys-i", schemeCode: "A1-3", thicknessMm: 18, filters: [{ metric: "K" as const, targetValue: 0.3, mode: "EXACT" as const }] };
    expect(rows.filter(row => validateCandidateAgainstQueryState(row, query).passed)).toEqual([]);
    expect(identityMetricFailures(rows, query).map(item => item.candidate.id)).toEqual(["r1"]);
    expect(new Set(rows.map(candidateIdentity)).size).toBe(3);
  });
  it("拒绝模型数值、页号、年份、OR、未知实体及低置信结果", () => {
    for (const message of ["K0.3", "第22页", "2026年", "A1-3"]) expect(applySemanticQuery(message, parsed([metric(message, "EXACT", 22)]), dictionary).unresolved?.length).toBeGreaterThan(0);
    expect(describeNumberRoles("A1-3 18mm 第22页 2026年").map(item => item.role)).toEqual(["SCHEME_CODE_PART", "SCHEME_CODE_PART", "THICKNESS", "PAGE_NUMBER", "YEAR"]);
    expect(applySemanticQuery("K0.3或者总R3.3", parsed([metric("K0.3")]), dictionary).unresolved?.some(item => item.field === "relationship")).toBe(true);
  });
});
