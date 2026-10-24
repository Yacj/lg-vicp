import "dotenv/config";
import { EventEmitter } from "node:events";
import { getTableName } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ domain: vi.fn(), parameters: vi.fn(), explanation: vi.fn(), compliance: vi.fn(), stream: vi.fn(), events: [] as any[], knowledge: vi.fn(), save: vi.fn(), formal: vi.fn(), reference: vi.fn(), advice: vi.fn(), publish: vi.fn() }));
vi.mock("./reference-query.service.js", () => ({ resolveReferenceQueryWithoutAgent: m.reference }));
vi.mock("./solution-advice.service.js", () => ({ resolveSolutionAdvice: m.advice,
  emitSolutionAdvice: (_reply: unknown, result: { answer: string }) => m.events.push({ event: "delta", data: { text: result.answer } }) }));
vi.mock("./candidate-result.service.js", () => ({ publishCandidateResult: m.publish, candidateResultDto: () => ({}) }));
vi.mock("./product-parameter-explanation.js", () => ({ readProductParameterExplanation: m.explanation }));
vi.mock("./compliance-explanation.service.js", () => ({ readComplianceExplanation: m.compliance }));
vi.mock("ai", () => ({ streamText: m.stream }));
vi.mock("./ai-domain-turn-decision.service.js", () => ({ resolveDomainTurn: m.domain }));
vi.mock("./product-parameter-read.service.js", () => ({ readProductParameters: m.parameters }));
vi.mock("./ai-content-filter.service.js", () => ({ checkContentFiltered: async () => null }));
vi.mock("./ai-vision.service.js", () => ({ validateChatImageAttachments: async () => [] }));
vi.mock("./ai-runtime.service.js", () => ({ enforceAiQuota: async () => {}, createConcurrencyRelease: () => async () => {},
  resolveSceneRuntime: async () => ({ primary: { providerId: "provider", providerName: "fixture", modelRef: { id: "model" }, modelId: "fixture", languageModel: {} },
    promptVersionId: "prompt", promptVersionNumber: 1, reasoning: {}, allowKnowledgeSearch: true, fallback: null }) }));
vi.mock("./ai-context-builder.js", () => ({ buildAiContext: async () => ({ system: "", messages: [], droppedEarlyMessages: false }) }));
vi.mock("./ai-agent.service.js", () => ({ getActiveAgentRun: async () => null, cancelRunningAgentRuns: async () => {}, cancelAgentRunsForAssistantMessage: async () => {}, resolveAgentModel: async () => null }));
vi.mock("./ai-conversation-state.service.js", () => ({ getConversationTaskState: async () => ({ taskType: "GENERAL", lastReferenceLookup: {
  query: { filters: [{ metric: "K", targetValue: .2, mode: "APPROX" }] }, candidates: [], candidateQueryRevision: 7, projectId: null, createdAt: new Date().toISOString() } }), saveConversationTaskState: m.save,
  updateConversationSummary: async () => {}, scheduleConversationMaintenance: () => {} }));
vi.mock("./solution-advice-context.service.js", () => ({ loadAdviceBusinessContext: async () => undefined }));
vi.mock("./solution-state.service.js", async original => ({ ...await original<any>(), loadActiveSolution: async () => null, isEditableSolution: () => false, startSolution: m.formal, actOnSolution: m.formal, activateSolutionFromLastLookup: m.formal }));
vi.mock("./ai-knowledge-load.js", () => ({ loadKnowledgeForGeneration: m.knowledge }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: async () => {} }));
vi.mock("./ai-sse.js", () => ({ startSseStream: () => {}, writeProgress: () => {}, writeSse: (_r: any, event: string, data: any) => m.events.push({ event, data }), isAbortError: () => false }));
import { streamConversationReply } from "./ai-generation.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
beforeEach(() => { vi.clearAllMocks(); m.events.length = 0; m.knowledge.mockResolvedValue({ chunks: [], retrievalFailed: false }); m.reference.mockResolvedValue(undefined); });

