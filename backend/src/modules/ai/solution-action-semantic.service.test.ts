import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), runtime: vi.fn(), audit: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
import { parseSolutionAction } from "./solution-action-semantic.service.js";
import { groundSolutionAction, type ParsedSolutionAction, type CandidateReference } from "./solution-action-semantic.js";
import { applySolutionAction, emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
const candidates = ["A", "B", "C"].map((id, index) => referenceSolutionCandidate({ id, schemeCode: `A1-${index + 1}`, thicknessMm: [18, 30, 20][index] }));
const pool = () => refreshSolution(emptySolution(), {}, candidates);
const ctx = { app: { db: {}, log: { warn: vi.fn() } }, request: {}, user: { id: "user" }, conversation: { id: "conversation", scene: "general_chat" } } as any;
const semantic = (type: ParsedSolutionAction["type"], message: string, references: CandidateReference[] = [], extra: Partial<ParsedSolutionAction> = {}): ParsedSolutionAction => ({
  type, references, selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", evidence: message, confidence: .96, unresolved: [], ...extra
});
const position = (value: number, evidence: string): CandidateReference => ({ type: "POSITION", value, evidence });
const thickness = (value: number, evidence: string): CandidateReference => ({ type: "THICKNESS", value, evidence });
beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {}, modelId: "configured-model" } }); });
describe("Solution Action Semantic Parser → Grounding → 既有mutation", () => {
  it.each([
    ["1和3先留着", "SELECT", [position(1, "1"), position(3, "3")], ["A", "C"]],
    ["第三套先撤掉", "REMOVE", [position(3, "第三套")], ["C"]],
    ["18和20厚那两个加进来", "ADD", [thickness(18, "18"), thickness(20, "20厚")], ["A", "C"]],
    ["前两个加进方案", "ADD", [{ type: "POOL_PREFIX", value: 2, evidence: "前两个" }], ["A", "B"]],
    ["最终我就要第一和第三个", "SET_FINAL", [position(1, "第一"), position(3, "第三个")], ["A", "C"]]
  ] as const)("开放自然表达%s调用LLM并映射正式身份", async (message, type, refs, ids) => {
    const state = pool(); mocks.generate.mockResolvedValue({ object: semantic(type, message, [...refs]) });
    const parsed = await parseSolutionAction(ctx, message, state);
    expect(mocks.generate).toHaveBeenCalledTimes(1); expect(parsed).toMatchObject({ action: type, candidateIds: [...ids], parserSource: "LLM" });
    const changed = applySolutionAction(state, { action: parsed!.action, expectedVersion: 1, candidateIds: parsed!.candidateIds });
    if (type === "REMOVE") expect(changed.rejectedCandidateIds).toEqual(ids);
    else expect(changed.selectedCandidateIds).toEqual(ids);
  });
  it("除了第二个其他都先保留：排除引用由后端做集合运算", async () => {
    const message = "除了第二个其他都先保留";
    mocks.generate.mockResolvedValue({ object: semantic("SELECT", message, [position(2, "第二个")], { selectionMode: "EXCLUDE" }) });
    expect((await parseSolutionAction(ctx, message, pool()))?.candidateIds).toEqual(["A", "C"]);
  });
  it("旧已选厚度引用从Selected定位，不猜新列表序号", async () => {
    let state = applySolutionAction(pool(), { action: "ADD", expectedVersion: 1, candidateIds: ["B"] });
    state = refreshSolution(state, {}, [candidates[0]!]);
    const message = "刚才选的30厚那个不要了";
    mocks.generate.mockResolvedValue({ object: semantic("REMOVE", message, [thickness(30, "30厚")], { referenceScope: "CURRENT_SELECTION" }) });
    expect((await parseSolutionAction(ctx, message, state))?.candidateIds).toEqual(["B"]);
  });
  it("这几个帮我比较一下只输出COMPARE，不选择全池", async () => {
    const message = "这几个帮我比较一下";
    mocks.generate.mockResolvedValue({ object: semantic("COMPARE_SELECTED", message) });
    const parsed = await parseSolutionAction(ctx, message, pool());
    expect(parsed).toMatchObject({ action: "COMPARE" }); expect(parsed).not.toHaveProperty("candidateIds");
  });
  it.each(["candidateId", "thermalReferenceRowId", "schemeId"])("结构化输出伪造%s被schema拒绝，State不变", async field => {
    const state = pool(), frozen = structuredClone(state), message = "1和3先留着";
    mocks.generate.mockResolvedValue({ object: { ...semantic("SELECT", message, [position(1, "1")]), [field]: "invented" } });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
  it.each([
    ["第三套先撤掉", [position(99, "第三套")]],
    ["18厚那个留下", [thickness(30, "18厚")]],
    ["A9-9留下", [{ type: "CONSTRUCTION_CODE", value: "A9-9", evidence: "A9-9" }]]
  ] as const)("非法/不存在引用%s只澄清", async (message, refs) => {
    const state = pool(), frozen = structuredClone(state);
    mocks.generate.mockResolvedValue({ object: semantic("SELECT", message, [...refs]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
  it("相同厚度多个候选必须澄清；版本变化不能沿用旧序号", () => {
    const state = pool(); state.candidates[1]!.candidate.thicknessMm = 18;
    expect(groundSolutionAction("18厚那个留下", semantic("SELECT", "18厚那个留下", [thickness(18, "18厚")]), state, 1)?.clarification).toBeTruthy();
    expect(groundSolutionAction("1留下", semantic("SELECT", "1留下", [position(1, "1")]), state, 0)?.clarification).toBeTruthy();
  });
  it.each(["可以", "行", "就这样", "没问题"])("%s不调用模型且不确认", async message => {
    expect(await parseSolutionAction(ctx, message, pool())).toBeNull(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each(["确认生成方案", "确认最终方案", "确认提交"])("%s走确认Fast Path", async message => {
    expect(await parseSolutionAction(ctx, message, pool())).toMatchObject({ action: "CONFIRM", parserSource: "FAST_PATH" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("LLM不能提出CONFIRM_FINAL；普通查询NONE不触发mutation", async () => {
    mocks.generate.mockResolvedValueOnce({ object: { ...semantic("SELECT", "帮忙确认一下"), type: "CONFIRM_FINAL" } });
    expect((await parseSolutionAction(ctx, "帮忙确认一下", pool()))?.clarification).toBeTruthy();
    mocks.generate.mockResolvedValueOnce({ object: semantic("NONE", "有没有更薄的") });
    expect(await parseSolutionAction(ctx, "有没有更薄的", pool())).toBeNull();
  });
  it("模型故障/低置信度不回退到猜测动作", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("模型暂不可用"));
    expect(await parseSolutionAction(ctx, "1和3先留着", pool())).toMatchObject({ parserSource: "UNAVAILABLE", clarification: expect.any(String) });
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", "1留下", [position(1, "1")], { confidence: .5 }) });
    expect((await parseSolutionAction(ctx, "1留下", pool()))?.clarification).toBeTruthy();
  });
  it("复用既有热工符号Fast Path，不额外依赖动作模型", async () => {
    expect(await parseSolutionAction(ctx, "K<=0.3", pool())).toBeNull(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("批量引用任一项非法或嵌套伪造ID，整个动作澄清；Prompt不含正式候选ID", async () => {
    const state = pool(), frozen = structuredClone(state), message = "1和99先留着";
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", message, [position(1, "1"), position(99, "99")]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
    const prompt = JSON.parse(mocks.generate.mock.calls[0]![0].prompt);
    expect(prompt.pool[0]).not.toHaveProperty("candidateId"); expect(prompt.pool[0]).not.toHaveProperty("id");
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", message, [{ ...position(1, "1"), candidateId: "fake" } as any]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
});
