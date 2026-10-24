import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ generate: vi.fn(), history: vi.fn() }));
vi.mock("ai", () => ({ generateObject: m.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: async () => ({ primary: { languageModel: {} } }) }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: m.history }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [] }) }));
vi.mock("./query-clarification-context.js", async importOriginal => ({ ...await importOriginal<any>(), readQueryClarification: async () => null }));
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat" };
const query = { scope: "IDENTITY" as const, entityText: "甲型正式板", granularity: "PRODUCT" as const, evidence: "介绍甲型正式板" };
beforeEach(() => {
  vi.resetAllMocks();
  m.history.mockResolvedValue([{ id: "shown", content: "资料中有甲型正式板。", createdAt: new Date(), metadata: { queryScope: conversation,
    backendDecision: { domainIntent: "PRODUCT_DISCOVERY", productQueryDiagnostics: { scope: query } } } }]);
});
it("产品续问提案不必重建产品范围，Backend按有效读取目标补全而不查全部产品", async () => {
  const message = "它的这个指标呢";
  m.generate.mockResolvedValue({ object: domainSemanticFixture(message, "PRODUCT_DETAIL", { productQuery: null,
    productContinuation: { action: "PARAMETERS", field: "LAMBDA", match: null, evidence: message },
    reference: { scope: "NONE", revision: null, items: [] } }) });
  const result = await resolveDomainTurn({ app: {} as any, conversation: conversation as any, userMessage: message });
  expect(result).toMatchObject({ intent: "PRODUCT_DETAIL", productContextMessageId: "shown",
    semantic: { productQuery: { scope: "IDENTITY", entityText: "甲型正式板", evidence: message } } });
});
it("模型重复给出独立参数路由和只读反查动作时，Backend依据动作绑定范围与真实参数焦点", async () => {
  const message = "看看其他的这个参数";
  m.generate.mockResolvedValue({ object: domainSemanticFixture(message, "PRODUCT_PARAMETER_QUERY", {
    parameterQuery: { parameter: "LAMBDA", subjectType: "ANY", subjectText: null, systemText: null, operator: "EXACT", targetValue: .123, tolerance: null, unit: "W/(m·K)", evidence: message },
    productContinuation: { action: "FIND_OTHERS", field: "LAMBDA", match: "READ", evidence: message },
    reference: { scope: "NONE", revision: null, items: [] } }) });
  const result = await resolveDomainTurn({ app: {} as any, conversation: conversation as any, userMessage: message });
  expect(result).toMatchObject({ intent: "PRODUCT_DISCOVERY", productContextMessageId: "shown",
    semantic: { productQuery: { scope: "CATALOG", entityText: null }, parameterQuery: null } });
});
it("无有效产品上下文或带计算/副作用提案不能借续问动作取得读取/执行授权", async () => {
  m.history.mockResolvedValue([]);
  const message = "继续吧";
  m.generate.mockResolvedValue({ object: domainSemanticFixture(message, "PRODUCT_DETAIL", {
    productContinuation: { action: "PARAMETERS", field: null, match: null, evidence: message },
    reference: { scope: "NONE", revision: null, items: [] } }) });
  expect((await resolveDomainTurn({ app: {} as any, conversation: conversation as any, userMessage: message })).intent).toBe("CLARIFY");
});
it("当前明确说出的产品名称覆盖旧范围，不能把更具体的产品追问扩大成旧系列", async () => {
  const message = "看看乙型板的参数";
  m.generate.mockResolvedValue({ object: domainSemanticFixture(message, "PRODUCT_DETAIL", {
    productQuery: { scope: "IDENTITY", entityText: "乙型板", granularity: "PRODUCT", evidence: message },
    productContinuation: { action: "PARAMETERS", field: null, match: null, evidence: message },
    reference: { scope: "NONE", revision: null, items: [] } }) });
  expect(await resolveDomainTurn({ app: {} as any, conversation: conversation as any, userMessage: message }))
    .toMatchObject({ intent: "PRODUCT_DETAIL", semantic: { productQuery: { entityText: "乙型板" } } });
});
it("相对参数查询由Backend选择真实参照来源，不让模型把产品事实误标成失效的参数查询", async () => {
  const message = "有没有比那个小的";
  const [row] = await m.history();
  row.metadata.backendDecision.productParameterFocus = [{ field: "LAMBDA", value: .005, unit: "W/(m·K)", scope: "MATERIAL_LAYER",
    entityId: "layer", entityName: "甲型正式板", sourceKey: "source" }];
  m.history.mockResolvedValue([row]);
  m.generate.mockResolvedValue({ object: domainSemanticFixture(message, "PRODUCT_PARAMETER_QUERY", { readGoal: "PARAMETERS", queryContext: "PREVIOUS_PARAMETER",
    parameterQuery: { parameter: "LAMBDA", subjectType: "ANY", subjectText: null, systemText: null, operator: "LT", targetValue: .005, tolerance: null, unit: "W/(m·K)", evidence: message },
    reference: { scope: "NONE", revision: null, items: [] } }) });
  expect(await resolveDomainTurn({ app: {} as any, conversation: conversation as any, userMessage: message }))
    .toMatchObject({ intent: "PRODUCT_DISCOVERY", mutation: "NONE", semantic: { productContinuation: { action: "FIND_OTHERS", match: "LT" }, parameterQuery: null } });
});

