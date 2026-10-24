import "dotenv/config";
import { expect, it } from "vitest";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { bindProductReadReview } from "./product-continuation-review.js";

const message = "说明简短些";
const query = { scope: "IDENTITY" as const, entityText: "甲板", granularity: "PRODUCT" as const, evidence: "甲板" };
const proposal = () => domainSemanticFixture(message, "PRODUCT_DETAIL", { relation: "CONTINUE", requestedEffect: "READ_ONLY",
  productQuery: { ...query, evidence: message }, reference: { scope: "NONE", revision: null, items: [] },
  productContinuation: { action: "EXPLAIN_PARAMETER", field: null, match: null, evidence: message } });
const review = { action: "REPHRASE", field: null, confidence: .95, evidence: message };
it("参数全集和改写目标分别复核；field为空不能让PARAMETERS退回介绍", () => {
  const original = proposal();
  expect(bindProductReadReview(message, original, query, { ...review, action: "PARAMETERS" }))
    .toMatchObject({ productContinuation: { action: "PARAMETERS", field: null }, requestedEffect: "READ_ONLY" });
  expect(bindProductReadReview(message, original, query, review))
    .toMatchObject({ productContinuation: { action: "REPHRASE", field: null } });
});
it("空构造查询可复核为同产品参数读取；已有硬条件不能被消除", () => {
  const text = "这种板材都有哪些厚度", original = domainSemanticFixture(text, "REFERENCE_QUERY", { relation: "NEW", effectRequest: null,
    reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .84,
      constraints: [], preferences: [], unresolved: [] } });
  const result = bindProductReadReview(text, original, query, { action: "PARAMETERS", field: "THICKNESS", confidence: .95, evidence: text });
  expect(result).toMatchObject({ intent: "PRODUCT_DETAIL", relation: "CONTINUE", requestedEffect: "READ_ONLY", pageQuery: null,
    productQuery: { entityText: "甲板" }, productContinuation: { action: "PARAMETERS", field: "THICKNESS" } });
  original.pageQuery!.constraints.push({ type: "THICKNESS", field: null, operation: "SET", entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 28, hard: true, confidence: .98, evidence: "28mm" });
  expect(bindProductReadReview(text, original, query, { action: "PARAMETERS", field: "THICKNESS", confidence: .95, evidence: text })).toBeUndefined();
});

it("表达目标独立于参数含义，不猜产品/参数或产生操作授权", () => {
  const original = proposal(), before = JSON.stringify(original);
  expect(bindProductReadReview(message, original, query, review)).toMatchObject({ intent: "PRODUCT_DETAIL", requestedEffect: "READ_ONLY",
    productContinuation: { action: "REPHRASE", field: null }, productQuery: { ...query, evidence: message } });
  expect(JSON.stringify(original)).toBe(before);
  expect(bindProductReadReview(message, original, query, { ...review, action: "EXPLAIN_PARAMETER" })).toBeUndefined();
});
it("模型复制上文产品名不算本轮新筛选；窄目标复核仍不能删除新对象或数值", () => {
  const text = "可参考的板厚有哪些", original = domainSemanticFixture(text, "REFERENCE_QUERY", { relation: "NEW", effectRequest: null,
    reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .82,
      constraints: [{ type: "ENTITY", operation: "SET", field: "systemHint", entityText: "甲板", resolvedText: null, value: null, metric: null,
        operator: null, evidence: "甲板", confidence: .8, hard: true }], preferences: [], unresolved: [] } });
  const target = { action: "PARAMETERS", field: "THICKNESS", confidence: .95, evidence: text };
  expect(bindProductReadReview(text, original, query, target)).toMatchObject({ readGoal: "PRODUCTS", requestedEffect: "READ_ONLY", pageQuery: null,
    productQuery: { entityText: "甲板", evidence: text }, productContinuation: { field: "THICKNESS" } });
  expect(bindProductReadReview(`${text}，只看40mm`, original, query, target)).toBeUndefined();
  original.pageQuery!.constraints[0]!.entityText = "乙板";
  expect(bindProductReadReview(text, original, query, target)).toBeUndefined();
});

it("参数定义可从不支持该指标的通用热工目标改成同产品解释，但不带入数值", () => {
  const text = "导热能力指什么", original = domainSemanticFixture(text, "KNOWLEDGE_EXPLAIN", { relation: "CONTINUE", requestedEffect: "READ_ONLY",
    reference: { scope: "NONE", revision: null, items: [] }, factRead: { mode: "DEFINE", metric: null, historyClaim: false, evidence: text } });
  expect(bindProductReadReview(text, original, query, { action: "EXPLAIN_PARAMETER", field: "LAMBDA", confidence: .95, evidence: text }))
    .toMatchObject({ intent: "PRODUCT_DETAIL", factRead: null, productContinuation: { action: "EXPLAIN_PARAMETER", field: "LAMBDA" } });
});

it.each(["confidence", "evidence", "effect", "topic", "scope", "query", "patch", "reference", "calculation", "compliance"])("%s边界仍拒绝复核扩大目标", kind => {
  const original = proposal(), raw = { ...review };
  if (kind === "confidence") raw.confidence = .89;
  if (kind === "evidence") raw.evidence = "未说过";
  if (kind === "effect") original.requestedEffect = "STATE_MUTATION";
  if (kind === "topic") original.relation = "SWITCH_TOPIC";
  if (kind === "scope") original.productQuery!.entityText = "乙板";
  if (kind === "query") original.parameterQuery = {} as any;
  if (kind === "patch") original.constraintPatch = [{}] as any;
  if (kind === "reference") original.reference.scope = "CURRENT_SELECTED";
  if (kind === "calculation") original.calculationRequest = {} as any;
  if (kind === "compliance") original.complianceCheck = { required: true, evidence: message };
  expect(bindProductReadReview(message, original, query, raw)).toBeUndefined();
});
