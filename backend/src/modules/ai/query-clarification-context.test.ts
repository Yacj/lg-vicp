import { expect, it } from "vitest";
import { recentQueryClarification, groundClarificationMetricEvidence, specificClarificationQuestion, isUnscopedResistanceField } from "./query-clarification-context.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { pendingNeedForAnswer } from "./query-need.js";
it.each(["PRODUCT_R", "TOTAL_R"] as const)("先补R再补口径时，%s的数值证据仍绑定原问，不能要求客户重复数字", metric => {
  const message = metric === "PRODUCT_R" ? "板材本身" : "整面墙的", original = "有没有热阻参数小于0.27的\nR";
  const semantic = domainSemanticFixture(message, "REFERENCE_QUERY", { queryContext: "CLARIFICATION_REPLY", reference: { scope: "NONE", revision: null, items: [] },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .94, unresolved: [], preferences: [], constraints: [{
      type: "METRIC", field: null, operation: "SET", value: .27, metric, operator: "MAX_LIMIT", evidence: message,
      entityText: null, resolvedText: null, hard: true, confidence: .94 }] } });
  const bound = groundClarificationMetricEvidence(message, original, semantic);
  expect(bound.pageQuery!.constraints[0]).toEqual({ ...semantic.pageQuery!.constraints[0], evidence: original });
  expect(bound.requestedEffect).toBe(semantic.requestedEffect); expect(bound.confidence).toBe(semantic.confidence);
  expect(groundClarificationMetricEvidence(message, "有没有0.27的", semantic)).toEqual(semantic);
  expect(groundClarificationMetricEvidence(message, "0.27还是0.4\nR", semantic)).toEqual(semantic);
  expect(groundClarificationMetricEvidence("改查λ", original, semantic)).toEqual(semantic);
});
const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
const now = Date.now();
it("新合同明确没有pending时不按CLARIFY复活普通咨询，未知版本也拒绝", () => {
  const rows: any = turns();
  rows[1].content = "产品优势需要看哪款？";
  rows[0].metadata.backendDecision.pendingQueryContractVersion = 1;
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
  rows[0].metadata.backendDecision.pendingQueryContractVersion = 2;
  rows[0].metadata.backendDecision.pendingQueryNeed = pendingNeedForAnswer("q", rows[1].content);
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
});
it("新合同的真实缺指标查询继续保留数值、比较符和原问身份", () => {
  const rows: any = turns();
  rows[1].content = "保温参数小于0.17";
  rows[0].metadata.backendDecision.pendingQueryContractVersion = 1;
  rows[0].metadata.backendDecision.pendingQueryNeed = pendingNeedForAnswer("q", rows[1].content,
    domainSemanticFixture(rows[1].content, "CLARIFY"), undefined, new Date(now - 2000));
  expect(recentQueryClarification(rows, conversation, now)).toMatchObject({ messageId: "q", message: "保温参数小于0.17" });
});
function turns() {
  return [{ id: "a", role: "ASSISTANT", content: "你指哪个指标？", createdAt: new Date(now - 1000), projectId: null,
    metadata: { queryScope: conversation, backendDecision: { domainIntent: "CLARIFY", requestedEffect: "READ_ONLY", relation: "NEW" } } },
  { id: "q", role: "USER", content: "保温0.3的材料有么", metadata: {}, createdAt: new Date(now - 2000), projectId: null }];
}
it("实际查询服务的澄清不依赖上游是否标记CLARIFY，仍保存原问及全部条件", () => {
  const rows: any = turns(), question = "按200mm钢筋混凝土基层的Excel参考给点建议";
  rows[1].content = question;
  rows[0].metadata.backendDecision = { domainIntent: "SOLUTION_ADVICE", requestedEffect: "READ_ONLY", relation: "NEW",
    queryNeedsClarification: true, pendingQueryNeed: pendingNeedForAnswer("q", question, undefined, undefined, new Date(now - 2000)) };
  const pending = recentQueryClarification(rows, conversation, now);
  expect(pending?.message).toBe(question); expect(pending?.need?.turns[0]?.message).toContain("200mm");
  rows[0].metadata.queryScope = { ...rows[0].metadata.queryScope, userId: "other" };
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
});
it("待澄清原话仅提供查询目标，不产生有效候选或继承旧查询", () => {
  const rows = turns(); const before = structuredClone(rows);
  expect(recentQueryClarification(rows, conversation, now)).toEqual({ messageId: "q", message: rows[1]!.content, question: rows[0]!.content,
    originCreatedAt: rows[1]!.createdAt.toISOString(), inheritPrevious: false });
  expect(rows).toEqual(before);
});
it("多轮只补充指标名时回链到带目标数值的原问，不把0.2/0.3丢掉", () => {
  const rows: any = [
    { id: "a2", role: "ASSISTANT", content: "热阻口径？", createdAt: new Date(now - 1000), projectId: null,
      metadata: { queryScope: conversation, backendDecision: { domainIntent: "CLARIFY", requestedEffect: "READ_ONLY", relation: "CONTINUE" } } },
    { id: "q2", role: "USER", content: "热阻", createdAt: new Date(now - 2000), projectId: null, metadata: {} },
    { id: "a1", role: "ASSISTANT", content: "λ/K/R？", createdAt: new Date(now - 3000), projectId: null,
      metadata: { queryScope: conversation, backendDecision: { domainIntent: "CLARIFY", requestedEffect: "READ_ONLY", relation: "NEW" } } },
    { id: "q1", role: "USER", content: "有什么保温 0.2的材料", createdAt: new Date(now - 4000), projectId: null, metadata: {} },
  ];
  // 多轮必须有服务器保存的原问连接；仅在历史里找到数字不能成为证据。
  expect(recentQueryClarification(rows, conversation, now)).toMatchObject({ messageId: "q2", message: "热阻" });
  rows[0].metadata.backendDecision.pendingQueryNeed = pendingNeedForAnswer("q2", "热阻",
    domainSemanticFixture("热阻", "CLARIFY"), { messageId: "q1", message: "有什么保温 0.2的材料", question: "指标？", inheritPrevious: false }, new Date(now - 2000));
  expect(recentQueryClarification(rows, conversation, now)).toMatchObject({ messageId: "q1", message: "有什么保温 0.2的材料\n热阻" });
  expect(specificClarificationQuestion("有什么保温 0.2的材料", "热阻")).toContain("0.2");
  expect(specificClarificationQuestion("有什么保温 0.2的材料", "热阻")).toContain("产品整体热阻");
  expect(specificClarificationQuestion("0.2还是0.3", "热阻")).toBeNull();
});
it("指标澄清记录为QUERY时仍是待澄清原问，不能因副作用字段丢掉0.35", () => {
  const rows: any = turns();
  rows[0].metadata.backendDecision.requestedEffect = "QUERY";
  expect(recentQueryClarification(rows, conversation, now)).toMatchObject({ messageId: "q", message: rows[1]!.content });
});
it("裸热阻字段不能被解析默认值代替用户口径，完整口径与概念问句不误拦", () => {
  for (const field of ["热阻", "R", "Ｒ", " r ", "传热阻"]) {
    expect(isUnscopedResistanceField(field)).toBe(true);
    expect(specificClarificationQuestion("保温小于0.17", field)).toContain("0.17");
  }
  for (const text of ["产品热阻", "整构造热阻", "总热阻", "芯材热阻", "热阻是什么意思"])
    expect(isUnscopedResistanceField(text)).toBe(false);
  expect(specificClarificationQuestion("保温小于0.17", "导热系数")).toBeNull();
  expect(specificClarificationQuestion("保温小于0.17", "K")).toBeNull();
});
it.each(["expired", "future", "user", "client", "project", "conversation", "missingScope", "report", "topic"])("%s不能成为续查证据", failure => {
  const rows: any = turns();
  if (failure === "expired") rows[1].createdAt = new Date(now - 25 * 3600_000);
  if (failure === "future") rows[1].createdAt = new Date(now + 1000);
  if (failure === "user") rows[0].metadata.queryScope = { ...conversation, userId: "other" };
  if (failure === "client") rows[0].metadata.queryScope = { ...conversation, clientApp: "b_admin" };
  if (failure === "project") rows[0].metadata.queryScope = { ...conversation, projectId: "other" };
  if (failure === "conversation") rows[0].metadata.queryScope = { ...conversation, id: "other" };
  if (failure === "missingScope") delete rows[0].metadata.queryScope;
  if (failure === "report") rows[0].metadata.backendDecision.requestedEffect = "REPORT_GENERATION";
  if (failure === "topic") rows[0].metadata.backendDecision.domainIntent = "KNOWLEDGE_EXPLAIN";
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
});
it("本轮K不带数字时，仅绑定原问唯一指标数值；不清除否定，不扩成副作用授权", () => {
  const message = "我指K", original = "保温0.3的材料有么";
  const semantic = domainSemanticFixture(message, "REFERENCE_QUERY", { queryContext: "CLARIFICATION_REPLY", pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .9, unresolved: [], preferences: [], constraints: [{ type: "METRIC", field: null, operation: "SET", value: .3, metric: "K", operator: "APPROX", evidence: message, entityText: null, resolvedText: null, hard: true, confidence: .9 }] } });
  expect(groundClarificationMetricEvidence(message, original, semantic).pageQuery!.constraints[0]!.evidence).toBe(original);
  for (const text of ["保温0.2还是0.3", "3型45mm", "K0.2"])
    expect(groundClarificationMetricEvidence(message, text, semantic).pageQuery!.constraints[0]!.evidence).toBe(message);
  expect(groundClarificationMetricEvidence("我指K0.2", original, semantic)).toBe(semantic);
  expect(groundClarificationMetricEvidence(message, original, { ...semantic, requestedEffect: "STATE_MUTATION" }).requestedEffect).toBe("STATE_MUTATION");
});
it("参数Service缺容差/未知名称可继续澄清；成功读取和零命中不恢复成pending", () => {
  const rows: any = turns(); rows[1].content = "λ0.3左右";
  rows[0].metadata.backendDecision = { domainIntent: "PRODUCT_PARAMETER_QUERY", requestedEffect: "READ_ONLY", relation: "NEW", parameterQueryDiagnostics: { missingTolerance: true, issues: ["FILTER_CONFLICT"] } };
  expect(recentQueryClarification(rows, conversation, now)?.message).toBe("λ0.3左右");
  rows[0].metadata.backendDecision.parameterQueryDiagnostics = { issues: ["NAME_UNRESOLVED"] };
  expect(recentQueryClarification(rows, conversation, now)).not.toBeNull();
  rows[0].metadata.backendDecision.parameterQueryDiagnostics = { issues: ["VALUE_NO_MATCH"] };
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
  rows[0].metadata.backendDecision.parameterQueryDiagnostics = { issues: [] };
  expect(recentQueryClarification(rows, conversation, now)).toBeNull();
});
