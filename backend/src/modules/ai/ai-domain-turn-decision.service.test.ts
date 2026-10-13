import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), generate: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
function ctx(message: string) { return { app: { db: {}, log: { warn: vi.fn() } }, conversation: { scene: "general_chat" },
  userMessage: message, taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "one" }] } } } as any; }
beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); });
describe("开放目标受控分类与故障隔离", () => {
  it.each(["你好", "K值是什么意思", "第一个原页", "第一个完整表格", "这个数据来源哪页"])("%s不依赖分类模型", async message => {
    mocks.runtime.mockRejectedValue(new Error("故障"));
    expect((await resolveDomainTurn(ctx(message))).mutation).toBe("NONE");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("开放表达只分类一次，包含完整JSON字段合同，无正式ID", async () => {
    const message = "请把那几个可供项目备选的结果拿给我看看";
    mocks.generate.mockResolvedValue({ object: { intent: "REFERENCE_QUERY", confidence: .95, evidence: message, unresolved: null } });
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
      expect(input.hasCandidates).toBe(false);
      return { object: { intent: "REFERENCE_REFINE", confidence: .95, evidence: "板自身的", unresolved: null } };
    });
    expect(await resolveDomainTurn(context)).toMatchObject({ intent: "REFERENCE_REFINE", mutation: "QUERY" });
  });
  it.each(["lowConfidence", "forgedEvidence", "id"])("%s输出不签发写入授权", async failure => {
    const object: any = { intent: "SOLUTION_ACTION", confidence: .95, evidence: "我就要那个", unresolved: null };
    if (failure === "lowConfidence") object.confidence = .4;
    if (failure === "forgedEvidence") object.evidence = "不存在的原话";
    if (failure === "id") object.schemeId = "invented";
    mocks.generate.mockResolvedValue({ object });
    expect((await resolveDomainTurn(ctx("我就要那个"))).mutation).toBe("NONE");
  });
  it("未知普通问题分类故障继续问答，日志不带原话/响应正文", async () => {
    mocks.runtime.mockRejectedValue(new Error("秘密响应正文"));
    const context = ctx("一条含私密内容的普通提问");
    expect((await resolveDomainTurn(context)).intent).toBe("GENERAL");
    expect(JSON.stringify(context.app.log.warn.mock.calls)).not.toMatch(/秘密响应正文|私密内容/);
  });
});
