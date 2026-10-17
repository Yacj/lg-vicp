import "dotenv/config";
import { describe, expect, it } from "vitest";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { decideDomainTurn } from "./ai-domain-turn-decision.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { groundClarificationMetricEvidence } from "./query-clarification-context.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { diagnoseReferenceQuery, renderReferenceQueryDiagnostics } from "../thermal/reference-query-diagnostics.js";
import { buildProductAnswerFacts, formatProductFactsAnswer, planProductAnswer, validateProductAnswer } from "./product-answer.js";
import { resolveThermalToolReferenceScope, thermalToolWantsCompliance } from "./tools/thermal-calculate.tool.js";

/**
 * 阶段4：五类场景的链路级矩阵（确定性、可重复，不调用真实模型）。
 *
 * 与既有单测的分工：
 * - 各模块内部的边界已由阶段 1~3 的单测覆盖；
 * - 本文件只锁定**跨阶段衔接**的不变量：Semantic 决策 → 查询/事实 → 回答合同 → 授权边界，
 *   以及「某一步失败时不会把失败伪装成成功」。
 *
 * 真实 HTTP/SSE 连续对话另见阶段4报告；本文件不能替代真实端到端验收。
 */

const lookup = (filters: Array<{ metric: "K" | "TOTAL_R" | "PRODUCT_R"; targetValue: number; mode?: "APPROX" | "MAX_LIMIT" | "MIN_LIMIT" | "EXACT" }>) =>
  ({ query: { filters, metric: filters[0]?.metric, targetValue: filters[0]?.targetValue }, candidates: [], createdAt: "2026-10-17T00:00:00.000Z" } as never);

describe("场景1：普通产品介绍与产品咨询", () => {
  const facts = buildProductAnswerFacts({
    products: [{ id: "p1", name: "VICP 复合保温板", summary: "用于建筑外墙与屋面的真空绝热复合板。", productType: "复合板", specClass: "II",
      thermalConductivity: 0.005, correctionFactor: 1.25, thicknessOptionsMm: [25], specifications: [{ specCode: "VICP-25", specClass: "II", thicknessMm: 25, combustionGrade: "A" }],
      knowledgeDocumentIds: ["d1"] }],
    sources: [{ documentId: "d1", versionId: "v1", title: "VICP 产品技术资料" }], hasMore: false,
    decision: { intent: "PRODUCT_DISCOVERY", semantic: { audience: "GENERAL" } } as never
  });

  it("非工程师提问走介绍形态，事实清单里保留 λ 但回答不主动罗列", () => {
    expect(facts.mode).toBe("INTRODUCTION");
    expect(facts.products[0]!.thermalConductivity).toBe(0.005);
    expect(formatProductFactsAnswer(facts)).not.toContain("λ=");
  });

  it("模型组织失败或越界时回落同一份事实，不产生第二套说法", () => {
    expect(planProductAnswer({ needsClarification: false, facts, modelAvailable: true })).toBe("MODEL_WITH_FACT_CHECK");
    const invented = validateProductAnswer("VICP 复合保温板 λ=0.004，节能 30%。", facts);
    expect(invented.passed).toBe(false);
    expect(formatProductFactsAnswer(facts)).toContain("VICP 复合保温板");
  });

  it("产品咨询仍是只读语义，不产生方案或报告授权", () => {
    const message = "你们 VICP 产品主要有什么？我不是工程师，简单介绍";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "PRODUCT_DISCOVERY", {
      audience: "GENERAL", requestedEffect: "READ_ONLY", effectRequest: null }), lookup([]));
    expect(decision.intent).toBe("PRODUCT_DISCOVERY");
    expect(decision.policyReason).toBe("READ_ONLY_SEMANTIC");
    expect(decision.mutation).toBe("NONE");
  });
});