function progressFixture() {
  const saved: any[] = [];
  const raw = Object.assign(new EventEmitter(), { end: vi.fn() });
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [], orderBy: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: () => ({ set: (values: any) => ({ where: async () => { saved.push(values); } }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: vi.fn(async () => 1) } };
  const options: any = { app, request: { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } },
    reply: { raw }, user: { id: "u", clientType: "C_APP" }, conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" }, content: "查看产品导热系数" };
  return { app, raw, saved, options };
}

it("查询尚未执行时即推送真实分析进度；来源仅在查询返回后出现", async () => {
  const fixture = progressFixture();
  m.domain.mockImplementation(async () => {
    expect(m.events[0].event).toBe("message");
    expect(m.events.some(item => item.data.stepId === "understanding" && item.data.status === "active")).toBe(true);
    expect(m.parameters).not.toHaveBeenCalled();
    expect(m.events.some(item => item.data.sources?.length)).toBe(false);
    return { intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE" };
  });
  m.parameters.mockResolvedValue({ answer: "参数见来源。", sources: [{ title: "正式热工资料", pageLabel: "A7", documentId: "internal", reasoning_content: "private" }] });
  await streamConversationReply(fixture.options);
  expect(m.events.find(item => item.event === "error")).toBeUndefined();
  const sourceEvent = m.events.find(item => item.data.stepId === "sources");
  expect(sourceEvent.data.sources).toEqual([{ title: "正式热工资料", pageLabel: "A7" }]);
  expect(m.events.findIndex(item => item.data.stepId === "parameters" && item.data.status === "done"))
    .toBeLessThan(m.events.indexOf(sourceEvent));
  expect(fixture.raw.listenerCount("close")).toBe(0);
});

it("SSE准备阶段失败也发送错误并释放生成状态，不永久停在思考中", async () => {
  const fixture = progressFixture();
  m.domain.mockRejectedValue(new Error("模型不可用"));
  await streamConversationReply(fixture.options);
  expect(m.events.filter(item => item.event === "error")).toHaveLength(1);
  expect(m.events.some(item => item.data.stepId === "understanding" && item.data.status === "error")).toBe(true);
  expect(fixture.saved.some(item => item.status === "FAILED")).toBe(true);
  expect(fixture.raw.end).toHaveBeenCalledOnce();
  expect(fixture.raw.listenerCount("close")).toBe(0);
  expect(m.formal).not.toHaveBeenCalled();
});

it("准备阶段断开连接时不再执行查询或正式动作，也不宣称完成", async () => {
  const fixture = progressFixture();
  m.domain.mockImplementation(async () => { fixture.raw.emit("close"); return { intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE" }; });
  await streamConversationReply(fixture.options);
  expect(m.parameters).not.toHaveBeenCalled();
  expect(m.formal).not.toHaveBeenCalled();
  expect(m.publish).not.toHaveBeenCalled();
  expect(m.events.some(item => item.event === "stopped")).toBe(true);
  expect(m.events.some(item => item.data.status === "stopped")).toBe(true);
  expect(fixture.saved.some(item => item.status === "STOPPED")).toBe(true);
  expect(fixture.raw.listenerCount("close")).toBe(0);
});
it("标准依据解释不能回落自由生成、工具查询或正式方案操作", async () => {
 const content="刚才用哪份标准，何时实施";
 const semantic=domainSemanticFixture(content,"KNOWLEDGE_EXPLAIN",{complianceExplanation:{evidence:content},reference:{scope:"NONE",revision:null,items:[]}});
 m.domain.mockResolvedValue({intent:"KNOWLEDGE_EXPLAIN",mutation:"NONE",semantic});
 m.compliance.mockResolvedValue({answer:"目前没有可引用的正式标准限值，可以提供正式文件继续核对。",sources:[],
  context:{messageId:"previous",createdAt:new Date().toISOString(),compliance:{status:"UNAVAILABLE"}}});
 const completed:any[]=[];
 const db:any={select:()=>{const b:any={from:()=>b,where:()=>b,limit:async()=>[],orderBy:async()=>[]};return b;},
  insert:()=>({values:(values:any)=>({returning:async()=>[{...values,id:values.role==="USER"?"current":"assistant"}]})}),
  update:(table:any)=>({set:(values:any)=>({where:async()=>{if(getTableName(table)==="ai_messages")completed.push(values);}})}),transaction:async(run:any)=>run(db)};
 const app:any={db,redis:{incr:async()=>1,expire:async()=>{},set:async()=>"OK",get:async()=>null,exists:async()=>0,del:async()=>1}};
 await streamConversationReply({app,request:{id:"req",raw:new EventEmitter(),log:{warn:vi.fn(),info:vi.fn(),error:vi.fn()}} as any,
  reply:{raw:{end:vi.fn()}} as any,user:{id:"u",clientType:"C_APP"} as any,
  conversation:{id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat",reasoningMode:"OFF",title:"fixture"} as any,content});
 expect(m.events.find(e=>e.event==="error")).toBeUndefined();expect(m.events.filter(e=>e.event==="delta").map(e=>e.data.text).join("")).toContain("没有可引用的正式标准限值");
 expect(m.stream).not.toHaveBeenCalled();expect(m.formal).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();
 expect(m.knowledge.mock.calls[0]![0].needSearch).toBe(false);
 expect(completed.find(v=>v.metadata)?.metadata.backendDecision.factValidationCode).toBe("COMPLIANCE_SOURCE_EXPLANATION_ONLY");
});
it("已核验的资料冲突不是用户待澄清，也不能标成工程数值错误", async () => {
 const content="比较当前参考方案";
 m.domain.mockResolvedValue({intent:"COMPARE_CANDIDATES",mutation:"NONE",semantic:domainSemanticFixture(content,"COMPARE_CANDIDATES")});
 m.reference.mockResolvedValue({readOnly:true,needsClarification:false,sources:[],referencePages:[],
  facts:{query:{unresolved:[{field:"reference",reason:"没有第二条有效候选"}]},candidates:[],canonicalAnswers:["42mm参考行绑定了28mm规格，可以先选可用卡片。"]},
  availability:{answer:"42mm参考行绑定了28mm规格，可以先选可用卡片。",queryRevision:7,validationCode:"CANDIDATE_AVAILABILITY_REVALIDATED"}});
 const saved:any[]=[];
 const db:any={select:()=>{const b:any={from:()=>b,where:()=>b,limit:async()=>[],orderBy:async()=>[]};return b;},
  insert:()=>({values:(values:any)=>({returning:async()=>[{...values,id:values.role==="USER"?"current":"assistant"}]})}),
  update:(table:any)=>({set:(values:any)=>({where:async()=>{if(getTableName(table)==="ai_messages")saved.push(values);}})}),transaction:async(run:any)=>run(db)};
 const app:any={db,redis:{incr:async()=>1,expire:async()=>{},set:async()=>"OK",get:async()=>null,exists:async()=>0,del:async()=>1}};
 await streamConversationReply({app,request:{id:"req",raw:new EventEmitter(),log:{warn:vi.fn(),info:vi.fn(),error:vi.fn()}} as any,
  reply:{raw:{end:vi.fn()}} as any,user:{id:"u",clientType:"C_APP"} as any,
  conversation:{id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat",reasoningMode:"OFF",title:"fixture"} as any,content});
 expect(m.events.find(e=>e.event==="error")).toBeUndefined();
 const decision=saved.find(v=>v.metadata)?.metadata.backendDecision;
 expect(decision).toMatchObject({queryNeedsClarification:false,factValidationCode:"CANDIDATE_AVAILABILITY_REVALIDATED",solutionStateMutated:false});
 expect(decision.pendingQueryNeed).toBeUndefined();expect(m.stream).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();expect(m.formal).not.toHaveBeenCalled();
});
it.each([true, false])("生成编排Mock：建议中的查询未决=%s时，通用建议不能覆盖真实查询结论", async needsClarification => {
  const content = "按新的参考条件给建议";
  m.domain.mockResolvedValue({ intent: "SOLUTION_ADVICE", mutation: "NONE", requiresCandidateQuery: true,
    semantic: domainSemanticFixture(content, "SOLUTION_ADVICE") });
  const answer = needsClarification ? "这次来源还未确认，已有基层条件会保留。" : "目前资料里暂没查到传热系数接近0.1的记录。";
  m.reference.mockResolvedValue({ facts: { query: { filters: [{ metric: "K", targetValue: .1, mode: "APPROX" }],
    unresolved: needsClarification ? [{ field: "referenceSetIds", reason: answer }] : [] }, candidates: [], canonicalAnswers: [answer],
    ...(!needsClarification ? { queryDiagnostics: { scope: "JOINT", issues: ["NO_MATCHING_VALUE"], scannedCount: 1,
      identityCount: 1, matchedCount: 0, missingMetrics: [], metricScopes: [], coverage: "AUTHORIZED_PUBLISHED_ONLY" } } : {}) },
    needsClarification, ...(!needsClarification ? { readOnly: true } : {}), sources: [], referencePages: [] });
  m.advice.mockResolvedValue({ answer: "请重新提供基层。", candidates: [], sources: [], referencePages: [], verified: false });
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  await streamConversationReply({ app, request: { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } } as any,
    reply: { raw: { end: vi.fn() } } as any, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain(answer);
  expect(m.advice).not.toHaveBeenCalled(); expect(m.formal).not.toHaveBeenCalled();
  if (needsClarification) {
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.save.mock.calls.at(-1)?.[2].lastReferenceLookup.candidateQueryRevision).toBe(7);
  }
});
it("生成编排Mock：查询完成后只消费SSOT，不把原始建议提案再次当作筛选条件", async () => {
  const content = "按基层200mm的参考数据给建议，暂不谈地区";
  const semantic = domainSemanticFixture(content, "SOLUTION_ADVICE", { constraintPatch: [
    { field: "thicknessMm", op: "SET", value: 200, evidence: "基层200mm" },
    { field: "region", op: "EXCLUDE_FROM_THIS_ADVICE", value: null, evidence: "暂不谈地区" }
  ] });
  m.domain.mockResolvedValue({ intent: "SOLUTION_ADVICE", mutation: "NONE", requiresCandidateQuery: true, semantic });
  const query = { substrateThickness: 200, filters: [] }, candidates = [{ id: "actual", thicknessMm: 25, substrateThickness: 200 }];
  m.reference.mockImplementation(async (ctx: any) => {
    ctx.taskState.lastReferenceLookup = { query, candidates, candidateQueryRevision: 8, projectId: null, createdAt: new Date().toISOString() };
    return { facts: { query, candidates, canonicalAnswers: ["板厚25mm，基层200mm"], queryDiagnostics: { scope: "JOINT", issues: [],
      scannedCount: 1, identityCount: 1, matchedCount: 1, missingMetrics: [], metricScopes: [], coverage: "AUTHORIZED_PUBLISHED_ONLY" } },
      readOnly: true, needsClarification: false, sources: [], referencePages: [] };
  });
  m.advice.mockResolvedValue({ answer: "已核验的参考做法为板厚25mm、基层200mm。", candidates, sources: [], referencePages: [], verified: true });
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  await streamConversationReply({ app, request: { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } } as any,
    reply: { raw: { end: vi.fn() } } as any, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content });
  expect(m.advice).toHaveBeenCalledOnce();
  expect(m.advice.mock.calls[0]?.[0].domainDecision.semantic.constraintPatch).toEqual([semantic.constraintPatch[1]]);
  expect(m.advice.mock.calls[0]?.[0].candidateQueryRevision).toBe(8);
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain("板厚25mm、基层200mm");
  expect(m.formal).not.toHaveBeenCalled();
});
it("生成编排Mock：参数Service事实直出，保存诊断；不调用回答模型或正式方案", async () => {
  const semantic = domainSemanticFixture("导热系数", "PRODUCT_PARAMETER_QUERY", { parameterQuery: { parameter: "LAMBDA", subjectType: "ANY", subjectText: null, systemText: null,
    targetValue: .3, operator: "EXACT", tolerance: null, unit: "W/(m·K)", evidence: "导热系数" }, pageQuery: null, reference: { scope: "NONE", revision: null, items: [] } });
  m.domain.mockResolvedValue({ intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", policyReason: "READ_ONLY_SEMANTIC", semantic });
  m.parameters.mockResolvedValue({ query: semantic.parameterQuery, facts: [], sources: [], answer: "本次搜索范围有独立 λ 参数，但没有符合当前数值条件的记录。", diagnostics: { issues: ["VALUE_NO_MATCH"], scannedCount: 1, matchedCount: 0 } });
  const writes: any[] = [];
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: (table: any) => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table: getTableName(table), values }); } }) }),
    transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  const request: any = { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }, reply: any = { raw: { end: vi.fn() } };
  await streamConversationReply({ app, request, reply, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content: "导热系数" });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain("没有符合当前数值条件");
  expect(m.events.find(e => e.event === "done").data.finishReason).toBe("COMPLETED");
  const completed = writes.find(w => w.table === "ai_messages" && w.values.status === "COMPLETED");
  expect(completed.values.metadata.backendDecision).toMatchObject({ domainIntent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", answerContract: "PRODUCT", toolRoute: ["backend:product_parameter_query"],
    parameterQuery: { targetValue: .3 }, parameterQueryDiagnostics: { issues: ["VALUE_NO_MATCH"] }, factValidationCode: "PARAMETER_SERVICE_FACTS_ONLY", solutionStateMutated: false });
  expect(m.knowledge.mock.calls[0]![0].needSearch).toBe(false); expect(m.stream).not.toHaveBeenCalled(); expect(m.formal).not.toHaveBeenCalled();
  expect(completed.values.metadata.backendDecision.queryChanged).toBe(false);
  expect(m.save.mock.calls.at(-1)![2].lastReferenceLookup).toMatchObject({ candidateQueryRevision: 7, query: { filters: [{ metric: "K", targetValue: .2 }] } });
  expect(writes.every(w => w.table === "ai_messages" || w.table === "ai_conversations")).toBe(true);
});
it("动作分类后Parser返回无动作时直接说明实际状态，不调用自由回答或造Final", async () => {
  const content = "保持现状";
  m.domain.mockResolvedValue({ intent: "SOLUTION_ACTION", mutation: "SOLUTION", semantic: domainSemanticFixture(content, "SOLUTION_ACTION") });
  const writes: any[] = [];
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table: getTableName(table), values }); } }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  await streamConversationReply({ app, request: { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } } as any,
    reply: { raw: { end: vi.fn() } } as any, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain("尚未形成待确认的最终方案");
  expect(m.stream).not.toHaveBeenCalled();expect(m.formal).not.toHaveBeenCalled();
  expect(writes.find(w=>w.table==="ai_messages" && w.values.status==="COMPLETED").values.metadata.backendDecision)
    .toMatchObject({solutionStateMutated:false,reportQueued:false});
});
it.each([false, true])("生成编排Mock：通用澄清与真实查询缺项区分保存，queryClarification=%s", async queryClarification => {
  const content = "需要明确当前资料对象";
  m.domain.mockResolvedValue({ intent: "CLARIFY", mutation: "NONE", semantic: domainSemanticFixture(content, "SOLUTION_ADVICE", { confidence: .6 }) });
  m.reference.mockResolvedValue({ facts: { query: {}, candidates: [], canonicalAnswers: ["请明确对应资料。"] },
    readOnly: true, needsClarification: true, ...(queryClarification ? { queryClarification: true } : {}), sources: [], referencePages: [] });
  const writes: any[] = [];
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table: getTableName(table), values }); } }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  await streamConversationReply({ app, request: { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } } as any,
    reply: { raw: { end: vi.fn() } } as any, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  const decision = writes.find(w => w.table === "ai_messages" && w.values.status === "COMPLETED").values.metadata.backendDecision;
  expect(decision.pendingQueryContractVersion).toBe(1);
  expect(decision.queryNeedsClarification).toBe(queryClarification);
  expect(!!decision.pendingQueryNeed).toBe(queryClarification);
  expect(decision).toMatchObject({ solutionStateMutated: false, reportQueued: false });
  expect(m.formal).not.toHaveBeenCalled(); expect(m.publish).not.toHaveBeenCalled();
});
it("D08解释诊断直接走同一生成合同，不重新读取参数、调用回答模型或改变候选", async () => {
  const content = "查了哪些资料？";
  const semantic = domainSemanticFixture(content, "KNOWLEDGE_EXPLAIN", { parameterExplanation: { evidence: content }, reference: { scope: "NONE", revision: null, items: [] } });
  m.domain.mockResolvedValue({ intent: "KNOWLEDGE_EXPLAIN", mutation: "NONE", semantic });
  m.explanation.mockResolvedValue({ answer: "上次查询导热系数λ=0.3，核验了正式产品目录和已发布材料参数。", explanationOfMessageId: "previous" });
  const writes: any[] = [];
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: () => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table: getTableName(table), values }); } }) }), transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  const request: any = { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }, reply: any = { raw: { end: vi.fn() } };
  await streamConversationReply({ app, request, reply, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain("正式产品目录");
  const completed = writes.find(w => w.table === "ai_messages" && w.values.status === "COMPLETED");
  expect(completed.values.metadata.backendDecision).toMatchObject({ parameterExplanationOfMessageId: "previous", factValidationCode: "PARAMETER_DIAGNOSTICS_ONLY",
    queryChanged: false, toolRoute: ["backend:product_parameter_explanation"], solutionStateMutated: false, reportQueued: false });
  expect(m.parameters).not.toHaveBeenCalled(); expect(m.stream).not.toHaveBeenCalled(); expect(m.formal).not.toHaveBeenCalled();
  expect(m.knowledge.mock.calls[0]![0].needSearch).toBe(false);
});
