import "dotenv/config";
import { expect, it } from "vitest";
import { bindPendingResistanceScope, canReviewPendingResistanceScope } from "./pending-resistance-scope.js";
import type { QueryClarification } from "./query-need.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
const message = "完整板材自身";
const pending = (value = .27, comparison = "小于"): QueryClarification => ({ messageId: "q1", message: `找保温${comparison}${value}的材料\nR`,
  question: "产品、芯层还是整构造？", inheritPrevious: false, need: { rootMessageId: "q1", createdAt: new Date().toISOString(), goal: "MATERIALS",
    turns: [{ messageId: "q1", message: `找保温${comparison}${value}的材料` }, { messageId: "q2", message: "R" }], identityHints: [], inheritPrevious: false } });
const raw = { reply: "SCOPE", metric: "PRODUCT_R", originalConditionsCovered: true, confidence: .96, evidence: message };
it.each([.17, .27, .42])("只解析新增口径，原问数值%s及比较条件由Backend保留；不能产生正式操作", value => {
  const p = pending(value), before = structuredClone(p), result = bindPendingResistanceScope(message, p, raw)!;
  expect(result.semantic.pageQuery!.constraints.at(-1)).toMatchObject({ metric: "PRODUCT_R", value, operator: "MAX_LIMIT", evidence: p.message });
  expect(applyDomainPolicy(message, result.semantic)).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY" });
  expect(result.semantic).toMatchObject({ requestedEffect: "QUERY", effectRequest: null, reference: { scope: "NONE", items: [] } });
  expect(result.semantic.calculationRequest).toBeUndefined(); expect(p).toEqual(before);
});
it("保留已保存的厚度与来源，不让口径变更删除原条件", () => {
  const p = pending(); p.message = `基层120mm，${p.message}`;
  p.need!.pageQuery = { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .8, preferences: [], unresolved: [],
    sourceScope: { kind: "REFERENCE_SET", ids: ["8e160ed2-f332-4ae9-908c-b15ff0d725a7"], evidence: "已指定资料" },
    constraints: [{ type: "THICKNESS", field: "substrateThickness", entityText: null, resolvedText: null, metric: null,
      value: 120, operator: "EXACT", operation: "SET", evidence: "基层120mm", confidence: .96, hard: true }] };
  const result = bindPendingResistanceScope(message, p, { ...raw, metric: "TOTAL_R" })!;
  expect(result.semantic.pageQuery!.sourceScope).toEqual(p.need!.pageQuery.sourceScope);
  expect(result.semantic.pageQuery!.constraints[0]).toEqual(p.need!.pageQuery.constraints[0]);
});
it.each(["confidence", "evidence", "missingScope", "newNumber", "noPending", "inheritedTask", "unknownName", "unrepresented", "action"])("%s拒绝扩大状态或提高授权", kind => {
  const p = pending(), r: any = { ...raw }; let text = message;
  if (kind === "confidence") r.confidence = .89;
  if (kind === "evidence") r.evidence = "板材";
  if (kind === "missingScope") r.metric = null;
  if (kind === "newNumber") text += "改成0.9";
  if (kind === "noPending") p.need = undefined;
  if (kind === "inheritedTask") p.inheritPrevious = true;
  if (kind === "unknownName") p.need!.identityHints.push({ field: "systemText", text: "某体系" });
  if (kind === "unrepresented") r.originalConditionsCovered = false;
  if (kind === "action") r.operation = "CONFIRM";
  expect(bindPendingResistanceScope(text, p, r)).toBeUndefined();
});
it("不是紧邻R口径澄清或原问有多个数值时不合成查询", () => {
  const p = pending(); p.need!.turns.at(-1)!.message = "解释参数";
  expect(canReviewPendingResistanceScope(message, p)).toBe(false);
  p.need!.turns.at(-1)!.message = "R";p.message += "或0.5";
  expect(canReviewPendingResistanceScope(message, p)).toBe(false);
});
it.each([false,true])("可选对象分类缺失不丢已明确R家族；致谢插话%s不重问指标",thanks=>{
  const p=pending(.37,'小于');delete p.need!.goal;
  if(thanks){p.need!.turns.splice(1,0,{messageId:'g',message:'谢谢'});p.message=p.need!.turns.map(turn=>turn.message).join('\n');}
  const reply='整套围护构造';
  expect(canReviewPendingResistanceScope(reply,p)).toBe(true);
  const result=bindPendingResistanceScope(reply,p,{...raw,metric:'TOTAL_R',evidence:reply},2)!;
  expect(result.semantic.readGoal).toBeUndefined();
  expect(result.semantic.pageQuery!.constraints.at(-1)).toMatchObject({metric:'TOTAL_R',value:.37,operator:'LT',evidence:p.message});
  expect(result.semantic.effectRequest).toBeNull();expect(result.semantic.requestedEffect).toBe('QUERY');
});