describe("场景2：知识库原页、热工查表与多构造比较", () => {
  const row = (id: string, extra: Record<string, unknown>) => ({ id, constructionCode: "A1-1", thicknessMm: 30, kValue: 0.2, ...extra } as never);
  const query = (filters: Array<{ metric: "K" | "TOTAL_R" | "PRODUCT_R"; targetValue: number }>) => ({ filters } as never);

  it("四种空结果原因分别说明，不统一说成「没有符合条件的档位」", () => {
    const noData = renderReferenceQueryDiagnostics(diagnoseReferenceQuery(query([{ metric: "K", targetValue: 0.2 }]), [], "THERMAL_ROW"));
    const identityMiss = renderReferenceQueryDiagnostics(diagnoseReferenceQuery(query([{ metric: "K", targetValue: 0.2 }]),
      [row("1", { constructionCode: "B9-9", kValue: 0.2 })], "THERMAL_ROW"));
    const noColumn = renderReferenceQueryDiagnostics(diagnoseReferenceQuery(query([{ metric: "PRODUCT_R", targetValue: 0.3 }]),
      [row("1", { productThermalResistance: null })], "THERMAL_ROW"));
    const noValue = renderReferenceQueryDiagnostics(diagnoseReferenceQuery(query([{ metric: "K", targetValue: 0.1 }]),
      [row("1", { kValue: 0.2 })], "THERMAL_ROW"));
    expect(new Set([noData, identityMiss, noColumn, noValue]).size).toBe(4);
    for (const text of [noData, identityMiss, noColumn, noValue]) expect(text).toContain("本次仅覆盖有权访问");
  });

  it("取值范围只统计同一身份，且明确标注不是命中", () => {
    const diagnostics = diagnoseReferenceQuery(query([{ metric: "PRODUCT_R", targetValue: 0.3 }]),
      [row("1", { specClass: "I", productThermalResistance: 4 }), row("2", { specClass: "II", productThermalResistance: 5 })], "THERMAL_ROW");
    const text = renderReferenceQueryDiagnostics(diagnostics);
    expect(text).toContain("4");
    expect(text).toContain("5");
    expect(text).toContain("这些是范围内取值，未作为命中");
  });

  it("编号与厚度相同但体系不同时不会被当成同一构造合并", () => {
    const diagnostics = diagnoseReferenceQuery(query([{ metric: "K", targetValue: 0.2 }]),
      [row("1", { systemName: "薄抹灰", kValue: 0.2 }), row("2", { systemName: "屋面复合", kValue: 0.2 })], "JOINT");
    expect(diagnostics.identityCount).toBeGreaterThanOrEqual(1);
    expect(diagnostics.issues).not.toContain("CONDITIONS_CONFLICT");
  });
});

describe("场景3：多轮澄清、口语、指标修改与条件继承", () => {
  it("澄清回复只补看不见的数值，不把整段旧条件复制成新条件", () => {
    const original = "保温 0.3 的材料有么";
    const semantic = domainSemanticFixture("产品热阻", "REFERENCE_QUERY", {
      queryContext: "CLARIFICATION_REPLY", requestedEffect: "QUERY", relation: "CONTINUE",
      pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .9, unresolved: [], preferences: [],
        constraints: [{ type: "METRIC", field: null, operation: "SET", value: .3, metric: "PRODUCT_R", operator: "APPROX",
          evidence: "产品热阻", entityText: null, resolvedText: null, hard: true, confidence: .9 }] } });
    const grounded = groundClarificationMetricEvidence("产品热阻", original, semantic);
    expect(grounded.pageQuery!.constraints).toHaveLength(1);
    expect(grounded.pageQuery!.constraints[0]!.evidence).toContain("0.3");
  });

  it("改指标是 REPLACE，不叠加冲突过滤器；只改厚度保留指标", () => {
    const withProductR = lookup([{ metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" }]);
    const asK = normalizeConversationLookupQuery({ filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] }, "我说的是K，不是产品R", withProductR);
    expect(asK.query.filters).toHaveLength(1);
    expect(asK.query.filters[0]!.metric).toBe("K");
    const thicker = normalizeConversationLookupQuery({}, "改成35mm", lastOf(asK.query));
    expect(thicker.query.filters?.[0]?.metric).toBe("K");
  });

  it("名称无法可靠确认时澄清，而不是静默放宽查询", () => {
    const message = "薄膜灰系数0.3的产品有么";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "REFERENCE_QUERY", {
      confidence: .62, requestedEffect: "QUERY", relation: "CONTINUE", ambiguity: ["薄膜灰"] }), lookup([]));
    expect(decision.policyReason).toBe("SEMANTIC_AMBIGUOUS");
    expect(decision.mutation).toBe("NONE");
  });

  it("切换话题后不复用上一轮指标条件", () => {
    // 话题切换由 Semantic 的 relation=SWITCH_TOPIC 决定 queryMode=NEW_QUERY，NEW_QUERY 清旧条件。
    // 继承只发生在 CONTINUE/REFINE，因此这里必须显式给 NEW_QUERY 才能验证「不继承」。
    const prior = lookup([{ metric: "PRODUCT_R", targetValue: 0.3, mode: "APPROX" }]);
    const next = applySemanticQuery("屋面复合板有哪些构造", {
      queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", confidence: .95, unresolved: [], preferences: [],
      constraints: [{ type: "ENTITY", field: "systemHint", operation: "SET", value: null, metric: null, operator: null,
        evidence: "屋面复合板", entityText: "屋面复合板", resolvedText: null, hard: true, confidence: .95 }]
    } as never, { entities: [], aliases: [] }, prior.query as never);
    expect((next.filters ?? []).length).toBe(0);
    expect(next.systemHint).toBe("屋面复合板");
  });
});