it("模型收到的历史按时间正序排列，当前产品由最新服务器事实绑定，避免切换产品后旧对象串扰",async()=>{
 const [latest]=await m.history();
 const older={...latest,id:"older",content:"较早对象的说明",metadata:{},createdAt:new Date(Date.now()-60000)};
 latest.content="当前对象的说明";m.history.mockResolvedValue([latest,older]);
 const message="查它的参数出处";
 m.generate.mockResolvedValue({object:domainSemanticFixture(message,"PRODUCT_DETAIL",{productQuery:null,
 productContinuation:{action:"PARAMETERS",field:"LAMBDA",match:null,evidence:message},reference:{scope:"NONE",revision:null,items:[]}})});
 await resolveDomainTurn({app:{} as any,conversation:conversation as any,userMessage:message});
 const input=JSON.parse(m.generate.mock.calls[0]![0].prompt);
 expect(input.recentAssistantMessagesOrder).toBe("OLDEST_TO_NEWEST");
 expect(input.recentAssistantMessages.map((m:any)=>m.content)).toEqual(["较早对象的说明","当前对象的说明"]);
 expect(input.previousProductQuery.query.entityText).toBe("甲型正式板");
});

it("相对产品检索不依赖模型的上下文标签或复制的历史名称/数值，真实焦点由Backend绑定",async()=>{
 const [row]=await m.history();row.metadata.backendDecision.productParameterFocus=[{field:"LAMBDA",value:.032,unit:"W/(m·K)",scope:"MATERIAL_LAYER",entityId:"layer",entityName:"甲型正式板",sourceKey:"source"}];m.history.mockResolvedValue([row]);
 const message="还有比刚才那个低一些的吗";
 m.generate.mockResolvedValue({object:domainSemanticFixture(message,"PRODUCT_PARAMETER_QUERY",{readGoal:"PARAMETERS",queryContext:"CURRENT_TURN",
 parameterQuery:{parameter:"LAMBDA",subjectType:"MATERIAL_LAYER",subjectText:"甲型正式板",systemText:null,operator:"LT",targetValue:.123,tolerance:null,unit:"W/(m·K)",evidence:message},reference:{scope:"NONE",revision:null,items:[]}})});
 expect(await resolveDomainTurn({app:{} as any,conversation:conversation as any,userMessage:message})).toMatchObject({intent:"PRODUCT_DISCOVERY",semantic:{queryContext:"CURRENT_TURN",parameterQuery:null,productContinuation:{action:"FIND_OTHERS",field:"LAMBDA",match:"LT"}}});
});
