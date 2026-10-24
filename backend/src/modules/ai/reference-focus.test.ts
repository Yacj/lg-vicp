import { expect, it } from "vitest";
import { currentReferenceFocus } from "./reference-focus.js";
const now = Date.now(), scope = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
const lookup = { projectId: null, createdAt: new Date(now).toISOString(), candidateQueryRevision: 3,
  candidates: [{ id: "a" }, { id: "b" }] } as any;
const row = (backendDecision: unknown, queryScope = scope) => ({ createdAt: new Date(now), metadata: { queryScope, backendDecision } });
it("本轮正式结果和实际读取对象分别提供焦点，不由模型生成身份", () => {
  expect(currentReferenceFocus([row({ domainIntent: "REFERENCE_QUERY", referenceQueryRevisionBefore: 2, referenceQueryRevisionAfter: 3 })], scope, lookup, now)).toEqual(["a", "b"]);
  expect(currentReferenceFocus([row({ domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["a", "invented"] })], scope, lookup, now)).toEqual(["a"]);
  expect(currentReferenceFocus([row({ domainIntent: "REFERENCE_QUERY", queryResultMode: "FACTS_ONLY", referenceQueryRevisionBefore: 2,
    referenceQueryRevisionAfter: 3, candidateIdList: ["a"] })], scope, lookup, now)).toEqual(["a"]); // Backend确实发布的正式候选才成为焦点。
});
it.each([
  { domainIntent: "REFERENCE_REFINE", referenceQueryRevisionBefore: 3, referenceQueryRevisionAfter: 3 },
  { domainIntent: "REFERENCE_REFINE", referenceQueryRevisionBefore: 2, referenceQueryRevisionAfter: 3, queryResultMode: "FACTS_ONLY" },
  { domainIntent: "REFERENCE_VIEW", referenceRevision: 2, candidateIdList: ["a"] },
  { domainIntent: "REFERENCE_VIEW", referencePageIds: ["page"] },
  { domainIntent: "PRODUCT_DISCOVERY", relation: "SWITCH_TOPIC" }
])("新只读结果、过期Revision或换题不会重新选回旧正式候选：%o", decision => {
  const old = row({ domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["a"] });
  expect(currentReferenceFocus([row(decision), old], scope, lookup, now)).toEqual([]);
});
it("相关解释可延续实际焦点；跨用户、超时或失效候选不能延续", () => {
  const history = [row({ domainIntent: "KNOWLEDGE_EXPLAIN", relation: "CONTINUE" }), row({ domainIntent: "REFERENCE_DETAIL", referenceRevision: 3, candidateIdList: ["b"] })];
  expect(currentReferenceFocus(history, scope, lookup, now)).toEqual(["b"]);
  expect(currentReferenceFocus([row({}, { ...scope, userId: "other" }), ...history], scope, lookup, now)).toEqual([]);
  expect(currentReferenceFocus(history, scope, { ...lookup, candidateResultInvalid: true }, now)).toEqual([]);
  expect(currentReferenceFocus(history, scope, lookup, now + 25 * 3600_000)).toEqual([]);
});