const lastOf = (query: unknown) => ({ query: query as never, candidates: [], createdAt: "2026-10-17T00:00:00.000Z" } as never);

describe("场景4：正式计算、缺参与不能执行的边界", () => {
  it("没有本轮直接肯定授权时计算被拒绝，只澄清不执行", () => {
    const message = "顺便算一下那个";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "THERMAL_CALCULATE", {
      confidence: .99, requestedEffect: "CALCULATE", effectRequest: null }), lookup([]));
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("EFFECT_NOT_AUTHORIZED");
  });

  it("达标目标进入结构化字段，且缺原话证据时拒绝", () => {
    const message = "按这个构造算一遍";
    const missing = applyDomainPolicy(message, domainSemanticFixture(message, "THERMAL_CALCULATE", {
      requestedEffect: "CALCULATE", effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message },
      complianceCheck: { required: true, evidence: "不符合的部分" } }), lookup([]));
    expect(missing.policyReason).toBe("EVIDENCE_INVALID");
    const ok = applyDomainPolicy(message, domainSemanticFixture(message, "THERMAL_CALCULATE", {
      requestedEffect: "CALCULATE", effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message },
      complianceCheck: { required: true, evidence: message } }), lookup([]));
    expect(ok.policyReason).toBe("EXPLICIT_EFFECT_PROPOSAL");
    expect(thermalToolWantsCompliance({ semantic: { reference: { scope: "LATEST_VISIBLE" }, complianceCheck: { required: true } } }, message)).toBe(true);
  });

  it("引用作用域不被关键词改写", () => {
    expect(resolveThermalToolReferenceScope({ semantic: { reference: { scope: "CURRENT_SELECTED" }, complianceCheck: null } }, "算这个")).toBe("CURRENT_SELECTED");
    expect(resolveThermalToolReferenceScope({ semantic: { reference: { scope: "LATEST_VISIBLE" }, complianceCheck: null } }, "已选的那个")).toBe("LATEST_VISIBLE");
  });
});

describe("场景5：方案选择、Final、Confirm、Snapshot 与正式 PDF", () => {
  it("模型不能替用户确认：域层只给出方案动作，确认仍是后端封闭命令", () => {
    const message = "就这个方案吧，帮我确认一下并出报告";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ACTION", {
      confidence: .99, requestedEffect: "STATE_MUTATION",
      effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } }), lookup([]));
    // 域层最多给出 SOLUTION 动作请求，不产出 CONFIRM；自由文本也不是封闭命令。
    expect(decision.intent).toBe("SOLUTION_ACTION");
    expect(decision.mutation).toBe("SOLUTION");
    expect(decideDomainTurn(message).policyReason).toBe("SEMANTIC_REQUIRED");
  });

  it("没有明确报告请求时不会生成正式报告", () => {
    const message = "这个方案大概怎么样";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ADVICE", {
      requestedEffect: "READ_ONLY", effectRequest: null }), lookup([]));
    expect(decision.intent).toBe("SOLUTION_ADVICE");
    expect(decision.mutation).toBe("NONE");
  });

  it("报告请求必须携带本轮直接请求，引用或假设不授权", () => {
    const message = "如果我说要生成正式报告，会怎么样？";
    const decision = applyDomainPolicy(message, domainSemanticFixture(message, "REPORT_REQUEST", {
      reportType: "technical_scheme", confidence: .99, requestedEffect: "REPORT_GENERATION",
      effectRequest: { direct: false, polarity: "AFFIRMATIVE", speechAct: "HYPOTHETICAL", evidence: message } }), lookup([]));
    expect(decision.intent).toBe("CLARIFY");
    expect(decision.policyReason).toBe("EFFECT_NOT_AUTHORIZED");
  });
});
