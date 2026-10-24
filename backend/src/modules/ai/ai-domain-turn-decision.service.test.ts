import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), generate: vi.fn(), history: vi.fn(), dictionary: vi.fn(), currentRows: vi.fn(), clarification: vi.fn(), active: vi.fn() }));
vi.mock("./reference-candidate-source.service.js", () => ({ referenceRowsStillCurrent: mocks.currentRows }));
vi.mock("./solution-state.service.js", () => ({ loadActiveSolution: async () => mocks.active() ?? null }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: mocks.dictionary }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: mocks.history }));
vi.mock("./query-clarification-context.js", async original => ({ ...await original<typeof import("./query-clarification-context.js")>(), readQueryClarification: mocks.clarification }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
import { resolveDomainTurn, DOMAIN_SEMANTIC_PROMPT, observeDomainSemantic } from "./ai-domain-turn-decision.service.js";
import { currentConfirmedPageLookup } from "./confirmed-page-lookup-state.js";
function ctx(message: string) { return { app: { db: {}, log: { warn: vi.fn() } }, conversation: { scene: "general_chat" },
  userMessage: message, taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "one" }] } } } as any; }
it.each(["valid", "withdrawn", "ambiguous"])("沿用当前构造改厚查询：%s仍由Backend绑定身份并核验来源", async variant => {
  const message = "保留这个做法，查看46mm的参考参数", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  const candidate = { id: "real", systemId: "system", schemeId: "scheme", schemeCode: "SOURCE-CODE", productSpecId: "spec", catalogProductId: "product" };
  mocks.currentRows.mockResolvedValue(variant !== "withdrawn");
  const ids = variant === "ambiguous" ? ["real", "other"] : ["real"];
  mocks.history.mockResolvedValue([{ content: "刚才的构造参数", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ids } } }]);
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", reference: { scope: "NONE", revision: null, items: [] },
    queryBasis: { scope: "CURRENT_REFERENCE", evidence: "保留这个做法" }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .98,
      constraints: [{ type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null,
        operator: "EXACT", value: 46, evidence: "46mm", hard: true, confidence: .98 }], preferences: [], unresolved: [], readFields: ["kValue"] } }) });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, user: { id: "u" }, taskState: { taskType: "GENERAL", lastReferenceLookup: {
    projectId: null, createdAt: new Date().toISOString(), candidateQueryRevision: 3, query: { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: .28 }] },
    candidates: variant === "ambiguous" ? [candidate, { ...candidate, id: "other" }] : [candidate]
  } } });
  if (variant === "valid") {
    expect(actual).toMatchObject({ intent: "REFERENCE_REFINE", mutation: "QUERY", queryBase: { schemeId: "scheme", systemId: "system", productSpecId: "spec", filters: [{ targetValue: .28 }] } });
    expect(mocks.currentRows).toHaveBeenCalledWith(expect.anything(), [candidate], { userId: "u", projectId: null });
  } else expect(actual).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "QUERY_CONTEXT_INVALID" });
});
it("零命中后沿用当前构造改厚，保持最新严格指标而非旧候选的宽条件", async () => {
  const message = "保留这个做法，查看46mm的参考参数", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  const latestQuery = { queryContractVersion: 2, substrateThickness: 180, filters: [{ metric: "K", mode: "GT", targetValue: .28 }] };
  mocks.currentRows.mockResolvedValue(true);
  mocks.history.mockResolvedValue([{ content: "已展示的构造", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["real"] } } }]);
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", reference: { scope: "NONE", revision: null, items: [] },
    queryBasis: { scope: "CURRENT_REFERENCE", evidence: "保留这个做法" }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .98,
      constraints: [{ type: "THICKNESS", operation: "SET", field: null, entityText: null, resolvedText: null, metric: null,
        operator: "EXACT", value: 46, evidence: "46mm", hard: true, confidence: .98 }], preferences: [], unresolved: [], readFields: ["kValue"] } }) });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, user: { id: "u" }, taskState: { taskType: "GENERAL",
    confirmedPageLookup: { conversationId: "c", userId: "u", projectId: null, clientApp: "c_app", createdAt: new Date().toISOString(), query: latestQuery, requestQuery: latestQuery },
    lastReferenceLookup: { projectId: null, createdAt: new Date().toISOString(), candidateQueryRevision: 3,
      query: { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: .28 }] },
      candidates: [{ id: "real", systemId: "system", schemeId: "scheme", productSpecId: "spec" }] } } });
  expect(actual).toMatchObject({ intent: "REFERENCE_REFINE", mutation: "QUERY", queryContractVersion: 2,
    queryBase: { ...latestQuery, systemId: "system", schemeId: "scheme", productSpecId: "spec" } });
});
beforeEach(() => { vi.resetAllMocks(); mocks.clarification.mockResolvedValue(null); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); mocks.history.mockResolvedValue([]); mocks.dictionary.mockResolvedValue({ entities: [], aliases: [] }); });
it.each(["complete", "dropped-value", "dropped-name", "identity-field", "extra-field", "action"])("查询字段复核%s使用窄合同，仍完整检查原条件且不授予动作", async variant => {
  const message = "查甲板外墙，基层180mm，K低于0.28", field = (field: "systemHint" | "applicationPart", entityText: string) => ({
    type: "ENTITY" as const, operation: "SET" as const, field, entityText, resolvedText: null, value: null, metric: null, operator: null,
    evidence: entityText, hard: true as const, confidence: .95 });
  const constraints = [field("systemHint", "甲板外墙"), { type: "THICKNESS" as const, operation: "SET" as const,
    field: "substrateThickness" as const, entityText: null, resolvedText: null, metric: null, operator: "EXACT" as const, value: 180,
    evidence: "180mm", hard: true as const, confidence: .95 }, { type: "METRIC" as const, field: null, entityText: null, resolvedText: null,
    operation: "SET" as const, metric: "K" as const, operator: "MAX_LIMIT" as const, value: .28, evidence: "K低于0.28", hard: true as const, confidence: .95 }];
  const query = { intent: "REFERENCE_LOOKUP" as const, queryMode: "NEW_QUERY" as const, confidence: .95, constraints, preferences: [], unresolved: [] };
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_QUERY", { relation: "NEW", effectRequest: null,
    pageQuery: query, reference: { scope: "NONE", revision: null, items: [] } }) }).mockImplementationOnce(async options => {
    expect(options.system).not.toContain('"solutionOperation"');
    expect(JSON.parse(options.prompt).validationFeedback.allowedEntityFields).toEqual(["systemHint", "applicationPart"]);
    const fields = { constraints: query.constraints, unresolved: query.unresolved, confidence: query.confidence };
    const corrected = [field("systemHint", "甲板"), field("applicationPart", "外墙"), ...constraints.slice(1, variant === "dropped-value" ? 2 : 3)];
    return { object: variant === "action" ? { intent: "SOLUTION_ACTION", requestedEffect: "STATE_MUTATION" }
      : { ...fields, constraints: variant === "dropped-name" ? corrected.slice(1) : variant === "identity-field"
        ? [{ ...corrected[0], field: "systemId" }, ...corrected.slice(1)] : variant === "extra-field"
          ? [...corrected, { ...corrected[0], field: "buildingType", entityText: "住宅" }] : corrected } };
  });
  const result = await resolveDomainTurn(ctx(message));
  if (variant === "complete") expect(result).toMatchObject({ mutation: "QUERY", semantic: { requestedEffect: "QUERY", relation: "NEW" } });
  else expect(result).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it.each(["authorized", "quoted", "negated", "delegation-note"])("动作复核%s只核验授权，不重建已验证的引用范围或代绑身份", async variant => {
  const message = "最终采用前面展示的这一套，并列出参数";
  const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  mocks.history.mockResolvedValue([{ content: "实际展示的做法", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["one"] } } }]);
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_DETAIL", {
    reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 3, items: [] }, relation: "CONTINUE" }) })
    .mockResolvedValueOnce({ object: { intent: "SOLUTION_ACTION", operation: "SET_FINAL", confidence: .96, evidence: message,
      scope: "CURRENT_SELECTED", readFields: ["kValue"], unresolved: variant === "delegation-note" ? "身份需要后端绑定" : null,
      effectRequest: { direct: true, polarity: variant === "negated" ? "NEGATED" : "AFFIRMATIVE",
        speechAct: variant === "quoted" ? "QUOTED" : "REQUEST", evidence: message } } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, user: { id: "u" }, taskState: { taskType: "GENERAL",
    lastReferenceLookup: { query: {}, candidates: [{ id: "one" }], candidateQueryRevision: 3, projectId: null, createdAt: new Date().toISOString() } } });
  if (variant === "authorized") expect(actual).toMatchObject({ intent: "SOLUTION_ACTION", mutation: "SOLUTION",
    semantic: { solutionOperation: "SET_FINAL", reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 3, items: [] } } });
  else expect(actual.mutation).toBe("NONE");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it.each(["CURRENT_CONSTRUCTION", "CURRENT_SEARCH", "UNRESOLVED", "WITHDRAWN"])("改厚度的对象范围%s不能由缺失字段隐式扩大", async basis => {
  const message = "如果改成32mm，效果怎么样", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  mocks.currentRows.mockResolvedValue(basis !== "WITHDRAWN");
  mocks.history.mockResolvedValue([{ content: "当前做法", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["actual-row"] } } }]);
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", effectRequest: null,
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, preferences: [], unresolved: [], constraints: [
      { type: "THICKNESS", field: null, operation: "SET", entityText: null, resolvedText: null, metric: null, operator: "EXACT", value: 32,
        evidence: "32mm", hard: true, confidence: .95 }] } }) }).mockResolvedValueOnce({ object: {
    basis: basis === "WITHDRAWN" ? "CURRENT_CONSTRUCTION" : basis, confidence: .95, evidence: message } });
  const result = await resolveDomainTurn({ ...ctx(message), conversation, user: { id: "u" }, taskState: { taskType: "GENERAL", lastReferenceLookup: {
    projectId: null, createdAt: new Date().toISOString(), candidateQueryRevision: 3,
    query: { substrateThickness: 180, filters: [{ metric: "K", targetValue: .28, mode: "MAX_LIMIT" }] },
    candidates: [{ id: "actual-row", systemId: "actual-system", schemeId: "actual-scheme", productSpecId: "actual-spec", thicknessMm: 22 }]
  } } });
  if (basis === "CURRENT_CONSTRUCTION") expect(result).toMatchObject({ mutation: "QUERY", queryBase: { schemeId: "actual-scheme", substrateThickness: 180 } });
  else if (basis === "CURRENT_SEARCH") { expect(result.mutation).toBe("QUERY");expect(result.queryBase).toBeUndefined(); }
  else expect(result).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
  expect(JSON.parse(mocks.generate.mock.calls[1]![0].prompt)).not.toHaveProperty("current.schemeId");
});
it("只读目标复核仍保留用户明确引用的编号，不把它扩大成全部当前候选", async () => {
  const message = "整理B2-4的参数给我看一下", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  const reference = { scope: "LAST_VISIBLE_CANDIDATES" as const, revision: 3,
    items: [{ type: "CONSTRUCTION_CODE" as const, value: "B2-4", evidence: "B2-4" }] };
  mocks.history.mockResolvedValue([{ content: "实际展示的构造", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 3, candidateIdList: ["one"] } } }]);
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "SOLUTION_ADVICE", { reference }) })
    .mockResolvedValueOnce({ object: { intent: "REFERENCE_DETAIL", operation: null, confidence: .96, evidence: message,
      scope: "CURRENT_SELECTED", readFields: ["kValue"], unresolved: null, effectRequest: null } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, user: { id: "u" }, taskState: { taskType: "GENERAL",
    lastReferenceLookup: { query: {}, candidates: [{ id: "one", schemeCode: "B2-4" }], candidateQueryRevision: 3, projectId: null, createdAt: new Date().toISOString() } } });
  expect(actual).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { reference, effectRequest: null } });
});
it("Domain查询也核对遗漏的资料范围，限定来源不允许变成全库查询", async () => {
  const message = "查看Excel的参考行", id = "11000000-0000-4000-8000-000000000001";
  mocks.dictionary.mockResolvedValue({ entities: [], aliases: [], sourceSets: [{ id, code: "published", name: "已发布参考表", source: "Excel", reference: "Sheet1" }] });
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_QUERY", { relation: "NEW", effectRequest: null,
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95, constraints: [], preferences: [], unresolved: [] } }) })
    .mockResolvedValueOnce({ object: { operation: "SET", confidence: .95, evidence: "Excel" } })
    .mockResolvedValueOnce({ object: { sourceReferenced: true, faithfulQuery: true, confidence: .95, evidence: "Excel", sourceLabels: ["已发布参考表"] } });
  expect(await resolveDomainTurn(ctx(message))).toMatchObject({ mutation: "QUERY", semantic: { pageQuery: { sourceScope: { ids: [id] } } } });
});
it("完整来源/查询复核达到原阈值后保持该结果，不因初始无scope或旧置信度再次丢失来源",async()=>{
 const message='读取Excel参考行',id='11000000-0000-4000-8000-000000000001';
 mocks.dictionary.mockResolvedValue({entities:[],aliases:[],sourceSets:[{id,code:'SOURCE-EXCEL',name:'已发布参考表',source:'客户表.xlsx',reference:'Sheet1'}]});
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,'REFERENCE_QUERY',{relation:'NEW',confidence:.86,effectRequest:null,
  pageQuery:{intent:'REFERENCE_LOOKUP',queryMode:'NEW_QUERY',confidence:.86,constraints:[],preferences:[],unresolved:[],sourceScope:null}})})
  .mockResolvedValueOnce({object:{operation:'KEEP',confidence:.95,evidence:null}})
  .mockResolvedValueOnce({object:{sourceReferenced:true,faithfulQuery:true,confidence:.94,evidence:'Excel',sourceLabels:['已发布参考表']}});
 const actual=await resolveDomainTurn(ctx(message));
 expect(actual).toMatchObject({intent:'REFERENCE_QUERY',mutation:'QUERY',policyReason:'READ_ONLY_QUERY',semantic:{confidence:.94,pageQuery:{confidence:.94,sourceScope:{ids:[id]}}}});
 expect(mocks.generate).toHaveBeenCalledTimes(3);
});
it.each(['authorized','readOnly'] as const)('首次候选读取/采用复核%s不要求预先存在正式方案，仍重验完整授权和引用',async variant=>{
 const message=variant==='authorized'?'先采用当前做法，也解释热阻口径':'先不采用当前做法，只解释热阻口径';
 const conversation={id:'c',userId:'u',clientApp:'c_app',projectId:null,scene:'general_chat'};
 mocks.active.mockReturnValue(null);
 mocks.history.mockResolvedValue([{content:'实际展示的参考做法',createdAt:new Date(),metadata:{queryScope:conversation,
  backendDecision:{domainIntent:'REFERENCE_VIEW',referenceRevision:3,candidateIdList:['one']}}}]);
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,'REFERENCE_VIEW',{confidence:.86,referenceReadFields:['productThermalResistance','totalThermalResistance'],
  reference:{scope:'LAST_VISIBLE_CANDIDATES',revision:3,items:[{type:'CURRENT_REFERENCE',evidence:'当前做法'}]},
  factRead:{mode:'DEFINE',metric:null,explanationAspect:'SCOPE',definitionSubjects:['PRODUCT_R','TOTAL_R'],historyClaim:false,evidence:'热阻口径'}})})
  .mockResolvedValueOnce({object:{intent:variant==='authorized'?'SOLUTION_ACTION':'READ_ONLY',operation:variant==='authorized'?'SELECT':null,confidence:.96,evidence:message,
   effectRequest:variant==='authorized'?{direct:true,polarity:'AFFIRMATIVE',speechAct:'REQUEST',evidence:message}:null}});
 const actual=await resolveDomainTurn({...ctx(message),conversation,user:{id:'u'},request:{},taskState:{taskType:'GENERAL',lastReferenceLookup:{query:{},candidates:[{id:'one'}],candidateQueryRevision:3,projectId:null,createdAt:new Date().toISOString()}}});
 expect(actual).toMatchObject({intent:variant==='authorized'?'SOLUTION_ACTION':'REFERENCE_DETAIL',mutation:variant==='authorized'?'SOLUTION':'NONE',semantic:{factRead:null}});
 expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it("已有方案只请求显示入口时可复核只读目标，不能因未授权聊天操作而丢上下文", async () => {
  const message = "请显示报告入口，我自己操作", context = { ...ctx(message), user: { id: "u" }, request: {} };
  context.conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  context.taskState.lastReferenceLookup = { query: {}, projectId: null, createdAt: new Date().toISOString(),
    candidateQueryRevision: 2, candidates: [{ id: "one" }] };
  mocks.history.mockResolvedValue([{ content: "已核验的候选", createdAt: new Date(), metadata: { queryScope: context.conversation,
    backendDecision: { domainIntent: "REFERENCE_VIEW", referenceRevision: 2, candidateIdList: ["one"] } } }]);
  mocks.active.mockReturnValue({ stage: "CONFIRMED", version: 2, confirmedSnapshotId: "snapshot", payload: { finalCandidateIds: ["one"], selectedCandidateIds: ["one"] } });
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "CLARIFY", { requestedEffect: "READ_ONLY", relation: "CONTINUE" }) })
    .mockResolvedValueOnce({ object: { intent: "REFERENCE_DETAIL", confidence: .95, evidence: message, scope: "CURRENT_SELECTED",
      operation: null, readFields: [], effectRequest: null, unresolved: null } });
  expect(await resolveDomainTurn(context)).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { requestedEffect: "READ_ONLY", effectRequest: null } });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it("封闭礼貌插话保留待澄清原问，且不调用模型或授予操作", async () => {
  const pending = { messageId: "root", message: "材料小于0.24", question: "什么指标？", inheritPrevious: false };
  mocks.clarification.mockResolvedValue(pending);
  expect(await resolveDomainTurn(ctx("谢谢"))).toMatchObject({ intent: "GENERAL", mutation: "NONE", pendingQuery: pending,
    semantic: { relation: "CONTINUE", requestedEffect: "READ_ONLY", effectRequest: null } });
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.runtime).not.toHaveBeenCalled();
});
it("上下文读取暂不可用时，礼貌回执也不变成查询或方案操作", async () => {
  mocks.clarification.mockRejectedValue(new Error("临时读取失败"));
  expect(await resolveDomainTurn(ctx("谢谢"))).toMatchObject({ intent: "GENERAL", mutation: "NONE" });
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("模型配置暂不可用也不删除已验证的原问，日志不泄露原话或错误正文", async () => {
  const pending = { messageId: "root", message: "材料小于0.24", question: "什么指标？", inheritPrevious: false };
  mocks.clarification.mockResolvedValue(pending);mocks.runtime.mockRejectedValue(new Error("私密响应正文"));
  const context = ctx("产品自身");
  expect(await resolveDomainTurn(context)).toMatchObject({ intent: "CLARIFY", mutation: "NONE", pendingQuery: pending,
    semantic: { relation: "CONTINUE", requestedEffect: "READ_ONLY" } });
  expect(JSON.stringify(context.app.log.warn.mock.calls)).not.toContain("私密响应正文");
});
it("新AI合同V2的R口径增量保留严格比较，完整校验后仍强制事实读取，不发布候选或授予方案操作", async () => {
  const message = "整个墙体的", original = "找保温小于0.27的材料";
  mocks.clarification.mockResolvedValue({ messageId: "root", message: `${original}\nR`, question: "哪个热阻口径？", inheritPrevious: false,
    need: { rootMessageId: "root", createdAt: new Date().toISOString(), goal: "MATERIALS", inheritPrevious: false, identityHints: [],
      turns: [{ messageId: "root", message: original }, { messageId: "scope", message: "R" }] } });
  mocks.generate.mockResolvedValue({ object: { reply: "SCOPE", metric: "TOTAL_R", originalConditionsCovered: true, confidence: .96, evidence: message } });
  const decision = await resolveDomainTurn(ctx(message));
  expect(decision).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY", queryResultMode: "FACTS_ONLY", queryContextMessageId: "root",
    semantic: { requestedEffect: "QUERY", effectRequest: null, pageQuery: { constraints: [{ metric: "TOTAL_R", value: .27, operator: "LT" }] } } });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});
