import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const m = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: m.history }));
import { previousProductQueryContext } from "./product-consultation-context.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const frozen = JSON.parse(readFileSync(new URL("../../../tests/fixtures/phase03-handoff/replay.json", import.meta.url), "utf8"));
const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
const query = { scope: "IDENTITY" as const, entityText: "VICP", granularity: "SERIES" as const, evidence: "介绍VICP" };
const rows = () => [{ id: "a", createdAt: new Date(), metadata: { queryScope: { ...conversation }, backendDecision: {
  domainIntent: "PRODUCT_DISCOVERY", productQueryDiagnostics: { scope: { ...query }, reason: "NAME_UNRESOLVED" } } } }];
beforeEach(() => { vi.resetAllMocks(); m.access.mockResolvedValue({ projectId: null }); m.history.mockResolvedValue(rows()); });
it("礼貌插话只延续真实产品读取上下文，不刷新来源有效期或复活普通GENERAL消息", () => {
  const data: any = rows(), origin = new Date(Date.now() - 15000).toISOString();
  data[0].metadata.backendDecision = { domainIntent: "GENERAL", productContextCreatedAt: origin,
    productQueryDiagnostics: { scope: query, reason: "CONTINUATION_PENDING" } };
  expect(previousProductQueryContext(data, conversation)).toMatchObject({ query, createdAt: origin });
  data[0].metadata.backendDecision.productQueryDiagnostics.reason = "CATALOG_MATCH";
  expect(previousProductQueryContext(data, conversation)).toBeUndefined();
});
it("连续优势建议只保留原产品目标和原始有效期，不能复活换话题前的产品", () => {
  const data: any = rows();
  const origin = new Date(Date.now() - 10000).toISOString();
  data[0].metadata.backendDecision = { domainIntent: "SOLUTION_ADVICE", productContextCreatedAt: origin,
    productQueryDiagnostics: { scope: query, reason: "CONTINUATION_PENDING" } };
  expect(previousProductQueryContext(data, conversation)).toMatchObject({ query, createdAt: origin });
  delete data[0].metadata.backendDecision.productQueryDiagnostics;
  expect(previousProductQueryContext(data, conversation)).toBeUndefined();
});
it("D02 S1-T2仅调整表达时，产品身份来自已绑定的上轮读取目标；当前证据仍必须逐字成立", () => {
  const turn = frozen.turns["S1-T2"], proposal = domainTurnSemanticSchema.parse(turn.traces[0].proposal);
  const previous = previousProductQueryContext(rows(), conversation)!;
  expect(applyDomainPolicy(turn.message, proposal).policyReason).toBe("PRODUCT_SCOPE_INVALID");
  const decision = applyDomainPolicy(turn.message, proposal, undefined, { productQuery: previous.query });
  expect(decision).toMatchObject({ intent: "PRODUCT_DISCOVERY", mutation: "NONE", semantic: { audience: "GENERAL" } });
  expect(applyDomainPolicy(turn.message, { ...proposal, evidence: "不存在的原话" }, undefined, { productQuery: previous.query }).intent).toBe("CLARIFY");
  expect(applyDomainPolicy(turn.message, { ...proposal, relation: "SWITCH_TOPIC" }, undefined, { productQuery: previous.query }).intent).toBe("CLARIFY");
  expect(applyDomainPolicy(turn.message, { ...proposal, productQuery: { ...proposal.productQuery!, entityText: "VLCP" } }, undefined, { productQuery: previous.query }).intent).toBe("CLARIFY");
});
it.each(["user", "client", "project", "conversation", "expired", "future", "topic", "malformed"])("产品目标%s不继承", reason => {
  const data: any = rows();
  if (reason === "user") data[0].metadata.queryScope.userId = "other";
  if (reason === "client") data[0].metadata.queryScope.clientApp = "pc_ai";
  if (reason === "project") data[0].metadata.queryScope.projectId = "other";
  if (reason === "conversation") data[0].metadata.queryScope.id = "other";
  if (reason === "expired") data[0].createdAt = new Date(0);
  if (reason === "future") data[0].createdAt = new Date(Date.now() + 1000);
  if (reason === "topic") data.unshift({ id: "new", createdAt: new Date(), metadata: {} });
  if (reason === "malformed") data[0].metadata.backendDecision.productQueryDiagnostics.scope.scope = "ANYTHING";
  expect(previousProductQueryContext(data, conversation)).toBeUndefined();
});
it("D03模型内部说明保留供诊断，不直接作为客户澄清；没有候选不声称旧列表", () => {
  const message = "你们产品有什么优势和不足？";
  const proposal = domainSemanticFixture(message, "SOLUTION_ADVICE", { adviceFocus: "PROS_CONS", ambiguity: ["未指定产品，需后端核验"] });
  const decision = applyDomainPolicy(message, proposal);
  expect(decision.intent).toBe("CLARIFY"); expect(decision.unresolved?.join()).not.toContain("后端");
  expect(decision.unresolved?.join()).toContain("优势与限制"); expect(decision.semantic?.ambiguity).toEqual(proposal.ambiguity);
  const reference = domainSemanticFixture("核对最终方案", "REFERENCE_DETAIL", { referenceTime: "UNCERTAIN" });
  expect(applyDomainPolicy("核对最终方案", reference).unresolved?.join()).toContain("没有可定位");
  expect(applyDomainPolicy("核对最终方案", reference).unresolved?.join()).not.toContain("旧序号");
});
