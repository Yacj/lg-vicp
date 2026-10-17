import { describe, expect, it } from "vitest";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import type { ConversationTaskState } from "./conversation-task.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";

/**
 * 阶段2 上下文衔接回归。
 *
 * 真实背景：
 * - `薄膜灰系数0.3的产品有么` 的已存提案只有 PRODUCT_R 数值，原话里的体系词既没进硬条件也没进澄清项，
 *   查询被静默放宽到全部体系后回答「没有可核验档位」。
 * - 澄清轮不能清掉上一轮仍有效的候选，也不能顺手取得任何副作用授权。
 *
 * 这里只锁定 Policy 的既有合同，不新增关键词判断：系统名称能否归一由 Semantic 结构化字段决定，
 * 归一一律走正式目录与已配置别名，Policy 只按 ambiguity/unresolved 澄清，按 requestedEffect 授权。
 */

const lookupState = (): ConversationTaskState => ({
  taskType: "GENERAL",
  lastReferenceLookup: {
    query: { filters: [{ metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" }], metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" },
    candidates: [{ candidateId: "c1", constructionCode: "A1-1", thicknessMm: 30 }],
    candidateQueryRevision: 2, createdAt: "2026-10-17T00:00:00.000Z", projectId: null
  } as never
});

describe("澄清不动候选、不授权副作用", () => {
  it("名称无法可靠确认时进 ambiguity → 澄清，且原候选与查询条件原封不动", () => {
    const message = "薄膜灰系数0.3的产品有么";
    const state = lookupState();
    const before = structuredClone(state);
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "REFERENCE_QUERY", {
      confidence: .62, relation: "CONTINUE", ambiguity: ["薄膜灰"], requestedEffect: "QUERY", effectRequest: null }), state);
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("SEMANTIC_AMBIGUOUS");
    expect(decision.mutation).toBe("NONE");
    expect(decision.unresolved?.[0]).toContain("薄膜灰");
    // Policy 是纯函数：澄清既不删除候选，也不改写上一轮查询条件。
    expect(state).toEqual(before);
  });

  it("低置信查表不换取查询授权，也不会被当成副作用请求", () => {
    const message = "保温0.3的材料有么";
    const state = lookupState();
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "REFERENCE_QUERY", {
      confidence: .62, relation: "CONTINUE", requestedEffect: "QUERY", effectRequest: null }), state);
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("QUERY_NOT_UNDERSTOOD");
    expect(decision.mutation).toBe("NONE");
    expect(state.lastReferenceLookup?.candidates).toHaveLength(1);
  });

  it("结构化的只读查表不要求用户再说一次副作用授权", () => {
    const message = "薄抹灰Ⅲ型35mm的产品热阻是多少";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "REFERENCE_QUERY", {
      confidence: .95, relation: "NEW", requestedEffect: "QUERY", effectRequest: null,
      pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, unresolved: [], preferences: [],
        constraints: [{ type: "METRIC", field: null, operation: "SET", value: .3, metric: "PRODUCT_R", operator: "APPROX",
          evidence: message, entityText: null, resolvedText: null, hard: true, confidence: .95 }] } }), lookupState());
    expect(decision.intent).toBe("REFERENCE_QUERY");
    expect(decision.policyReason).toBe("READ_ONLY_QUERY");
    expect(decision.mutation).toBe("QUERY");
  });

  it("正式方案操作没有直接肯定请求时只澄清，不执行写入", () => {
    const message = "把第一个加入方案吧";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ACTION", {
      confidence: .99, requestedEffect: "STATE_MUTATION", effectRequest: null }), lookupState());
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("EFFECT_NOT_AUTHORIZED");
    expect(decision.mutation).toBe("NONE");
  });
});

describe("指标替换与条件继承", () => {
  it("纠正指标时 REPLACE 旧指标，不叠加两个冲突过滤器", () => {
    const next = normalizeConversationLookupQuery({ filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] }, "我说的是K，不是产品R",
      { query: { filters: [{ metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" }] }, candidates: [], createdAt: "2026-10-17T00:00:00.000Z" } as never);
    expect(next.query.filters).toHaveLength(1);
    expect(next.query.filters[0]).toMatchObject({ metric: "K", targetValue: 0.3 });
  });
});

describe("表达目标只影响解释，不改变事实与授权", () => {
  it("未自述身份时 audience 取默认值，不影响只读语义", () => {
    const built = domainSemanticFixture("你们有哪些产品", "PRODUCT_DISCOVERY");
    const { audience: _ignored, ...withoutAudience } = built;
    expect(domainTurnSemanticSchema.parse(withoutAudience).audience).toBe("UNSPECIFIED");
    const decision = applyDomainPolicy("你们有哪些产品", built, null);
    expect(decision.intent).toBe("PRODUCT_DISCOVERY");
    expect(decision.mutation).toBe("NONE");
  });
});