it.each(["热阻", "R", "传热阻"])("待查条件只补%s时保留原数值，仅问口径，不依赖模型或执行查询", async message => {
  const pending = { messageId: "original", message: "查保温值低于6.2的材料", inheritPrevious: false };
  mocks.clarification.mockResolvedValue(pending);
  const actual = await resolveDomainTurn(ctx(message));
  expect(actual).toMatchObject({ intent: "CLARIFY", mutation: "NONE", parserSource: "FAST_PATH", pendingQuery: pending, policyReason: "RESISTANCE_SCOPE_REQUIRED" });
  expect(actual.unresolved?.[0]).toContain("6.2"); expect(actual.unresolved?.[0]).toContain("口径"); expect(mocks.generate).not.toHaveBeenCalled();
});
it("包含其他目标的热阻回复不能走单字段澄清快捷路径", async () => {
  const message = "热阻，先把第一项加入方案";
  mocks.clarification.mockResolvedValue({ messageId: "original", message: "保温值6.2", inheritPrevious: false });
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "GENERAL", { relation: "CONTINUE", reference: { scope: "NONE", revision: null, items: [] } }) });
  const actual = await resolveDomainTurn(ctx(message));
  expect(actual.policyReason).not.toBe("RESISTANCE_SCOPE_REQUIRED"); expect(mocks.generate).toHaveBeenCalled(); expect(actual.mutation).toBe("NONE");
});
it("当前集合比较附带重复查询基准时，不转成单行查询、不覆盖实际范围", async () => {
  const message = "把前面几种做法的参数并排展示";
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "COMPARE_CANDIDATES", { queryBasis: { scope: "CURRENT_REFERENCE", evidence: message },
    referenceReadFields: ["kValue", "layers", "notes"], referenceTime: "CURRENT" }) });
  const actual = await resolveDomainTurn(ctx(message));
  expect(actual).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE", semantic: { queryBasis: null,
    reference: { scope: "LAST_VISIBLE_CANDIDATES", items: [] }, referenceReadFields: ["kValue", "layers", "notes"] } });
  expect(actual.semantic?.pageQuery).toBeUndefined(); expect(mocks.generate).toHaveBeenCalledOnce();
});
it.each(["current", "switch", "expired", "other-owner", "cancelled"])("连续参考任务的NEW标签：%s不静默放宽范围，也不恢复已失效任务", async variant => {
  const message = "按前面范围再找一些做法", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  const proposal = domainSemanticFixture(message, "REFERENCE_QUERY", { relation: variant === "switch" ? "SWITCH_TOPIC" : "NEW",
    reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95,
      constraints: [], preferences: [], unresolved: [], readFields: ["kValue"] } });
  mocks.generate.mockResolvedValue({ object: proposal });
  mocks.history.mockResolvedValue([{ createdAt: new Date(), content: "上次外墙查询", metadata: { queryScope: conversation,
    backendDecision: { relation: variant === "cancelled" ? "CANCEL" : "NEW" } } }]);
  const input = { ...ctx(message), conversation, taskState: { taskType: "GENERAL", confirmedPageLookup: {
    query: { documentIds: ["automatically-bound-source"] }, requestQuery: { systemHint: "VICP", applicationPart: "EXTERNAL_WALL" },
    createdAt: new Date(Date.now() - (variant === "expired" ? 25 * 3600_000 : 1000)).toISOString(), conversationId: "c",
    userId: variant === "other-owner" ? "another" : "u", projectId: null, clientApp: "c_app"
  } } };
  if (variant === "current") expect(currentConfirmedPageLookup(input.taskState.confirmedPageLookup, conversation)).toBeDefined();
  const actual = await resolveDomainTurn(input);
  expect(actual.semantic?.relation, JSON.stringify(actual)).toBe(variant === "current" ? "REFINE" : variant === "switch" ? "SWITCH_TOPIC" : "NEW");
  expect(actual.semantic?.pageQuery?.queryMode).toBe(variant === "current" ? "REFINE_QUERY" : "NEW_QUERY");
  expect(proposal.relation).toBe(variant === "switch" ? "SWITCH_TOPIC" : "NEW");
});
it("并排比较允许使用真实读取字段，不把R口径请求当成重新筛选", async () => {
  const message = "两种做法放一起看热阻和传热系数，并说明热阻属于哪一层";
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "COMPARE_CANDIDATES", { relation: "CONTINUE",
    referenceReadFields: ["kValue", "productThermalResistance", "totalThermalResistance", "layers"],
    referenceTime: "CURRENT", reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] } }) });
  expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE", policyReason: "READ_ONLY_SEMANTIC" });
  expect(mocks.generate).toHaveBeenCalledOnce();
});
it("采用授权不足时仍能读取用户明确索要的参数，不能借读取执行选择", async () => {
  const message = "把刚才那套的参数整理给客户，选用的事稍后说";
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "SOLUTION_ADVICE", { referenceReadFields: null }) })
    .mockResolvedValueOnce({ object: { intent: "SOLUTION_ACTION", operation: "SELECT", confidence: .86, evidence: message,
      readFields: ["kValue", "totalThermalResistance", "productThermalResistance", "layers"], scope: "LAST_VISIBLE_CANDIDATES", unresolved: null,
      effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" },
    taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "one" }], candidateQueryRevision: 3,
      projectId: null, createdAt: new Date().toISOString() } } });
  expect(actual).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { requestedEffect: "READ_ONLY", solutionOperation: null,
    effectRequest: null, confidence: .86, referenceReadFields: ["kValue", "totalThermalResistance", "productThermalResistance", "layers"] } });
});
it("已正确解析的当前候选读取，不被目标复核误改成空的已选范围", async () => {
  const message = "把刚才那项的厚度和参数展示一下";
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_DETAIL", { referenceReadFields: ["kValue", "layers"] }) })
    .mockResolvedValueOnce({ object: { intent: "REFERENCE_DETAIL", operation: null, confidence: .95, evidence: message,
      readFields: ["kValue", "layers"], scope: "CURRENT_SELECTED", unresolved: null, effectRequest: null } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" },
    taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "one" }], candidateQueryRevision: 3,
      projectId: null, createdAt: new Date().toISOString() } } });
  expect(actual).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { reference: { scope: "LAST_VISIBLE_CANDIDATES" },
    referenceReadFields: ["kValue", "layers"] } });
});
it("产品优劣建议附带介绍改写标签时，保留建议目标与已验证产品范围", async () => {
  const message = "这种板和一般板材相比该怎么介绍优势", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  mocks.history.mockResolvedValue([{ id: "p", createdAt: new Date(), content: "已有产品介绍", metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "PRODUCT_DETAIL", productQueryDiagnostics: { reason: "CATALOG_MATCH", scope: {
      scope: "IDENTITY", entityText: "甲板", granularity: "PRODUCT", evidence: "之前的产品名" } } } } }]);
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "SOLUTION_ADVICE", { adviceFocus: "PROS_CONS", readGoal: "PRODUCTS",
    productContinuation: { action: "REPHRASE", field: null, match: null, evidence: message }, reference: { scope: "NONE", revision: null, items: [] } }) });
  expect(await resolveDomainTurn({ ...ctx(message), conversation, taskState: { taskType: "GENERAL" } })).toMatchObject({ intent: "SOLUTION_ADVICE",
    mutation: "NONE", semantic: { adviceFocus: "PROS_CONS", productContinuation: null }, productReadContext: { query: { entityText: "甲板" } } });
});
it("查询输出列不把重新检索改写成比较旧集合，完整最新条件继续执行", async () => {
  const message="按已经定好的条件重新检索，输出K列。", conversation={id:"c",userId:"u",projectId:null,clientApp:"c_app",scene:"general_chat"};
  const query={schemeCode:"WALL-X",queryContractVersion:2,filters:[{metric:"K",mode:"GT",targetValue:.31}]};
  mocks.generate.mockResolvedValue({object:domainSemanticFixture(message,"REFERENCE_REFINE",{relation:"CONTINUE",readGoal:"SCHEMES",referenceReadFields:null,
    reference:{scope:"LAST_VISIBLE_CANDIDATES",revision:1,items:[]},pageQuery:{intent:"REFERENCE_LOOKUP",queryMode:"REFINE_QUERY",confidence:.95,
      constraints:[],preferences:[],unresolved:[],readFields:["kValue"]}})});
  const context={...ctx(message),conversation,user:{id:"u"},taskState:{taskType:"GENERAL",
    lastReferenceLookup:{query:{filters:[{metric:"K",mode:"MAX_LIMIT",targetValue:.31}]},candidates:[{id:"old",kValue:.31}],candidateQueryRevision:1},
    confirmedPageLookup:{query,requestQuery:query,conversationId:"c",userId:"u",projectId:null,clientApp:"c_app",createdAt:new Date().toISOString()}}};
  expect(await resolveDomainTurn(context)).toMatchObject({intent:"REFERENCE_REFINE",mutation:"QUERY",queryContractVersion:2,
    semantic:{requestedEffect:"QUERY",pageQuery:{queryMode:"REFINE_QUERY",readFields:["kValue"]}}});
});
it.each(["projection", "unspecified-time", "new-filter", "new-thickness"])("当前集合读取投影：%s不会因合同重复而丢目标，也不能掩盖新条件", async variant => {
  const message = variant === "new-filter" ? "只看K小于0.4的" : variant === "new-thickness" ? "换成46mm再列出热阻" : "把前面两种做法的热阻和传热系数并排给我";
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", effectRequest: null,
    referenceTime: variant === "unspecified-time" ? null : "CURRENT", referenceReadFields: ["kValue", "totalThermalResistance", "layers"],
    queryBasis: { scope: "CURRENT_REFERENCE", evidence: message }, reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .88, constraints: [], preferences: [], unresolved: [],
      readFields: ["kValue", "totalThermalResistance", "layers"] } }) });
  const actual = await resolveDomainTurn(ctx(message));
  expect(actual).toMatchObject(variant === "projection" || variant === "unspecified-time" ? { intent: "COMPARE_CANDIDATES", mutation: "NONE", semantic: { pageQuery: null,
    queryBasis: null, referenceReadFields: ["kValue", "totalThermalResistance", "layers"] } }
    : { intent: "CLARIFY", mutation: "NONE", policyReason: "PAGE_QUERY_CONSTRAINTS_INVALID" });
});
it.each(["continue", "switch", "expired"])("产品咨询转参考做法：%s保留有效产品名称范围，明确换话题与过期上下文不恢复", async variant => {
  const message = "查传热系数低于0.4的参考做法", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  mocks.history.mockResolvedValue([{ id: "actual-product-turn", createdAt: new Date(Date.now() - (variant === "expired" ? 25 * 3600_000 : 1000)), content: "已核验产品参数", metadata: {
    queryScope: conversation, backendDecision: { domainIntent: "PRODUCT_DETAIL", relation: "CONTINUE", productQueryDiagnostics: {
      reason: "CATALOG_MATCH", scope: { scope: "IDENTITY", entityText: "已有产品名称", granularity: "PRODUCT", evidence: "前面的真实产品问题" } } } } }]);
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_QUERY", { relation: variant === "switch" ? "SWITCH_TOPIC" : "NEW", effectRequest: null,
    reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .95,
      constraints: [{ type: "METRIC", metric: "K", operation: "SET", operator: "MAX_LIMIT", value: .4, evidence: "传热系数低于0.4", hard: true,
        confidence: .95, field: null, entityText: null, resolvedText: null }], preferences: [], unresolved: [], readFields: ["kValue"] } }) });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, taskState: { taskType: "GENERAL" } });
  expect(actual.intent).toBe("REFERENCE_QUERY");
  expect(actual.queryBase).toEqual(variant === "continue" ? { systemHint: "已有产品名称" } : undefined);
  expect(actual.semantic?.relation).toBe(variant === "continue" ? "REFINE" : variant === "switch" ? "SWITCH_TOPIC" : "NEW");
});
it("历史产品名称复制到本轮查询时，先复核读取目标；任务继承归一不能抢先阻断参数续问", async () => {
  const message = "这种板有什么厚度可参考", conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  mocks.history.mockResolvedValue([{ id: "p", createdAt: new Date(), content: "已核验产品名称", metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "PRODUCT_DETAIL", productQueryDiagnostics: { reason: "CATALOG_MATCH", scope: {
      scope: "IDENTITY", entityText: "甲板", granularity: "PRODUCT", evidence: "前一轮的问题" } } } } }]);
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REFERENCE_QUERY", { relation: "NEW", effectRequest: null,
    readGoal: "SCHEMES", reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .82,
      constraints: [{ type: "ENTITY", operation: "SET", field: "systemHint", entityText: "甲板", resolvedText: null, metric: null, value: null,
        operator: null, confidence: .8, hard: true, evidence: "甲板" }], preferences: [], unresolved: [] } }) })
    .mockResolvedValueOnce({ object: { action: "PARAMETERS", field: "THICKNESS", confidence: .95, evidence: message } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, taskState: { taskType: "GENERAL" } });
  expect(actual).toMatchObject({ intent: "PRODUCT_DETAIL", mutation: "NONE", semantic: { pageQuery: null, requestedEffect: "READ_ONLY",
    productQuery: { entityText: "甲板" }, productContinuation: { action: "PARAMETERS", field: "THICKNESS" } } });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it("模型以REFINE加极值表达当前集合只读目标时，一次归一后完整Policy通过，不发新查询", async () => {
  const message = "把当前几项的K列出来并找出最小值";
  const proposal = domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", referenceTime: "CURRENT", effectRequest: null,
    reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] }, comparison: { metric: "K", direction: "MIN", evidence: message },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, constraints: [], preferences: [], unresolved: [], readFields: ["kValue"] } });
  mocks.generate.mockResolvedValueOnce({ object: proposal });
  const input = ctx(message), before = structuredClone(input.taskState);
  const actual = await resolveDomainTurn(input);
  expect(actual).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE", semantic: { requestedEffect: "READ_ONLY", pageQuery: null,
    comparison: { metric: "K", direction: "MIN", evidence: message } } });
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(actual.requiresCandidateQuery).not.toBe(true);
  expect(input.taskState).toEqual(before);
  expect(proposal.intent).toBe("REFERENCE_REFINE");
});
it.each(["只要K小于0.4的，哪个K最低", "换成60mm再比较哪个K最低"])("%s：模型漏掉本轮新条件时不能清除查询绕过覆盖校验", async message => {
  const proposal = domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", referenceTime: "CURRENT", effectRequest: null,
    reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] }, comparison: { metric: "K", direction: "MIN", evidence: message },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, constraints: [], preferences: [], unresolved: [], readFields: ["kValue"] } });
  mocks.generate.mockResolvedValue({ object: proposal });
  const input = ctx(message), before = structuredClone(input.taskState);
  const actual = await resolveDomainTurn(input);
  expect(actual).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "PAGE_QUERY_CONSTRAINTS_INVALID" });
  expect(actual.semantic?.pageQuery).toEqual(proposal.pageQuery);
  expect(input.taskState).toEqual(before);
});
it("标准连续追问漏依据读取字段时只复核一次，不能直接自由解释", async () => {
 const message="刚才的条文和实施日期是什么",conversation={id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat"};
 mocks.history.mockResolvedValue([{id:"a",createdAt:new Date(),content:"没有正式标准依据。",metadata:{queryScope:conversation,
  backendDecision:{domainIntent:"COMPLIANCE_CHECK",compliance:{status:"UNAVAILABLE"}}}}]);
 const proposal=domainSemanticFixture(message,"KNOWLEDGE_EXPLAIN",{reference:{scope:"NONE",revision:null,items:[]}});
 mocks.generate.mockResolvedValueOnce({object:proposal}).mockResolvedValueOnce({object:{...proposal,complianceExplanation:{evidence:message}}});
 const actual=await resolveDomainTurn({...ctx(message),conversation});
 expect(actual).toMatchObject({intent:"KNOWLEDGE_EXPLAIN",mutation:"NONE",semantic:{complianceExplanation:{evidence:message}}});
 expect(mocks.generate).toHaveBeenCalledTimes(2);expect(new Set(mocks.generate.mock.calls.map(c=>c[0].abortSignal)).size).toBe(1);
 expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt).currentCompliance.compliance.status).toBe("UNAVAILABLE");
});
it("核验后换到一般概念不强行继承标准上下文", async () => {
 const message="换个话题，解释一下建筑保温",conversation={id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat"};
 mocks.history.mockResolvedValue([{id:"a",createdAt:new Date(),content:"没有正式标准依据。",metadata:{queryScope:conversation,
  backendDecision:{domainIntent:"COMPLIANCE_CHECK",compliance:{status:"UNAVAILABLE"}}}}]);
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,"KNOWLEDGE_EXPLAIN",{relation:"SWITCH_TOPIC",reference:{scope:"NONE",revision:null,items:[]}})});
 expect(await resolveDomainTurn({...ctx(message),conversation})).toMatchObject({intent:"KNOWLEDGE_EXPLAIN",mutation:"NONE"});
 expect(mocks.generate).toHaveBeenCalledTimes(1);
});
it.each(["选用较薄的那个，先别确认", "把当前这套加入选择", "使用第二套作为最终方案，暂不出报告"])("宽合同误作计算且上下文拒绝时，%s经窄目标核验再重走动作Policy", async message => {
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,"THERMAL_CALCULATE",{queryContext:"CLARIFICATION_REPLY",
  effectRequest:{direct:true,polarity:"AFFIRMATIVE",speechAct:"REQUEST",evidence:message}})})
  .mockResolvedValueOnce({object:{operation:"SELECT_SOLUTION",confidence:.96,evidence:message}})
  .mockResolvedValueOnce({object:{intent:"SOLUTION_ACTION",confidence:.96,evidence:message,scope:"LAST_VISIBLE_CANDIDATES",unresolved:null,
   effectRequest:{direct:true,polarity:"AFFIRMATIVE",speechAct:"REQUEST",evidence:message}}});
 const actual=await resolveDomainTurn(ctx(message));
 expect(actual).toMatchObject({intent:"SOLUTION_ACTION",semantic:{queryContext:"CURRENT_TURN",reference:{items:[]}}});
 expect(actual.semantic?.calculationRequest ?? null).toBeNull();
 expect(mocks.generate).toHaveBeenCalledTimes(3);
 expect(new Set(mocks.generate.mock.calls.map(c=>c[0].abortSignal)).size).toBe(1);
});
it.each(["NEGATED","QUOTED","HYPOTHETICAL","LOW_CONFIDENCE"])("纯操作复核只提供修正方向，%s仍不得进入动作",async failure=>{
 const message="讨论选择方案的请求，暂不执行";
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,"THERMAL_CALCULATE",{queryContext:"CLARIFICATION_REPLY",
  effectRequest:{direct:true,polarity:"AFFIRMATIVE",speechAct:"REQUEST",evidence:message}})})
  .mockResolvedValueOnce({object:{operation:"SELECT_SOLUTION",confidence:.96,evidence:message}})
  .mockResolvedValueOnce({object:{intent:"SOLUTION_ACTION",confidence:failure==="LOW_CONFIDENCE"?.89:.96,evidence:message,scope:"LAST_VISIBLE_CANDIDATES",unresolved:null,
   effectRequest:{direct:true,polarity:failure==="NEGATED"?"NEGATED":"AFFIRMATIVE",speechAct:failure==="QUOTED"?"QUOTED":failure==="HYPOTHETICAL"?"HYPOTHETICAL":"REQUEST",evidence:message}}});
 expect(await resolveDomainTurn(ctx(message))).toMatchObject({intent:"CLARIFY",mutation:"NONE"});
 expect(mocks.generate).toHaveBeenCalledTimes(3);
});
it.each(["PARAMETER_QUERY","PRODUCT_CONTINUATION"])("实际产品反查的%s数字修改不被错接到独立参数历史，仍重验同归属上下文",async variant=>{
 const message="数值调整为0.026",conversation={id:"c",userId:"u",projectId:null,clientApp:"c_app",scene:"general_chat"};
 const scope={scope:"CATALOG",entityText:null,granularity:"CATALOG",evidence:"找其他板材"};
 mocks.history.mockResolvedValue([{id:"a",createdAt:new Date(),content:"甲板的导热系数与其他原表记录。",metadata:{queryScope:conversation,backendDecision:{domainIntent:"PRODUCT_DISCOVERY",
  productQueryDiagnostics:{scope,parameterFilter:{field:"LAMBDA",operator:"LT",targetValue:.017,unit:"W/(m·K)",scope:"MATERIAL_LAYER",referenceName:"甲板"}},
  productParameterFocus:[{field:"LAMBDA",value:.017,unit:"W/(m·K)",scope:"MATERIAL_LAYER",entityId:"k",entityName:"甲板",sourceKey:"source"}]}}}]);
 mocks.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,"PRODUCT_PARAMETER_QUERY",{relation:"REFINE",requestedEffect:"READ_ONLY",queryContext:"CURRENT_TURN",
  ...(variant==="PARAMETER_QUERY" ? {parameterQuery:{parameter:"LAMBDA",subjectType:"ANY",subjectText:null,systemText:null,operator:"EXACT",targetValue:.026,tolerance:null,unit:"W/(m·K)",evidence:message}} :
   {parameterQuery:null,productContinuation:{action:"FIND_OTHERS",field:"LAMBDA",match:"LT",evidence:message}}),reference:{scope:"NONE",revision:null,items:[]}})});
 const c={...ctx(message),conversation},actual=await resolveDomainTurn(c);
 expect(actual,JSON.stringify({actual,warnings:c.app.log.warn.mock.calls})).toMatchObject({intent:"PRODUCT_DISCOVERY",mutation:"NONE",productContextMessageId:"a",
  semantic:{productContinuation:{action:"FIND_OTHERS",match:"LT"},parameterQuery:null}});
 expect(mocks.generate).toHaveBeenCalledTimes(1);
});
it.each(["REPHRASE", "EXPLAIN_PARAMETER"] as const)("产品只读%s经独立目标复核后仍由当前上下文绑定身份", async action => {
  const message = action === "REPHRASE" ? "说明简短些" : "导热能力指什么";
  const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
  const query = { scope: "IDENTITY" as const, entityText: "甲板", granularity: "PRODUCT" as const, evidence: "甲板" };
  mocks.history.mockResolvedValue([{ id: "previous", createdAt: new Date(), content: "甲板可查参数。",
    metadata: { queryScope: conversation, backendDecision: { domainIntent: "PRODUCT_DISCOVERY", productQueryDiagnostics: { scope: query }, productParameterFocus: [] } } }]);
  const semantic = domainSemanticFixture(message, action === "REPHRASE" ? "PRODUCT_DETAIL" : "KNOWLEDGE_EXPLAIN", {
    relation: "CONTINUE", requestedEffect: "READ_ONLY", audience: "GENERAL", reference: { scope: "NONE", revision: null, items: [] },
    ...(action === "REPHRASE" ? { productQuery: { ...query, evidence: message }, productContinuation: { action: "EXPLAIN_PARAMETER", field: null, match: null, evidence: message } }
      : { factRead: { mode: "DEFINE", metric: null, historyClaim: false, evidence: message } })
  });
  mocks.generate.mockResolvedValueOnce({ object: semantic }).mockResolvedValueOnce({ object: {
    action, field: action === "EXPLAIN_PARAMETER" ? "LAMBDA" : null, confidence: .95, evidence: message
  } });
  expect(await resolveDomainTurn({ ...ctx(message), conversation })).toMatchObject({ intent: "PRODUCT_DETAIL", mutation: "NONE",
    productContextMessageId: "previous", semantic: { productQuery: { entityText: "甲板" }, productContinuation: { action }, factRead: null } });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

describe("开放目标受控分类与故障隔离", () => {
  it("计算证据被截断时仅复核完整操作授权，原计算输入不被窄合同补写", async () => {
    const message = "请计算这个已发布构造，芯材11mm，先不判断达标";
    const calculationRequest = { schemeId: null, productSpecId: null, targetLayerId: null, mode: "LAYERED" as const,
      thicknessMm: 11, evidence: message, thicknessEvidence: "芯材11mm" };
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "THERMAL_CALCULATE", {
      calculationRequest, effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: "请计算这个已发布构造" }
    }) }).mockResolvedValueOnce({ object: { intent: "THERMAL_CALCULATE", confidence: .96, evidence: message, unresolved: null,
      effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } }
    }).mockResolvedValueOnce({ object: { operation: "CALCULATE", confidence: .96, evidence: message } });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "THERMAL_CALCULATE", semantic: { calculationRequest } });
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(new Set(mocks.generate.mock.calls.map(call => call[0].abortSignal)).size).toBe(1);
    expect(mocks.generate.mock.calls[1]![0].system).toContain("完整本轮原话");
  });
  it.each(["partial", "negated", "quoted", "hypothetical", "indirect", "lowConfidence"])("计算复核%s仍不授予执行权限", async failure => {
    const message = "不要实际计算，只讨论计算请求的授权";
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "THERMAL_CALCULATE", {
      effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: "计算请求" }
    }) });
    const goal: any = { intent: "THERMAL_CALCULATE", confidence: .96, evidence: message, unresolved: null,
      effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } };
    if (failure === "partial") goal.effectRequest.evidence = "计算请求";
    if (failure === "negated") goal.effectRequest.polarity = "NEGATED";
    if (failure === "quoted") goal.effectRequest.speechAct = "QUOTED";
    if (failure === "hypothetical") goal.effectRequest.speechAct = "HYPOTHETICAL";
    if (failure === "indirect") goal.effectRequest.direct = false;
    if (failure === "lowConfidence") goal.confidence = .89;
    mocks.generate.mockResolvedValueOnce({ object: goal });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "EFFECT_NOT_AUTHORIZED" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it("参数名称窄合同只修正名称角色，目标值/比较符仍由原话校核", async () => {
    const message = "节能材料导热系数λ等于0.31有哪些";
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "PRODUCT_PARAMETER_QUERY", { reference: { scope: "NONE", revision: null, items: [] },
      parameterQuery: { parameter: "LAMBDA", subjectType: "ANY", subjectText: "节能", systemText: null, targetValue: .31, operator: "EXACT", tolerance: null, unit: "W/(m·K)", evidence: message } }) })
      .mockResolvedValueOnce({ object: { subjectText: null, systemText: null, confidence: .96, evidence: message } });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "PRODUCT_PARAMETER_QUERY", semantic: { parameterQuery: { subjectText: null, targetValue: .31, operator: "EXACT" } } });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it("宽目标合同错误填入候选身份后，窄目标复核仍须完整原话授权；不采用首次伪造引用", async () => {
    const message = "选择较薄的方案，先不要确认";
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "SOLUTION_ACTION", {
      requestedEffect: "STATE_MUTATION", confidence: .95, reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null,
        items: [{ type: "POSITION", value: 1, evidence: "较薄的方案" }] }, effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message }
    }) }).mockImplementationOnce(async options => {
      expect(options.output).toBe("no-schema"); expect(options).not.toHaveProperty("schema");
      expect(options.system).toContain("effectRequest.evidence必须逐字保留完整本轮原话");
      return { object: { intent: "SOLUTION_ACTION", confidence: .95, evidence: message, scope: "LAST_VISIBLE_CANDIDATES", unresolved: null,
        effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } } };
    });
    const decision = await resolveDomainTurn(ctx(message));
    expect(decision).toMatchObject({ intent: "SOLUTION_ACTION", semantic: { reference: { items: [] } } });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[0]![0].abortSignal).toBe(mocks.generate.mock.calls[1]![0].abortSignal);
  });
  it("方案窄复核仍只给局部肯定片段时，完整原话门禁继续拒绝", async () => {
    const message = "暂不确认，选较薄的方案并保留另一套作对照";
    const effectRequest = { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: "选较薄的方案" };
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "SOLUTION_ACTION", { effectRequest: effectRequest as any }) })
      .mockResolvedValueOnce({ object: { intent: "SOLUTION_ACTION", confidence: .96, evidence: message, unresolved: null,
        scope: "LAST_VISIBLE_CANDIDATES", effectRequest } });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "EFFECT_NOT_AUTHORIZED" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it("是的确认上一轮唯一产品建议时不进入泛化澄清", async () => {
    const message = "是的", context = ctx(message);
    context.conversation = { ...context.conversation, id: "c", userId: "u", projectId: null, clientApp: "c_app" };
    mocks.history.mockResolvedValue([{ id: "a", createdAt: new Date(), content: "你是不是想了解 VICP（VICP复合保温板）？确认一下名称，我就接着介绍。",
      metadata: { queryScope: context.conversation, backendDecision: { domainIntent: "PRODUCT_DISCOVERY", productQueryDiagnostics: {
        scope: { scope: "IDENTITY", entityText: "VLCP", granularity: "PRODUCT", evidence: "VLCP" },
        reason: "NAME_UNRESOLVED", suggestions: [{ name: "VICP复合保温板", matchedName: "VICP" }]
      } } } }]);
    mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "CLARIFY", { queryContext: "CLARIFICATION_REPLY", relation: "CONTINUE",
      requestedEffect: "READ_ONLY", reference: { scope: "NONE", revision: null, items: [] } }) });
    expect(await resolveDomainTurn(context)).toMatchObject({ intent: "PRODUCT_DISCOVERY", requestedEffect: "READ_ONLY", policyReason: "PRODUCT_IDENTITY_CONFIRMED" });
  });
  it("产品表达续问的历史目标由服务器提供，Policy核验后才绑定读取记录", async () => {
    const message = "我不是工程师，简单说就行。", context = ctx(message);
    context.conversation = { ...context.conversation, id: "c", userId: "u", projectId: null, clientApp: "c_app" };
    const productQuery = { scope: "IDENTITY" as const, entityText: "VICP", granularity: "SERIES" as const, evidence: "介绍VICP" };
    mocks.history.mockResolvedValue([{ id: "previous", createdAt: new Date(), content: "上轮产品读取未命中", metadata: { queryScope: context.conversation,
      backendDecision: { domainIntent: "PRODUCT_DISCOVERY", productQueryDiagnostics: { scope: productQuery } } } }]);
    mocks.generate.mockImplementation(async options => {
      expect(JSON.parse(options.prompt).previousProductQuery.query.entityText).toBe("VICP");
      return { object: domainSemanticFixture(message, "PRODUCT_DISCOVERY", { productQuery: { ...productQuery, evidence: message }, audience: "GENERAL", reference: { scope: "NONE", revision: null, items: [] } }) };
    });
    expect(await resolveDomainTurn(context)).toMatchObject({ intent: "PRODUCT_DISCOVERY", mutation: "NONE", productContextMessageId: "previous" });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("正式编码身份不确定交后端字典核验后仅复核一次；原低置信不直接放行", async () => {
    const message = "查询已发布的VICP-OVERALL和VICP-LAYERED参考行，分别保留输入条件及来源。";
    const constraints = ["VICP-OVERALL", "VICP-LAYERED"].map((name, i) => ({ type: "ENTITY" as const, operation: i ? "APPEND" as const : "SET" as const,
      field: "schemeCode" as const, entityText: name, resolvedText: null, metric: null, operator: null, value: null, evidence: name, hard: true as const, confidence: .62 }));
    const low = domainSemanticFixture(message, "REFERENCE_QUERY", { confidence: .62, unresolved: "是否已发布需核验", relation: "NEW",
      reference: { scope: "NONE", revision: null, items: [] }, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .62, constraints, preferences: [], unresolved: [] } });
    const corrected = { ...low, confidence: .95, unresolved: null, pageQuery: { ...low.pageQuery!, confidence: .95, constraints: constraints.map(c => ({ ...c, confidence: .95 })) } };
    mocks.dictionary.mockResolvedValue({ aliases: [], entities: constraints.map((c, i) => ({ field: "schemeId", value: `s-${i}`, names: [c.entityText] })) });
    mocks.generate.mockResolvedValueOnce({ object: low }).mockImplementationOnce(async options => {
      expect(JSON.parse(options.prompt).publishedIdentityHints).toEqual(constraints.map(c => ({ field: "schemeCode", text: c.entityText })));
      return { object: corrected };
    });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY", policyReason: "READ_ONLY_QUERY" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[0]![0].abortSignal).toBe(mocks.generate.mock.calls[1]![0].abortSignal);
  });
  it("只读进程观察器跨Fastify封装取结构化提案，解除后不再记录", async () => {
    const server={},root={server},context=ctx("查看原页");context.app.server=server;
    const observer=vi.fn(),stop=observeDomainSemantic(root,observer);
    mocks.generate.mockResolvedValue({object:domainSemanticFixture("查看原页","REFERENCE_VIEW")});
    await resolveDomainTurn(context);expect(observer).toHaveBeenCalledWith(expect.objectContaining({attempt:1,proposal:expect.objectContaining({intent:"REFERENCE_VIEW"})}));
    stop();await resolveDomainTurn(context);expect(observer).toHaveBeenCalledTimes(1);
  });
  it("明确工程字段遇模型只读歧义，仅复核一次，不绕过Policy或提高置信度", async () => {
    const message = "保温薄抹灰0.3传热系数方案";
    const proposal = domainSemanticFixture(message, "CLARIFY", { unresolved: "指标不明确", relation: "NEW", reference: { scope: "NONE", revision: null, items: [] } });
    mocks.generate.mockResolvedValue({ object: proposal });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "CLARIFY", policyReason: "SEMANTIC_AMBIGUOUS" });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[0]![0].abortSignal).toBe(mocks.generate.mock.calls[1]![0].abortSignal);
  });
  it("副作用歧义不因出现K字段获得复核或授权", async () => {
    const message = "确认K0.3方案";
    mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "SOLUTION_ACTION", { unresolved: "身份不明" }) });
    expect((await resolveDomainTurn(ctx(message))).mutation).toBe("NONE");
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("仅结构验证失败在同一预算内重提案；仍经Policy，不提升权限", async () => {
    const message = "查看这个原页";
    const valid = domainSemanticFixture(message, "REFERENCE_VIEW");
    mocks.generate.mockResolvedValueOnce({ object: { ...valid, evidence: "不在原话中" } }).mockResolvedValueOnce({ object: {
      intent: valid.intent, evidence: valid.evidence, confidence: valid.confidence, unresolved: null, reference: valid.reference, comparison: null
    } });
    expect((await resolveDomainTurn(ctx(message))).intent).toBe("REFERENCE_VIEW");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const requests = mocks.generate.mock.calls.map(call => call[0]);
    expect(requests[0].abortSignal).toBe(requests[1].abortSignal);
    expect(requests[1].prompt).toContain("EVIDENCE_INVALID");
    expect(requests[1].system).toContain("普通并排或条件比较必须null");
  });
  it("查询澄清上下文不能授权动作；独立操作复核须重新核验本轮完整直接请求", async () => {
    const message = "选较薄的候选，保留另一个用于比较";
    mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "SOLUTION_ACTION", { queryContext: "CLARIFICATION_REPLY" }) })
      .mockResolvedValueOnce({ object: { intent: "SOLUTION_ACTION", confidence: .96, evidence: message, scope: "LAST_VISIBLE_CANDIDATES", unresolved: null,
        effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } } });
    expect(await resolveDomainTurn(ctx(message))).toMatchObject({ intent: "SOLUTION_ACTION", semantic: { queryContext: "CURRENT_TURN", reference: { items: [] } } });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
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

