import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), generate: vi.fn(), history: vi.fn() }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: mocks.history }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
import { resolveDomainTurn, DOMAIN_SEMANTIC_PROMPT } from "./ai-domain-turn-decision.service.js";
function ctx(message: string) { return { app: { db: {}, log: { warn: vi.fn() } }, conversation: { scene: "general_chat" },
  userMessage: message, taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "one" }] } } } as any; }
beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); mocks.history.mockResolvedValue([]); });
describe("开放目标受控分类与故障隔离", () => {
  it("仅结构验证失败在同一预算内重提案；仍经Policy，不提升权限", async () => {
    const message = "查看这个原页";
    const valid = domainSemanticFixture(message, "REFERENCE_VIEW");
    mocks.generate.mockResolvedValueOnce({ object: { ...valid, evidence: "不在原话中" } }).mockResolvedValueOnce({ object: valid });
    expect((await resolveDomainTurn(ctx(message))).intent).toBe("REFERENCE_VIEW");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const requests = mocks.generate.mock.calls.map(call => call[0]);
    expect(requests[0].abortSignal).toBe(requests[1].abortSignal);
    expect(requests[1].prompt).toContain("EVIDENCE_INVALID");
  });
  it("真实UAT只读QUERY不要求正式副作用授权，低置信与否定仍拒绝", async () => {
    const message = "Ⅲ型VICP薄抹灰外保温系统，45mm厚度，不同基层的传热系数有什么区别？";
    const proposal = domainSemanticFixture(message, "REFERENCE_QUERY", { relation: "NEW", reference: { scope: "NONE", revision: null, items: [] } });
    mocks.generate.mockResolvedValue({ object: { ...proposal, confidence: .9, effectRequest: null } });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "REFERENCE_QUERY", policyReason: "READ_ONLY_QUERY" });
    mocks.generate.mockResolvedValue({ object: proposal });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY" });
    const product = "你们产品有哪些型号？";
    mocks.generate.mockResolvedValue({ object: domainSemanticFixture(product, "PRODUCT_DISCOVERY", { relation: "NEW", reference: { scope: "NONE", revision: null, items: [] } }) });
    expect(await resolveDomainTurn(ctx(product))).toMatchObject({ intent: "PRODUCT_DISCOVERY", mutation: "NONE" });
    expect(DOMAIN_SEMANTIC_PROMPT).toContain("QUERY只查询已发布记录");
    expect(DOMAIN_SEMANTIC_PROMPT).toContain("PRODUCT_DISCOVERY/PRODUCT_DETAIL");
  });
  it.each(["你好"])("%s不依赖分类模型", async message => {
    mocks.runtime.mockRejectedValue(new Error("故障"));
    expect((await resolveDomainTurn(ctx(message))).mutation).toBe("NONE");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("开放表达只分类一次，包含完整JSON字段合同，无正式ID", async () => {
    const message = "请把那几个可供项目备选的结果拿给我看看";
    mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_QUERY") });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY" });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0]![0].system).toContain("JSON Schema");
  });
  it("S4省略澄清的分类输入含上轮权威条件，不只看是否有候选", async () => {
    const context = ctx("是板自身的");
    context.taskState.lastReferenceLookup.query = { filters: [{ metric: "PRODUCT_R", targetValue: 8.3, mode: "APPROX" }] };
    context.taskState.lastReferenceLookup.candidates = [];
    mocks.generate.mockImplementation(async options => {
      const input = JSON.parse(options.prompt);
      expect(input.previousQuery.filters).toEqual(context.taskState.lastReferenceLookup.query.filters);
      expect(input.candidates.items).toEqual([]);
      return { object: domainSemanticFixture("是板自身的", "REFERENCE_REFINE") };
    });
    expect(await resolveDomainTurn(context)).toMatchObject({ intent: "REFERENCE_REFINE", mutation: "QUERY" });
  });
  it.each(["lowConfidence", "forgedEvidence", "id"])("%s输出不签发写入授权", async failure => {
    const object: any = domainSemanticFixture("我就要那个", "SOLUTION_ACTION");
    if (failure === "lowConfidence") object.confidence = .4;
    if (failure === "forgedEvidence") object.evidence = "不存在的原话";
    if (failure === "id") object.schemeId = "invented";
    mocks.generate.mockResolvedValue({ object });
    expect((await resolveDomainTurn(ctx("我就要那个"))).mutation).toBe("NONE");
  });
  it("未知问题分类故障针对当前范围澄清，日志不带原话/响应正文", async () => {
    mocks.runtime.mockRejectedValue(new Error("秘密响应正文"));
    const context = ctx("一条含私密内容的普通提问");
    expect((await resolveDomainTurn(context)).intent).toBe("CLARIFY");
    expect(JSON.stringify(context.app.log.warn.mock.calls)).not.toMatch(/秘密响应正文|私密内容/);
  });
});
