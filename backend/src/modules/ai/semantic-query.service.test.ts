import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), runtime: vi.fn(), audit: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
import { parseSemanticQuery } from "./semantic-query.service.js";
import type { SemanticQuery } from "../thermal/semantic-query.js";

const dictionary = { entities: [{ field: "systemId" as const, value: "sys", names: ["I型薄抹灰外保温系统"], family: "薄抹灰" }], aliases: [] };
const ctx = (message: string, previous?: any) => ({ app: { db: {}, log: { warn: vi.fn() } }, user: { id: "user" }, request: {},
  conversation: { id: "conversation", scene: "general_chat", insulationSystemId: null }, userMessage: message,
  taskState: previous ? { lastReferenceLookup: { query: previous, candidates: [], createdAt: "2026-10-12" } } : {} }) as any;
const result = (evidence: string, operator: "APPROX" | "EXACT" = "APPROX"): SemanticQuery => ({
  queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", confidence: 0.95, unresolved: [], preferences: [],
  constraints: [{ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: "K", operator,
    value: 0.3, evidence, hard: true, confidence: 0.95 }]
});
beforeEach(() => { vi.clearAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {}, modelId: "configured-model" } }); });
describe("Semantic Parser正式接线", () => {
  it.each(["legacy-parser", "domain-proposal"])("%s进入执行前共用厚度角色校核，基层标量不能作为板厚筛选", async route => {
    const message = "先查已发布的180mm钢筋混凝土基层示例", c = ctx(message);
    const proposal: SemanticQuery = { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, preferences: [], unresolved: [], constraints: [
      { type: "ENTITY", operation: "SET", field: "substrateMaterial", entityText: "钢筋混凝土", resolvedText: null, metric: null, operator: null, value: null,
        evidence: "钢筋混凝土", hard: true, confidence: .95 },
      { type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 180, evidence: "180mm", hard: true, confidence: .95 }
    ] };
    mocks.generate.mockReset();
    if (route === "domain-proposal") c.domainDecision = { intent: "REFERENCE_QUERY", mutation: "QUERY", semantic: { relation: "NEW", pageQuery: proposal } };
    else mocks.generate.mockResolvedValueOnce({ object: proposal, usage: {} });
    mocks.generate.mockResolvedValueOnce({ object: { items: [{ constraintIndex: 1, role: "SUBSTRATE", confidence: .95, evidence: "180mm钢筋混凝土基层" }] } });
    const actual = await parseSemanticQuery(c, {}, { entities: [{ field: "substrateMaterial", value: "钢筋混凝土", names: ["钢筋混凝土"] }], aliases: [] }, true);
    expect(actual.needsClarification).toBe(false); expect(actual.query.substrateThickness).toBe(180); expect(actual.query.thicknessMm).toBeUndefined();
    expect(actual.semanticParserResult?.constraints[1]?.field).toBe("substrateThickness"); expect(actual.confidence).toBe(.95);
    expect(mocks.generate).toHaveBeenCalledTimes(route === "domain-proposal" ? 1 : 2);
  });
  it("执行入口归属复核失败时保留未决条件，不采用错误板厚检索", async () => {
    const message = "钢筋混凝土厚度180mm", c = ctx(message);
    const proposal: SemanticQuery = { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, preferences: [], unresolved: [], constraints: [
      { type: "ENTITY", operation: "SET", field: "substrateMaterial", entityText: "钢筋混凝土", resolvedText: null, metric: null, operator: null, value: null,
        evidence: "钢筋混凝土", hard: true, confidence: .95 },
      { type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 180, evidence: "180mm", hard: true, confidence: .95 }
    ] };
    c.domainDecision = { mutation: "QUERY", semantic: { relation: "NEW", pageQuery: proposal } };
    mocks.generate.mockReset().mockResolvedValue({ object: { items: [{ constraintIndex: 1, role: "UNRESOLVED", confidence: .7, evidence: "180mm" }] } });
    const actual = await parseSemanticQuery(c, {}, { entities: [{ field: "substrateMaterial", value: "钢筋混凝土", names: ["钢筋混凝土"] }], aliases: [] }, true);
    expect(actual.needsClarification).toBe(true); expect(actual.query.unresolved?.some(item => item.field === "thicknessRole")).toBe(true);
  });
  it("澄清轮纠正为产品R时，下游只核验本轮指标，不复活原问K", async () => {
    const c = ctx("产品热阻");
    const pageQuery = result("K0.3");
    pageQuery.constraints[0] = { ...pageQuery.constraints[0]!, metric: "PRODUCT_R", operation: "REPLACE", evidence: "K0.3" };
    c.domainDecision = { mutation: "QUERY", queryContextMessageId: "q", queryEvidenceText: "K0.3\n产品热阻", semantic: { relation: "CONTINUE", pageQuery } };
    const parsed = await parseSemanticQuery(c, {}, dictionary);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.query.filters).toEqual([expect.objectContaining({ metric: "PRODUCT_R", targetValue: .3 })]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("真实UAT省略最低K追问通过模型合同及偏好排序，不新增目标值或改变资料范围", async () => {
    const previous = { specClass: "III", thicknessMm: 45, documentIds: ["doc"], knowledgeVersionIds: ["version"] };
    mocks.generate.mockResolvedValue({ object: { queryMode: "CONTINUE_QUERY", intent: "REFERENCE_LOOKUP", confidence: .95,
      constraints: [], preferences: [{ field: "preferLowerK", enabled: true, evidence: "最低" }], unresolved: [] }, usage: {} });
    const parsed = await parseSemanticQuery(ctx("最低的是哪一种？", previous), {}, dictionary);
    expect(parsed.query).toMatchObject({ ...previous, preferences: { preferLowerK: true } });
    expect(parsed.query.filters).toEqual([]);
    expect(mocks.generate.mock.calls[0]?.[0].system).toContain("JSON Schema");
    expect(mocks.generate.mock.calls[0]?.[0].system).toContain("preferLowerK=true");
  });
  it("符号规则不调用模型，旧Tool参数不能覆盖用户上限", async () => {
    const parsed = await parseSemanticQuery(ctx("K<=0.3"), { mode: "MIN_LIMIT", targetK: 0.4 }, dictionary);
    expect(parsed.query.filters?.[0]).toMatchObject({ mode: "MAX_LIMIT", targetValue: 0.3 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("开放口语实际进入结构化模型调用，NEW_QUERY清旧R并审计", async () => {
    mocks.generate.mockResolvedValue({ object: result("K卡在0.3附近"), usage: { totalTokens: 120 } });
    const parsed = await parseSemanticQuery(ctx("K卡在0.3附近", { filters: [{ metric: "PRODUCT_R", mode: "APPROX", targetValue: 8.3 }] }), {}, dictionary);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 4096 });
    expect(parsed.parserSource).toBe("LLM"); expect(parsed.query.filters?.map(filter => filter.metric)).toEqual(["K"]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.semantic_query_parsed" }));
  });
  it("模型伪造数值进入澄清而不是查候选", async () => {
    const object = result("K是不是正好0.3", "EXACT"); object.constraints[0]!.value = 0.9;
    mocks.generate.mockResolvedValue({ object, usage: {} });
    const parsed = await parseSemanticQuery(ctx("K是不是正好0.3"), {}, dictionary);
    expect(parsed.needsClarification).toBe(true); expect(parsed.query.filters).toEqual([]);
  });
  it("网关失败保持有依据的兼容条件，取消信号不继续生成", async () => {
    mocks.generate.mockRejectedValue(new Error("gateway failed"));
    expect((await parseSemanticQuery(ctx("K0.3左右"), {}, dictionary)).query.filters?.[0]).toMatchObject({ mode: "APPROX", targetValue: 0.3 });
    const controller = new AbortController(); controller.abort();
    await expect(parseSemanticQuery({ ...ctx("K卡在0.3附近"), abortSignal: controller.signal }, {}, dictionary)).rejects.toThrow("gateway failed");
  });
});
