import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { searchProductCatalog, resolveProductConsultation } from "./product-read.service.js";
const access=vi.hoisted(()=>vi.fn());vi.mock("./solution-state.service.js",()=>({assertSolutionAccess:access}));
const history=vi.hoisted(()=>vi.fn());vi.mock("./reference-fact-history.js",()=>({readReferenceFactHistory:history}));
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
const product={id:"p",name:"正式保温板",productType:"复合板",specClass:"II",summary:"正式目录字段",thicknessOptionsMm:[30],thermalConductivity:.02,correctionFactor:1};
function ctx(message="你们有哪些产品",activeProduct: Omit<typeof product,"summary"> & {summary:string|null}=product){
  const tables:Record<string,unknown[]>={catalog_products:[activeProduct],product_specs:[{id:"spec",catalogProductId:"p",specClass:"II",thicknessMm:30}],knowledge_aliases:[{term:"正式保温板",alias:"蓝板"}],product_knowledge_links:[]};
  const db={select:()=>{let name="";const b:any={from:(table:any)=>{name=getTableName(table);return b;},innerJoin:()=>b,where:()=>b,orderBy:()=>b,limit:()=>b,then:(r:any)=>Promise.resolve(tables[name]??[]).then(r)};return b;},insert:vi.fn(),update:vi.fn()};
  return {app:{db},user:{id:"u"},conversation:{id:"c",projectId:null},userMessage:message,onEvent:vi.fn(),taskState:{taskType:"GENERAL"},tables} as any;
}
beforeEach(()=>{access.mockResolvedValue({projectId:null});});
it("首轮无ProductId搜索正式目录，字段/规格与产品ID同源",async()=>{const c=ctx();const before=structuredClone(c.taskState);const result=await resolveProductConsultation(c);expect(result.products[0]).toMatchObject({id:"p",productType:"复合板",specClass:"II",specifications:[{id:"spec",thicknessMm:30}]});expect(c.taskState).toEqual(before);expect(c.app.db.insert).not.toHaveBeenCalled();});
it("正式别名定位产品详情，不要求客户输入全名",async()=>{expect((await resolveProductConsultation(ctx("蓝板参数"))).products.map((p:any)=>p.id)).toEqual(["p"]);});
it("模型keyword不在本轮原话中拒绝，不能自由猜产品",async()=>{await expect(searchProductCatalog(ctx("看蓝板"),{keyword:"不存在的竞品"})).rejects.toThrow("原话");});
it("未知具体产品详情澄清，不能把全目录当详情",async()=>{const c=ctx("某未知牌号参数");c.domainDecision={intent:"PRODUCT_DETAIL"};expect((await resolveProductConsultation(c)).needsClarification).toBe(true);});
it("未知系列不能静默退回唯一目录产品；正式别名才允许绑定",async()=>{
  const c=ctx("介绍下 VLCP 一系列产品");c.domainDecision={intent:"PRODUCT_DISCOVERY",semantic:{productQuery:{scope:"IDENTITY",entityText:"VLCP",granularity:"SERIES",evidence:c.userMessage}}};
  const result=await resolveProductConsultation(c);expect(result.products).toEqual([]);expect(result.needsClarification).toBe(true);expect(result.answer).toContain("VLCP");expect(result.answer).not.toContain("VICP");
  c.userMessage="介绍蓝板";c.domainDecision.semantic.productQuery.entityText="蓝板";
  expect((await resolveProductConsultation(c)).products.map((p:any)=>p.id)).toEqual(["p"]);
});
it("事实取得后分开组织：介绍目标不直出技术参数清单",async()=>{const c=ctx("你们有哪些产品");const result=await resolveProductConsultation(c);expect(result.facts.mode).toBe("INTRODUCTION");expect(result.answer).not.toContain("λ=");});
it("用户自述工程背景时同一批事实按技术形态组织",async()=>{const c=ctx("给我们设计院看下参数");c.domainDecision={intent:"PRODUCT_DISCOVERY",semantic:{audience:"ENGINEER"}};const result=await resolveProductConsultation(c);expect(result.facts.mode).toBe("TECHNICAL");});
it("简单介绍续问绑定原产品目标并重新核验目录；历史只调表达，不扩大事实",async()=>{
  const c=ctx("我不是工程师，简单说就行。");c.conversation={id:"c",userId:"u",clientApp:"c_app",projectId:null};
  const query={scope:"IDENTITY" as const,entityText:"蓝板",granularity:"PRODUCT" as const,evidence:"介绍蓝板"};
  history.mockResolvedValue([{id:"previous",createdAt:new Date(),metadata:{queryScope:c.conversation,backendDecision:{domainIntent:"PRODUCT_DISCOVERY",productQueryDiagnostics:{scope:query}}}}]);
  const semantic=domainSemanticFixture(c.userMessage,"PRODUCT_DISCOVERY",{audience:"GENERAL",productQuery:{...query,evidence:c.userMessage},reference:{scope:"NONE",revision:null,items:[]}});
  c.domainDecision={...applyDomainPolicy(c.userMessage,semantic,c.taskState,{productQuery:query}),productContextMessageId:"previous"};
  const before=structuredClone(c.taskState),result=await resolveProductConsultation(c);
  expect(result.products.map((p:any)=>p.id)).toEqual(["p"]);expect(result.facts.mode).toBe("INTRODUCTION");expect(result.answer).not.toContain("λ=");
  expect(c.taskState).toEqual(before);expect(c.app.db.insert).not.toHaveBeenCalled();expect(c.app.db.update).not.toHaveBeenCalled();
  history.mockResolvedValue([]);await expect(resolveProductConsultation(c)).rejects.toThrow("失效");
});
it("产品介绍补充已发布知识库的构造系统，不只依赖目录条数",async()=>{
  const catalog={...product,name:"VICP复合保温板",summary:null};
  const c=ctx("VICP复合保温板有哪些产品",catalog);
  c.domainDecision={intent:"PRODUCT_DISCOVERY",semantic:{audience:"GENERAL",productQuery:{scope:"IDENTITY",entityText:"VICP",granularity:"SERIES",evidence:c.userMessage}}};
  c.tables.knowledge_pages=[{page:{id:"pg",pageTitle:"建筑外墙热工计算参考选用表（I型VICP薄抹灰外保温系统）",metadata:{confirmedStructuredData:{pageTitle:"建筑外墙热工计算参考选用表（I型VICP薄抹灰外保温系统）",fullText:"",systems:[{systemName:"A1-1",layers:[{name:"I型VICP复合保温板",lambda:.005}],options:[]}]}}},
    document:{id:"d",title:"客户已确认知识库",status:"ACTIVE",deletedAt:null,projectId:null,currentVersionId:"v"},
    version:{id:"v",status:"PUBLISHED",usageMode:"AI_ENABLED",effectiveDate:null,expiryDate:null}}];
  const result=await resolveProductConsultation(c);
  expect(result.knowledgeFamilies[0]?.name).toContain("薄抹灰");
  expect(result.answer).toContain("已发布知识库");
  expect(result.answer).toContain("不等于已确认的可销售型号");
  expect(result.diagnostics.seriesCoverageVerified).toBe(true);
});
it("确认上一轮唯一产品建议后绑定该产品，否定/换一个不绑定",async()=>{
  const catalog={...product,name:"VICP复合保温板",summary:null};
  const c=ctx("是的",catalog);
  c.conversation={id:"c",userId:"u",clientApp:"c_app",projectId:null};
  c.domainDecision={intent:"PRODUCT_DISCOVERY",semantic:{productQuery:{scope:"IDENTITY",entityText:"VLCP",granularity:"PRODUCT",evidence:"VLCP"}}};
  history.mockResolvedValue([{id:"a",content:"你是不是想了解 VICP（VICP复合保温板）？确认一下名称，我就接着介绍。",createdAt:new Date(),
    metadata:{queryScope:c.conversation,backendDecision:{domainIntent:"PRODUCT_DISCOVERY",productQueryDiagnostics:{
      scope:{scope:"IDENTITY",entityText:"VLCP",granularity:"PRODUCT",evidence:"VLCP"},reason:"NAME_UNRESOLVED",suggestions:[{name:"VICP复合保温板",matchedName:"VICP"}]}}}}]);
  const accepted=await resolveProductConsultation(c);
  expect(accepted.products.map((p:any)=>p.id)).toEqual(["p"]);
  expect(accepted.needsClarification).toBe(false);
  expect(accepted.diagnostics.scope).toMatchObject({ scope:"IDENTITY",entityText:"VICP复合保温板" });
  c.userMessage="不是";
  c.domainDecision.semantic.productQuery={...c.domainDecision.semantic.productQuery,entityText:"VLCP",evidence:"不是"};
  const rejected=await resolveProductConsultation(c);
  expect(rejected.products).toEqual([]);
  history.mockResolvedValue([]);
});
it("用户确认的正式简称VICP直接读取产品；VLCP只给友好建议而不绑定产品",async()=>{
  const catalog={...product,name:"VICP复合保温板",summary:null};
  const c=ctx("VICP",catalog);c.domainDecision={intent:"PRODUCT_DISCOVERY",semantic:{audience:"GENERAL",productQuery:{scope:"IDENTITY",entityText:"VICP",granularity:"PRODUCT",evidence:"VICP"}}};
  const direct=await resolveProductConsultation(c);
  expect(direct.needsClarification).toBe(false);expect(direct.products.map((p:any)=>p.id)).toEqual(["p"]);
  expect(direct.answer).toContain("VICP 是");expect(direct.answer).not.toContain("已审核");expect(direct.answer).not.toContain("λ=");
  c.userMessage="VLCP";c.domainDecision.semantic.productQuery={...c.domainDecision.semantic.productQuery,entityText:"VLCP",evidence:"VLCP"};
  const typo=await resolveProductConsultation(c);
  expect(typo.needsClarification).toBe(true);expect(typo.products).toEqual([]);expect(typo.answer).toContain("你是不是想了解");expect(typo.answer).toContain("VICP");
  expect(typo.diagnostics.suggestions).toHaveLength(1);expect(typo.diagnostics.matchedIdentityCount).toBe(0);
});

it("消费已经核验的口语改写目标，不把受众身份当成删除参数读取目标的依据", async () => {
 const c=ctx("换个容易懂的说法");c.domainDecision={intent:"PRODUCT_DETAIL",semantic:{audience:"GENERAL",
 productQuery:{scope:"CATALOG",entityText:null,granularity:"PRODUCT",evidence:c.userMessage},
 productContinuation:{action:"REPHRASE",field:null,match:null,evidence:c.userMessage}}};
 const result=await resolveProductConsultation(c);
 expect(result.facts.mode).toBe("INTRODUCTION");expect(result.answer).not.toContain("λ=");
});
