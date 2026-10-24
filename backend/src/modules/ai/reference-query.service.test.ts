import { domainDecision } from "./ai-domain-turn-decision.js";
import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { referenceReadFixture } from "./reference-read.fixture.js";
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: async () => ({ projectId: null }) }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: async () => [referenceReadFixture().row] }));
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";

const mocks = vi.hoisted(() => ({ dictionary: vi.fn(), query: vi.fn(), save: vi.fn() }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: mocks.dictionary }));
vi.mock("../thermal/thermal-candidate.service.js", () => ({ queryThermalCandidates: mocks.query }));
vi.mock("./ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));

describe("非Agent候选对比只读冻结记录", () => {
  it("第一和第三个直接构建事实集，不读目录或全库重查，不受旧选择影响", async () => {
    const candidates = referenceReadFixture().candidates;
    const ctx = { domainDecision: domainDecision("COMPARE_CANDIDATES", "第一个和第三个哪个好"), app: { db: {} }, conversation: { id: "c", projectId: null }, request: {}, user: {}, userMessage: "第一个和第三个哪个好",
      taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates, selectedCandidateIds: ["row-1", "row-2"], candidateQueryRevision: 1, projectId: null, createdAt: new Date().toISOString() } } };
    const result = await resolveReferenceQueryWithoutAgent(ctx as any);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(["row-1", "row-3"]);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.dictionary).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

it("读取合同错误不能被其他冲突资料的可用性说明冒充成比较失败", async () => {
  const result = await resolveReferenceQueryWithoutAgent({ app: { db: {} }, conversation: {},
    domainDecision: { ...domainDecision("CLARIFY", "查看当前层次"), policyReason: "PAGE_QUERY_SCOPE_INVALID",
      unresolved: ["请明确当前要读取的字段"], semantic: { readGoal: "SCHEMES", clarificationTarget: "REFERENCE" } } } as any);
  expect(result.needsClarification).toBe(true);
  expect(result.facts.canonicalAnswers.join("\n")).toContain("当前要读取的字段");
  expect(result.availability).toBeUndefined();
  expect(result.facts.canonicalAnswers.join("\n")).not.toContain("比较");
});

it("模型的内部intent诊断保留在审计，不直接作为客户答案", async () => {
  const internal = "INTERNAL_MODEL_REVIEW_ONLY_329";
  const result = await resolveReferenceQueryWithoutAgent({ app: { db: {} }, conversation: {}, userMessage: "调整厚度后的效果",
    domainDecision: { ...domainDecision("CLARIFY", "调整厚度后的效果"), policyReason: "PAGE_QUERY_CONSTRAINTS_INVALID", unresolved: [internal],
      semantic: { intent: "REFERENCE_REFINE", ambiguity: [], pageQuery: { unresolved: [{ field: "intent", reason: internal }] } } } } as any);
  expect(result.needsClarification).toBe(true);expect(result.facts.canonicalAnswers.join("\n")).not.toContain(internal);
  expect(result.facts.canonicalAnswers.join("\n")).toContain("已有参考档位");expect(result.facts.canonicalAnswers.join("\n")).toContain("重新计算");
});
it.each([[], [{ field: "自定义效果字段", reason: "INTERNAL_FIELD_624" }]])("查询收到计算合同%j，按结构化目标冲突说明下一步，不依赖模型字段命名", async unresolved => {
  const result = await resolveReferenceQueryWithoutAgent({ app: { db: {} }, conversation: {}, userMessage: "改厚后的参数",
    domainDecision: { ...domainDecision("CLARIFY", "改厚后的参数"), policyReason: "PAGE_QUERY_INTENT_MISMATCH",
      unresolved: ["INTERNAL_CONTRACT_MISMATCH"], semantic: { intent: "REFERENCE_REFINE", ambiguity: [], pageQuery: { intent: "THERMAL", unresolved } } } } as any);
  const answer = result.facts.canonicalAnswers.join("\n");
  expect(answer).toContain("已有参考档位");expect(answer).toContain("当前构造重新计算");
  expect(answer).not.toContain("INTERNAL");expect(answer).not.toContain("还有一项尚未明确");
  expect(result.needsClarification).toBe(true);
});
it("来源核验未决时只询问资料名称，不展示模型诊断或要求重填工程条件", async () => {
  const result=await resolveReferenceQueryWithoutAgent({app:{db:{}},conversation:{},userMessage:"按那份资料查",
    domainDecision:{...domainDecision("CLARIFY","按那份资料查"),policyReason:"PAGE_QUERY_CONSTRAINTS_INVALID",unresolved:["INTERNAL_SOURCE_UNCERTAIN"],
      semantic:{intent:"REFERENCE_QUERY",ambiguity:[],pageQuery:{intent:"REFERENCE_LOOKUP",unresolved:[{field:"sourceScope",reason:"INTERNAL_SOURCE_UNCERTAIN"}]}}}} as any);
  const answer=result.facts.canonicalAnswers.join("\n");expect(answer).toContain("资料名称");expect(answer).toContain("条件会保留");expect(answer).not.toContain("INTERNAL");
});
