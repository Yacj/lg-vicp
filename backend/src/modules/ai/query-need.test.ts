import { expect, it } from "vitest";
import { checkPendingQueryContinuity, pendingNeedForAnswer, mergePendingParameterIdentity, mergePendingPageQuery } from "./query-need.js";
it("指标澄清保留已明确的产品名，不能把未知产品变成全库检索", () => {
  const message = "星石板小于0.24的有么", semantic = domainSemanticFixture(message, "CLARIFY", { readGoal: "PRODUCTS",
    productQuery: { scope: "IDENTITY", entityText: "星石板", granularity: "PRODUCT", evidence: message } });
  expect(pendingNeedForAnswer("root", message, semantic)?.identityHints).toEqual([{ field: "subjectText", text: "星石板" }]);
});
import { applySemanticQuery, type SemanticQuery } from "../thermal/semantic-query.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { inheritParameterTarget } from "./product-parameter-query.js";
const query = { parameter: "LAMBDA" as const, subjectType: "ANY" as const, subjectText: null, systemText: null,
  operator: "READ" as const, targetValue: null, tolerance: null, unit: "W/(m·K)" as const, evidence: "导热系数" };

it("未解析的旧基层厚度不能被后续另一组板厚数字掩盖", () => {
  const pending = { messageId: "root", message: "用180mm混凝土基层的发布示例", question: "请补充查询对象", inheritPrevious: false };
  const make = (value: number, evidence: string, field: "substrateThickness" | null = null) => ({ type: "THICKNESS" as const,
    operation: "SET" as const, field, entityText: null, resolvedText: null, metric: null, operator: "EXACT" as const,
    value, evidence, hard: true as const, confidence: .95 });
  const semantic = domainSemanticFixture("看看22mm和32mm", "REFERENCE_REFINE", { relation: "CONTINUE", queryContext: "CLARIFICATION_REPLY",
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, constraints: [make(22, "22mm")], preferences: [], unresolved: [] } });
  expect(checkPendingQueryContinuity("看看22mm和32mm", semantic, pending)).toContain("厚度");
  semantic.pageQuery!.constraints.push(make(180, "180mm", "substrateThickness"));
  expect(checkPendingQueryContinuity("看看22mm和32mm", semantic, pending)).toBeUndefined();
  expect(checkPendingQueryContinuity("换个话题", { ...semantic, relation: "SWITCH_TOPIC" }, pending)).toBeUndefined();
});

