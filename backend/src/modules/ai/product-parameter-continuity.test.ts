import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const m = vi.hoisted(() => ({ generate: vi.fn(), runtime: vi.fn(), pending: vi.fn(), dictionary: vi.fn(), access: vi.fn() }));
vi.mock("ai", () => ({ generateObject: m.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: m.runtime }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: async () => [] }));
vi.mock("./query-clarification-context.js", async original => ({ ...await original<typeof import("./query-clarification-context.js")>(), readQueryClarification: m.pending }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: m.dictionary }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access }));
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
import { readProductParameters } from "./product-parameter-read.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const parameter = { parameter: "LAMBDA" as const, subjectType: "ANY" as const, subjectText: null, systemText: null, operator: "EXACT" as const,
  targetValue: .3, tolerance: null, unit: "W/(m·K)" as const, evidence: "导热系数" };
function context(message = "导热系数") {
  const reads: string[] = [];
  const db = { select: () => { let table = ""; const b: any = { from: (t: any) => { table = getTableName(t); reads.push(table); return b; },
    innerJoin: () => b, where: () => b, orderBy: () => b, then: (r: any) => Promise.resolve(table === "catalog_products" ? [{ id: "p", name: "VICP复合保温板", thermalConductivity: .005 }] : []).then(r) }; return b; }, insert: vi.fn(), update: vi.fn() };
  return { reads, app: { db, log: { warn: vi.fn() } }, conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" },
    user: { id: "u", clientType: "C_APP" }, request: {}, userMessage: message, currentUserMessageId: "current", taskState: { taskType: "GENERAL" } } as any;
}
function proposal(message = "导热系数") { return domainSemanticFixture(message, "PRODUCT_PARAMETER_QUERY", { parameterQuery: { ...parameter, evidence: message }, pageQuery: null,
  queryContext: "CLARIFICATION_REPLY", relation: "CONTINUE", reference: { scope: "NONE", revision: null, items: [] } }); }
beforeEach(() => { vi.clearAllMocks(); m.runtime.mockResolvedValue({ primary: { languageModel: {} } });
  m.pending.mockResolvedValue({ messageId: "q", message: "有保温0.3的材料么", question: "请说明指标", inheritPrevious: false });
  m.access.mockResolvedValue({ id: "c", userId: "u", clientApp: "c_app", projectId: null }); });
