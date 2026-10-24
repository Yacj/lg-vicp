import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const generate = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateObject: generate }));
import { reviewCalculationGoal } from "./calculation-authorization.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
beforeEach(() => vi.resetAllMocks());
it("读取目标缺少字段时必须提取完整只读查询，不迁移单个计算输入", async () => {
  const message = "看已发布的180mm混凝土示例，不重新算";
  const proposal = domainSemanticFixture(message, "THERMAL_CALCULATE", { relation: "NEW" });
  generate.mockResolvedValueOnce({ object: { intent: "REFERENCE_REFINE", confidence: .95, evidence: message,
    effectRequest: null, queryBasis: null, unresolved: null } }).mockResolvedValueOnce({ object: {
    intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, preferences: [], unresolved: [],
    constraints: [{ type: "THICKNESS", field: "substrateThickness", operation: "SET", entityText: null, resolvedText: null,
      metric: null, operator: "EXACT", value: 180, evidence: "180mm", hard: true, confidence: .95 }] } });
  const reviewed = await reviewCalculationGoal({} as any, message, AbortSignal.timeout(10000), proposal);
  expect(reviewed.object).toMatchObject({ intent: "REFERENCE_REFINE", requestedEffect: "QUERY", effectRequest: null, calculationRequest: null });
  expect(applySemanticQuery(message, reviewed.object.pageQuery, { entities: [], aliases: [] })).toMatchObject({ substrateThickness: 180, unresolved: [] });
  expect(generate).toHaveBeenCalledTimes(2);
});
it("比较既有多套记录保持整组读取，不把计算提案中的单一厚度变成新查询", async () => {
  const message = "把两套做法的参数和限制并排比较";
  const proposal = domainSemanticFixture(message, "THERMAL_CALCULATE", { calculationRequest: { schemeId: "fake", productSpecId: "fake",
    targetLayerId: null, mode: "EQUIVALENT", thicknessMm: 22, evidence: message, thicknessEvidence: null } });
  generate.mockResolvedValue({ object: { intent: "COMPARE_CANDIDATES", confidence: .96, evidence: message,
    effectRequest: null, pageQuery: null, queryBasis: null, unresolved: null } });
  const reviewed = await reviewCalculationGoal({} as any, message, AbortSignal.timeout(10000), proposal);
  expect(reviewed.object).toMatchObject({ intent: "COMPARE_CANDIDATES", requestedEffect: "READ_ONLY", pageQuery: null,
    calculationRequest: null, constraintPatch: [], reference: { scope: "LAST_VISIBLE_CANDIDATES", items: [] } });
  expect(applyDomainPolicy(message, reviewed.object)).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE" });
  expect(generate).toHaveBeenCalledOnce();
});
it("缺失字段补提取失败时不能返回半个可执行查询", async () => {
  const message = "读取已发布示例";
  generate.mockResolvedValueOnce({ object: { intent: "REFERENCE_REFINE", confidence: .95, evidence: message,
    effectRequest: null, queryBasis: null, unresolved: null } }).mockResolvedValueOnce({ object: {} });
  await expect(reviewCalculationGoal({} as any, message, AbortSignal.timeout(10000), domainSemanticFixture(message, "THERMAL_CALCULATE"))).rejects.toThrow();
});