it.each(["current", "new-thickness", "missing-read-goal", "invalid-reference"])("带当前对象引用的空查询投影：%s保留独立读取和条件覆盖门禁", async variant => {
  const message = variant === "new-thickness" ? "33mm那条的层次，另改为47mm" : "33mm那条的层次";
  mocks.generate.mockResolvedValue({ object: domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", effectRequest: null,
    referenceTime: "CURRENT", referenceReadFields: variant === "missing-read-goal" ? null : ["layers"],
    queryBasis: { scope: "CURRENT_REFERENCE", evidence: message }, reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null,
      items: [{ type: "THICKNESS", value: variant === "invalid-reference" ? 34 : 33, evidence: "33mm" }] },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .94, constraints: [], preferences: [], unresolved: [], readFields: ["layers"] } }) });
  const actual = await resolveDomainTurn(ctx(message));
  if (variant === "current") expect(actual).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { pageQuery: null,
    queryBasis: null, referenceReadFields: ["layers"], reference: { items: [{ type: "THICKNESS", value: 33 }] } } });
  else { expect(actual.intent).toBe("CLARIFY"); expect(actual.mutation).toBe("NONE"); }
});

import { reviewSolutionGoal } from "./solution-goal-semantic.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
it.each(["select", "read-only", "low-confidence"])("动作目标复核接收真实集合语境：%s不补身份、不抬置信度", async variant => {
  const message = "采用已有做法，并解释参数", readonly = variant === "read-only", confidence = variant === "low-confidence" ? .86 : .96;
  mocks.generate.mockResolvedValue({ object: { intent: readonly ? "REFERENCE_DETAIL" : "SOLUTION_ACTION", operation: readonly ? null : "SELECT", confidence,
    evidence: message, readFields: ["kValue"], effectRequest: readonly ? null : { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message },
    scope: "LAST_VISIBLE_CANDIDATES", unresolved: null } });
  const context = { visibleCandidateCount: 1, focusedCandidateCount: 1, selectedCandidateCount: 0, hasReadOnlyExcludedRecords: true };
  const result = await reviewSolutionGoal({} as any, message, new AbortController().signal, context);
  expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt).candidateContext).toEqual(context);
  expect(result.object.confidence).toBe(confidence);expect(result.object.reference.items).toEqual([]);
  if (variant === "low-confidence") expect(applyDomainPolicy(message, result.object).policyReason).toBe("EFFECT_NOT_AUTHORIZED");
  if (readonly) expect(result.object).toMatchObject({ intent: "REFERENCE_DETAIL", requestedEffect: "READ_ONLY", effectRequest: null });
});