it("待澄清的唯一0.3与本轮K已可校核时，允许一次语义复核；绝不直接提高低置信度",async()=>{
  const text="K",s=domainSemanticFixture(text,"REFERENCE_QUERY",{queryContext:"CLARIFICATION_REPLY",relation:"CONTINUE",confidence:.62,
    unresolved:"未给单位",reference:{scope:"NONE",revision:null,items:[]},pageQuery:{intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",confidence:.62,unresolved:[],constraints:[],preferences:[]}});
  m.generate.mockResolvedValue({object:s});
  const result=await resolveDomainTurn(context(text));expect(result.intent).toBe("CLARIFY");expect(m.generate).toHaveBeenCalledTimes(2);
  const input=JSON.parse(m.generate.mock.calls[1]![0].prompt);expect(input.engineeringHints.clarificationBinding).toMatchObject({currentMetric:"K",originalNumbers:[{raw:"0.3"}]});
});
it("误把成功查询当pending，仅重提案作用域；不能绑定不存在的原问",async()=>{
  m.pending.mockResolvedValue(null);
  const s=domainSemanticFixture("K0.3","REFERENCE_QUERY",{queryContext:"CLARIFICATION_REPLY",relation:"CONTINUE",reference:{scope:"NONE",revision:null,items:[]},
    pageQuery:{intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",confidence:.95,unresolved:[],constraints:[],preferences:[]}});
  m.generate.mockResolvedValue({object:s});expect((await resolveDomainTurn(context("K0.3"))).policyReason).toBe("QUERY_CONTEXT_EXPIRED");expect(m.generate).toHaveBeenCalledTimes(2);
});
it("两轮Domain→Policy→Service保留0.3，只读λ零命中，不查K/R或生成候选", async () => {
  const first = "有保温0.3的材料么";
  m.generate.mockResolvedValueOnce({ object: domainSemanticFixture(first, "CLARIFY", { relation: "NEW", unresolved: "请说明指标或单位" }) });
  expect((await resolveDomainTurn(context(first))).intent).toBe("CLARIFY");
  m.generate.mockImplementationOnce(async options => { const input = JSON.parse(options.prompt); expect(input.pendingClarification.message).toBe(first); return { object: proposal() }; });
  const c = context(), before = structuredClone(c.taskState);
  const decision = await resolveDomainTurn(c);
  expect(decision).toMatchObject({ intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", policyReason: "READ_ONLY_SEMANTIC", queryContextMessageId: "q", queryCurrentMessageId: "current" });
  const result = await readProductParameters({ ...c, domainDecision: decision });
  expect(result.query).toMatchObject({ parameter: "LAMBDA", targetValue: .3, unit: "W/(m·K)" });
  expect(result.facts).toEqual([]); expect(result.diagnostics.issues).toContain("VALUE_NO_MATCH"); expect(result.answer).not.toContain("基层");
  expect(c.reads).not.toContain("thermal_reference_rows"); expect(m.dictionary).not.toHaveBeenCalled();
  expect(c.taskState).toEqual(before); expect(c.app.db.insert).not.toHaveBeenCalled(); expect(c.app.db.update).not.toHaveBeenCalled();
});
it("过期或未绑定的pending不能从历史恢复数值", async () => {
  m.pending.mockResolvedValue(null); m.generate.mockResolvedValue({ object: proposal() });
  expect(await resolveDomainTurn(context())).toMatchObject({ intent: "CLARIFY", policyReason: "QUERY_CONTEXT_EXPIRED" });
});
it("参数修正以本轮值为准，不能从目录或旧候选把0.3改为0.005", async () => {
  m.generate.mockResolvedValue({ object: { ...proposal(), parameterQuery: { ...parameter, targetValue: .005 } } });
  expect(await resolveDomainTurn(context())).toMatchObject({ intent: "CLARIFY", policyReason: "PARAMETER_EVIDENCE_INVALID" });
  const text = "导热系数0.2"; const valid = proposal(text); valid.parameterQuery!.targetValue = .2; m.generate.mockResolvedValue({ object: valid });
  expect((await resolveDomainTurn(context(text))).semantic?.parameterQuery?.targetValue).toBe(.2);
});
it("切话题或明确新读取不继承待澄清数字", async () => {
  const s = proposal(); s.queryContext = "CURRENT_TURN"; s.relation = "SWITCH_TOPIC"; s.parameterQuery!.operator = "READ"; s.parameterQuery!.targetValue = null;
  m.generate.mockResolvedValue({ object: s });
  const d = await resolveDomainTurn(context()); expect(d.intent).toBe("PRODUCT_PARAMETER_QUERY"); expect(d.queryContextMessageId).toBeUndefined(); expect(d.semantic?.parameterQuery?.targetValue).toBeNull();
});
it("原文体系线索保留，Service不把薄膜灰改成薄抹灰或转K", async () => {
  const text = "薄膜灰导热系数0.3的产品有么", s = proposal(text); s.queryContext = "CURRENT_TURN"; s.relation = "NEW"; s.parameterQuery!.systemText = "薄膜灰";
  m.generate.mockResolvedValue({ object: s }); const c = context(text), d = await resolveDomainTurn(c);
  expect(d.intent).toBe("PRODUCT_PARAMETER_QUERY"); const r = await readProductParameters({ ...c, domainDecision: d });
  expect(r.diagnostics.issues).toContain("NAME_UNRESOLVED"); expect(r.query.systemText).toBe("薄膜灰"); expect(r.answer).not.toContain("请指定基层");
});
it("λ0.3左右→±0.01：承接Service澄清，继承目标并使用用户明确容差", async () => {
  const text = "±0.01", s = proposal(text); s.parameterQuery!.operator = "APPROX"; s.parameterQuery!.tolerance = .01;
  m.pending.mockResolvedValue({ messageId: "q", message: "λ0.3左右", question: "请明确容差", inheritPrevious: false });
  m.generate.mockResolvedValue({ object: s }); const c = context(text), d = await resolveDomainTurn(c);
  expect(d.intent).toBe("PRODUCT_PARAMETER_QUERY");
  expect((await readProductParameters({ ...c, domainDecision: d })).query).toMatchObject({ targetValue: .3, tolerance: .01, operator: "APPROX" });
});
