import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ history: vi.fn(), access: vi.fn() }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: m.history }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
import { previousParameterReadContext, readProductParameterExplanation } from "./product-parameter-explanation.js";
import { parameterSourceKinds, renderParameterQueryExplanation } from "./product-parameter-diagnostics.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";

const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
const query = { parameter: "LAMBDA" as const, subjectType: "ANY" as const, subjectText: null, systemText: null, operator: "EXACT" as const,
  targetValue: .3, tolerance: null, unit: "W/(m·K)" as const, evidence: "导热系数" };
const diagnostics = { issues: ["VALUE_NO_MATCH", "SOURCE_SCOPE_LIMITED"] as ("VALUE_NO_MATCH" | "SOURCE_SCOPE_LIMITED")[], scannedCount: 962,
  identityCount: 962, matchedCount: 0, excludedValueCount: 962, conflictCount: 0, matchedSourceCount: 0,
  coverage: "AUTHORIZED_PUBLISHED_ONLY" as const, missingTolerance: false, checkedSourceKinds: [...parameterSourceKinds] };
function rows() { return [{ id: "answer", createdAt: new Date(), metadata: { queryScope: { ...conversation },
  backendDecision: { domainIntent: "PRODUCT_PARAMETER_QUERY", parameterQuery: { ...query }, parameterQueryDiagnostics: structuredClone(diagnostics) } } }]; }
const message = "为什么没有，查了哪些资料？";
function semantic() { return domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { parameterExplanation: { evidence: message },
  reference: { scope: "NONE", revision: null, items: [] } }); }
beforeEach(() => { vi.resetAllMocks(); m.access.mockResolvedValue({ projectId: null }); m.history.mockResolvedValue(rows()); });
it("D08解释紧邻λ=.3 EXACT的类别和排除原因，不把962行说成产品数或转为K", async () => {
  const app = { db: { insert: vi.fn(), update: vi.fn() } };
  const decision = applyDomainPolicy(message, semantic());
  const ctx: any = { app, conversation, user: { id: "u", clientType: "C_APP" }, userMessage: message, domainDecision: decision, taskState: { taskType: "GENERAL" } };
  const before = structuredClone(ctx.taskState), result = await readProductParameterExplanation(ctx);
  expect(result.explanationOfMessageId).toBe("answer"); expect(result.answer).toContain("0.3 W/(m·K)"); expect(result.answer).toContain("精确匹配");
  expect(result.answer).toContain("正式产品目录"); expect(result.answer).toContain("已发布材料参数"); expect(result.answer).toContain("已排除");
  expect(result.answer).not.toContain("962"); expect(result.answer).not.toContain("传热系数");
  expect(result.answer).not.toContain("不便展开"); expect(app.db.insert).not.toHaveBeenCalled(); expect(app.db.update).not.toHaveBeenCalled();
  expect(ctx.taskState).toEqual(before);
});
it.each(["user", "project", "client", "conversation", "expired", "future", "latestUnrelated", "malformed", "notParameter"])("%s不能继承参数诊断", reason => {
  const data: any = rows();
  if (reason === "user") data[0].metadata.queryScope.userId = "other";
  if (reason === "project") data[0].metadata.queryScope.projectId = "other";
  if (reason === "client") data[0].metadata.queryScope.clientApp = "pc_ai";
  if (reason === "conversation") data[0].metadata.queryScope.id = "other";
  if (reason === "expired") data[0].createdAt = new Date(Date.now() - 24 * 3600_000 - 1000);
  if (reason === "future") data[0].createdAt = new Date(Date.now() + 1000);
  if (reason === "latestUnrelated") data.unshift({ id: "new", createdAt: new Date(), metadata: {} });
  if (reason === "malformed") data[0].metadata.backendDecision.parameterQueryDiagnostics.coverage = "ALL_PRODUCTS";
  if (reason === "notParameter") data[0].metadata.backendDecision.domainIntent = "GENERAL";
  expect(previousParameterReadContext(data, conversation)).toBeUndefined();
});
it.each(["effect", "topic", "evidence", "query", "position"])("解释合同%s仍拒绝，不借历史授予新读取或写入", reason => {
  const proposal: any = semantic();
  if (reason === "effect") { proposal.intent = "THERMAL_CALCULATE"; proposal.requestedEffect = "CALCULATE"; }
  if (reason === "topic") proposal.relation = "SWITCH_TOPIC";
  if (reason === "evidence") proposal.parameterExplanation.evidence = "历史原话";
  if (reason === "query") proposal.parameterQuery = query;
  if (reason === "position") proposal.reference.items = [{ type: "POSITION", value: 1, evidence: "第一个" }];
  expect(applyDomainPolicy(message, proposal).mutation).toBe("NONE"); expect(applyDomainPolicy(message, proposal).intent).toBe("CLARIFY");
});
it("旧记录缺类别时明确缺记录；不按服务实现反推当时搜索范围", () => {
  const text = renderParameterQueryExplanation(query, { ...diagnostics, checkedSourceKinds: undefined });
  expect(text).toContain("没有保存资料类别"); expect(text).not.toContain("正式产品目录");
});
