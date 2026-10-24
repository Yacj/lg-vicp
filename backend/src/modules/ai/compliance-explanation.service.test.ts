import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
const m = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), dictionary: vi.fn(), scope: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: m.history }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: m.dictionary }));
vi.mock("../thermal/thermal-standard-scope.service.js", () => ({ resolveScopedThermalStandard: m.scope }));
import { previousComplianceContext, readComplianceExplanation } from "./compliance-explanation.service.js";
const conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app" };
const now = Date.now(), standardId = "00000000-0000-4000-8000-000000000001";
const row = (compliance: unknown = { status: "UNAVAILABLE" }) => ({ id: "a", createdAt: new Date(now), metadata: { queryScope: conversation,
  backendDecision: { domainIntent: "COMPLIANCE_CHECK", compliance } } });
const ctx = () => {
  const message = "刚才的核验依据和日期能再核对一下吗";
  const db: any = { insert: vi.fn(), update: vi.fn(), select: vi.fn(() => {
    const b: any = { from: () => b, where: () => b, limit: async () => [{ title: "正式测试标准", documentNo: "TEST-2020", implementDate: new Date("2020-05-01T00:00:00Z") }] }; return b;
  }) };
  return { app: { db }, user: { id: "u" }, conversation, userMessage: message, taskState: { taskType: "GENERAL" },
    domainDecision: { intent: "KNOWLEDGE_EXPLAIN", mutation: "NONE", semantic: domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", {
      complianceExplanation: { evidence: message }, reference: { scope: "NONE", revision: null, items: [] } }) } } as any;
};
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ projectId: null }); m.history.mockResolvedValue([row()]); m.dictionary.mockResolvedValue({ hasPublishedLimits: false }); });
it("缺正式依据只说明缺项，不生成适用维度、条文、限值或日期", async () => {
  const c = ctx(), before = structuredClone(c.taskState), result = await readComplianceExplanation(c);
  expect(result.answer).toContain("没有可引用的正式标准限值"); expect(result.answer).not.toMatch(/体形系数|热惰性|气候区/);
  expect(result.sources).toEqual([]); expect(m.scope).not.toHaveBeenCalled(); expect(c.app.db.select).not.toHaveBeenCalled();
  expect(c.app.db.insert).not.toHaveBeenCalled(); expect(c.app.db.update).not.toHaveBeenCalled(); expect(c.taskState).toEqual(before);
});
it.each(["userId", "clientApp", "projectId"])("%s不同的核验记录不可继承", field => {
  const x = row(); x.metadata.queryScope = { ...conversation, [field]: "other" };
  expect(previousComplianceContext([x], conversation, now)).toBeUndefined();
});
it("换话题、过期、未来记录不能回捞，连续解释不刷新原始有效期", () => {
  expect(previousComplianceContext([{ ...row(), metadata: { queryScope: conversation, backendDecision: { domainIntent: "GENERAL", compliance: { status: "UNAVAILABLE" } } } }], conversation, now)).toBeUndefined();
  for (const time of [now - 25 * 3600_000, now + 1000]) expect(previousComplianceContext([{ ...row(), createdAt: new Date(time) }], conversation, now)).toBeUndefined();
  expect(previousComplianceContext([{ ...row(), metadata: { queryScope: conversation, backendDecision: { domainIntent: "KNOWLEDGE_EXPLAIN",
    complianceReadContext: { createdAt: new Date(now - 25 * 3600_000).toISOString(), compliance: { status: "UNAVAILABLE" } } } } }], conversation, now)).toBeUndefined();
});
it("正式来源重新核验，实施日期用文档字段，记录版本不冒充法规版本", async () => {
  m.history.mockResolvedValue([row({ status: "CHECKED", standardLimitId: standardId, scope: { regionCode: "r", buildingType: "住宅" } })]);
  m.scope.mockResolvedValue({ limit: { basisName: "正式测试标准", basisCode: "TEST-2020", clauseRef: "5.2", version: 9, limitKValue: .4, sourceDocumentId: "doc" } });
  const result = await readComplianceExplanation(ctx());
  expect(result.answer).toContain("2020-05-01"); expect(result.answer).toContain("TEST-2020"); expect(result.answer).not.toContain("版本 9");
  expect(result.answer).toContain("没有重新判定"); expect(result.sources).toHaveLength(1);
  m.scope.mockResolvedValue({ limit: null });
  expect((await readComplianceExplanation(ctx())).answer).toContain("目前无法重新核验");
});
it("解释不能夹带动作、参数改写、无证据或低置信提案", () => {
  const c = ctx(), s = c.domainDecision.semantic;
  expect(applyDomainPolicy(c.userMessage, s).intent).toBe("KNOWLEDGE_EXPLAIN");
  for (const patch of [{ confidence: .79 }, { relation: "NEW" }, { requestedEffect: "CALCULATE" },
    { complianceExplanation: { evidence: "用户没有说过" } }, { effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: c.userMessage } }]) {
    expect(applyDomainPolicy(c.userMessage, { ...s, ...patch } as any)).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
  }
});
