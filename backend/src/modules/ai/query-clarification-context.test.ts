import { expect, it } from "vitest";
import { recentQueryClarification, groundClarificationMetricEvidence } from "./query-clarification-context.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
const now = Date.now();
function turns() {
  return [{ id: "a", role: "ASSISTANT", content: "你指哪个指标？", createdAt: new Date(now - 1000), projectId: null,
    metadata: { queryScope: conversation, backendDecision: { domainIntent: "CLARIFY", requestedEffect: "READ_ONLY", relation: "NEW" } } },
  { id: "q", role: "USER", content: "保温0.3的材料有么", metadata: {}, createdAt: new Date(now - 2000), projectId: null }];
}
it("待澄清原话仅提供查询目标，不产生有效候选或继承旧查询", () => {
  const rows = turns(); const before = structuredClone(rows);
  expect(recentQueryClarification(rows, conversation, now)).toEqual({ messageId: "q", message: rows[1]!.content, question: rows[0]!.content, inheritPrevious: false });
  expect(rows).toEqual(before);
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
