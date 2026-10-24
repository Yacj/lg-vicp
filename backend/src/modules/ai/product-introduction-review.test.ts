import "dotenv/config";
import { expect, it } from "vitest";
import { bindProductIntroduction } from "./product-introduction-review.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const message = "想认识一下甲型复合板（芯材乙）";
const proposal = () => domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { relation: "NEW", readGoal: "PRODUCTS",
  reference: { scope: "NONE", revision: null, items: [] },
  factRead: { mode: "EXPLAIN", metric: null, historyClaim: false, evidence: message } });
const raw = { goal: "INTRODUCTION", name: "甲型复合板（芯材乙）", confidence: .96, evidence: message };
it("产品读取目标不能被构造解释合同掩盖；名称只保留原话，来源另行核验", () => {
  const p = proposal();
  expect(bindProductIntroduction(message, p, raw)).toMatchObject({ intent: "PRODUCT_DISCOVERY", factRead: null,
    confidence: p.confidence, requestedEffect: "READ_ONLY", productQuery: { entityText: raw.name } });
  expect(p.factRead?.mode).toBe("EXPLAIN");
  expect(bindProductIntroduction(message, { ...p, readGoal: undefined }, raw)?.intent).toBe("PRODUCT_DISCOVERY");
});
it.each(["effect", "value", "code", "history", "goal", "reference", "comparison", "evidence", "name", "confidence"])("%s不能被只读目标复核删除或编造", kind => {
  const p = proposal(), review = { ...raw }; let text = message;
  if (kind === "effect") p.requestedEffect = "STATE_MUTATION";
  if (kind === "value") text += "，热阻5";
  if (kind === "code") text += "，核对外墙A1-1";
  if (kind === "history") p.factRead!.historyClaim = true;
  if (kind === "goal") p.readGoal = "SCHEMES";
  if (kind === "reference") p.reference.scope = "CURRENT_SELECTED";
  if (kind === "comparison") p.factRead!.mode = "COMPARE";
  if (kind === "evidence") review.evidence = "不存在的证据";
  if (kind === "name") review.name = "正式甲板";
  if (kind === "confidence") review.confidence = .89;
  expect(bindProductIntroduction(text, p, review)).toBeUndefined();
});