it.each([.21, .37, .63])("待完成页面查询保留%s范围和偏好，补板厚不放宽原需求", value => {
  const original = `K不超过${value}，尽量薄`, current = "板材22mm";
  const previous: SemanticQuery = { queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", confidence: .95, unresolved: [],
    constraints: [{ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: "K", operator: "MAX_LIMIT", value, evidence: `K不超过${value}`, confidence: .95, hard: true }],
    preferences: [{ field: "preferThinner", enabled: true, evidence: "尽量薄" }] };
  const next: SemanticQuery = { ...previous, constraints: [{ ...previous.constraints[0]!, type: "THICKNESS", metric: null, value: 22, operator: "EXACT", evidence: current }], preferences: [] };
  const need = pendingNeedForAnswer("root", original, domainSemanticFixture(original, "CLARIFY", { pageQuery: previous }))!;
  const merged = mergePendingPageQuery(next, need.pageQuery);
  const actual = applySemanticQuery(`${original}\n${current}`, merged, { entities: [], aliases: [] }, undefined, { currentMessage: current });
  expect(actual).toMatchObject({ thicknessMm: 22, filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: value }], preferences: { preferThinner: true }, unresolved: [] });
  const pending = { messageId: "root", message: original, question: "板厚？", inheritPrevious: false, need };
  const semantic = domainSemanticFixture(current, "REFERENCE_QUERY", { relation: "CONTINUE", queryContext: "CLARIFICATION_REPLY", pageQuery: next });
  expect(checkPendingQueryContinuity(current, semantic, pending)).toBeTruthy();
  expect(checkPendingQueryContinuity(current, { ...semantic, pageQuery: merged }, pending)).toBeUndefined();
  const changed = mergePendingPageQuery({ ...previous, constraints: [{ ...previous.constraints[0]!, value: .48, evidence: "K不超过0.48" }] }, previous);
  expect(changed.constraints.filter(item => item.type === "METRIC").map(item => item.value)).toEqual([.48]);
});
it.each(["SOLUTION_ADVICE", "MATERIAL_COMPARE", "KNOWLEDGE_EXPLAIN", "SOLUTION_ACTION", "REPORT_REQUEST", "THERMAL_CALCULATE"] as const)("%s的普通澄清不能创建待查询条件", intent => {
  const message = "请说明当前目标";
  expect(pendingNeedForAnswer("m", message, domainSemanticFixture(message, intent))).toBeUndefined();
});
it("建议触发的实际查询缺项仍可记录原条件，不因外层意图不同丢弃", () => {
  const message = "按200mm基层给点建议";
  const semantic = domainSemanticFixture(message, "SOLUTION_ADVICE");
  expect(pendingNeedForAnswer("m", message, semantic, undefined, undefined, true)?.turns[0]?.message).toBe(message);
});
it("未明查询标量仍可保存，普通无查询目标的GENERAL澄清不进入查询链", () => {
  expect(pendingNeedForAnswer("m", "保温0.17", domainSemanticFixture("保温0.17", "CLARIFY"))?.turns[0]?.message).toBe("保温0.17");
  expect(pendingNeedForAnswer("m", "你们有什么特点", domainSemanticFixture("你们有什么特点", "GENERAL"))).toBeUndefined();
});
it("活动查询不能被模型NEW/CURRENT_TURN的无条件读取抹掉，不依赖特定失败数值", () => {
  for (const value of [.17, .35, .82]) for (const comparison of ["小于", "不超过", "大于", "不低于"]) {
    const original = `保温指标${comparison}${value}`;
    const pending = { messageId: "root", message: original, question: "哪个指标？", inheritPrevious: false };
    const proposal = domainSemanticFixture("导热系数", "PRODUCT_PARAMETER_QUERY", { relation: "NEW", parameterQuery: query });
    expect(checkPendingQueryContinuity("导热系数", proposal, pending)).toBeTruthy();
    const merged = inheritParameterTarget(original, "导热系数", query);
    expect(checkPendingQueryContinuity("导热系数", { ...proposal, relation: "CONTINUE", queryContext: "CLARIFICATION_REPLY", parameterQuery: merged }, pending)).toBeUndefined();
  }
});
it("换话题/取消不绑定旧值，完整新对象读取可独立开始", () => {
  const pending = { messageId: "root", message: "指标小于0.7", question: "哪个？", inheritPrevious: false };
  for (const relation of ["SWITCH_TOPIC", "CANCEL"] as const)
    expect(checkPendingQueryContinuity("看看其他资料", domainSemanticFixture("看看其他资料", "PRODUCT_PARAMETER_QUERY", { relation, parameterQuery: query }), pending)).toBeUndefined();
  const proposal = domainSemanticFixture("读取甲板导热系数", "PRODUCT_PARAMETER_QUERY", { relation: "NEW", parameterQuery: { ...query, subjectText: "甲板" } });
  expect(checkPendingQueryContinuity("读取甲板导热系数", proposal, pending)).toBeUndefined();
});
it("串联原问的身份有服务器依据，后续不能丢名称扩大查询", () => {
  const semantic = domainSemanticFixture("甲体系小于0.6", "CLARIFY", { relation: "NEW", pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .9,
    constraints: [{ type: "ENTITY", field: "systemHint", entityText: "甲体系", resolvedText: null, evidence: "甲体系", operation: "SET", value: null, metric: null, operator: null, confidence: .9, hard: true }],
    preferences: [], unresolved: [] } });
  const need = pendingNeedForAnswer("root", "甲体系小于0.6", semantic)!;
  const pending = { messageId: "root", message: "甲体系小于0.6", question: "指标？", inheritPrevious: false, need };
  const proposal = domainSemanticFixture("导热系数", "PRODUCT_PARAMETER_QUERY", { queryContext: "CLARIFICATION_REPLY", parameterQuery: { ...query, operator: "LT", targetValue: .6 } });
  expect(checkPendingQueryContinuity("导热系数", proposal, pending)).toContain("甲体系");
  proposal.parameterQuery!.systemText = "甲体系";
  expect(checkPendingQueryContinuity("导热系数", proposal, pending)).toBeUndefined();
  expect(pendingNeedForAnswer("reply", "导热系数", proposal, pending)?.turns.map(turn => turn.messageId)).toEqual(["root", "reply"]);
});
it("续问只补指标时，原名称角色由Backend继承，不要求模型再猜归属", () => {
  const pending = { messageId: "root", message: "甲体系小于0.6", question: "指标？", inheritPrevious: false,
    need: { rootMessageId: "root", createdAt: new Date().toISOString(), turns: [{ messageId: "root", message: "甲体系小于0.6" }],
      identityHints: [{ field: "systemText" as const, text: "甲体系" }], inheritPrevious: false } };
  const misplaced = { ...query, subjectText: "甲体系", operator: "LT" as const, targetValue: .6 };
  expect(mergePendingParameterIdentity("导热系数", misplaced, pending)).toMatchObject({ systemText: "甲体系", subjectText: null, targetValue: .6, operator: "LT" });
  expect(mergePendingParameterIdentity("改为乙体系", { ...misplaced, systemText: "乙体系" }, pending).systemText).toBe("乙体系");
});
