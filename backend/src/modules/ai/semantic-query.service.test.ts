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