it("操作复核不重新承担读取分类，保留已验证字段且不更改动作置信度", async () => {
  const message = "采用这套并核对热阻";
  mocks.generate.mockResolvedValue({ object: { intent: "SOLUTION_ACTION", operation: "SELECT", confidence: .9, evidence: message,
    readFields: null, effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message }, scope: "LAST_VISIBLE_CANDIDATES", unresolved: null } });
  const result = await reviewSolutionGoal({} as any, message, new AbortController().signal, undefined, ["productThermalResistance", "totalThermalResistance"]);
  expect(result.object.confidence).toBe(.9);expect(result.object.referenceReadFields).toEqual(["productThermalResistance", "totalThermalResistance"]);
  expect(result.object.reference.items).toEqual([]);expect(result.object.effectRequest?.evidence).toBe(message);
});

it.each(["select", "unclear"])("当前知识解释中的复合操作目标：%s独立核验授权，不能被解释目标吞掉", async variant => {
  const message = "采用刚才的方案，解释热阻", conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app", scene: "general_chat" };
  mocks.history.mockResolvedValue([{ id: "previous", content: "已显示的参考参数", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "REFERENCE_DETAIL", relation: "CONTINUE", referenceRevision: 5, candidateIdList: ["one"] } } }]);
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { relation: "CONTINUE", requestedEffect: "READ_ONLY",
    reference: { scope: "NONE", revision: null, items: [] }, factRead: { mode: "DEFINE", metric: null, historyClaim: false,
      evidence: "解释热阻", explanationAspect: "SCOPE", definitionSubjects: ["R"] } }) }).mockResolvedValueOnce({ object: {
    intent: variant === "select" ? "SOLUTION_ACTION" : "CLARIFY", operation: variant === "select" ? "SELECT" : null,
    confidence: variant === "select" ? .94 : .35, evidence: message, readFields: null, scope: "LAST_VISIBLE_CANDIDATES", unresolved: null,
    effectRequest: variant === "select" ? { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } : null } });
  const actual = await resolveDomainTurn({ ...ctx(message), conversation, taskState: { taskType: "GENERAL", lastReferenceLookup: {
    query: {}, candidates: [{ id: "one", thicknessMm: 25 }], candidateQueryRevision: 5, projectId: null, createdAt: new Date().toISOString() } } });
  if (variant === "select") expect(actual).toMatchObject({ intent: "SOLUTION_ACTION", mutation: "SOLUTION", semantic: { solutionOperation: "SELECT", confidence: .94 } });
  else { expect(actual).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "OPERATION_SCOPE_UNCLEAR" });expect(actual.unresolved?.join()).toContain("加入方案"); }
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it.each(["select", "low-confidence", "read-only"])("操作最小合同%s不让模型重建读取和范围，安全门禁保持", async variant => {
  const message = "采用当前方案并说明参数", readonly = variant === "read-only", confidence = variant === "low-confidence" ? .86 : .9;
  mocks.generate.mockResolvedValue({ object: { intent: readonly ? "READ_ONLY" : "SOLUTION_ACTION", operation: readonly ? null : "SELECT", confidence,
    evidence: message, effectRequest: readonly ? null : { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message } } });
  const result = await reviewSolutionGoal({} as any, message, new AbortController().signal, undefined, ["kValue"], "CURRENT_SELECTED");
  expect(result.object.reference).toEqual({ scope: "CURRENT_SELECTED", revision: null, items: [] });expect(result.object.referenceReadFields).toEqual(["kValue"]);
  expect(result.object.confidence).toBe(confidence);
  if (variant === "low-confidence") expect(applyDomainPolicy(message, result.object).policyReason).toBe("EFFECT_NOT_AUTHORIZED");
  if (readonly) expect(result.object).toMatchObject({ intent: "REFERENCE_DETAIL", requestedEffect: "READ_ONLY", effectRequest: null });
  const schema = mocks.generate.mock.calls[0]![0].system;
  expect(schema).not.toContain('"readFields":');expect(schema).not.toContain('"scope":');
});

it.each(["PREPARE", "EXECUTE", "UNCLEAR"] as const)("报告提案%s须独立复核完整操作方式，不能因已确认而自动生成", async operation => {
  const message = "核对报告的操作安排";
  mocks.active.mockResolvedValue({ stage: "CONFIRMED", confirmedSnapshotId: "snapshot", version: 4,
    payload: { selectedCandidateIds: ["one"], finalCandidateIds: ["one"] } });
  mocks.generate.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REPORT_REQUEST", {
    reference: { scope: "CURRENT_CONFIRMED", revision: null, items: [] } }) })
    .mockResolvedValueOnce({ object: { operation, confidence: .95, evidence: message } });
  const actual = await resolveDomainTurn({ ...ctx(message), user: { id: "u" } });
  if (operation === "EXECUTE") expect(actual).toMatchObject({ intent: "REPORT_REQUEST", mutation: "REPORT", semantic: { requestedEffect: "REPORT_GENERATION" } });
  else if (operation === "PREPARE") expect(actual).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE", semantic: { requestedEffect: "READ_ONLY", effectRequest: null, reference: { scope: "CURRENT_CONFIRMED" } } });
  else expect(actual).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "REPORT_AUTHORIZATION_UNCLEAR" });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
