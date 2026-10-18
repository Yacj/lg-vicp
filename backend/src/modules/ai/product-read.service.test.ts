import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { searchProductCatalog, resolveProductConsultation } from "./product-read.service.js";
const access=vi.hoisted(()=>vi.fn());vi.mock("./solution-state.service.js",()=>({assertSolutionAccess:access}));
const product={id:"p",name:"正式保温板",productType:"复合板",specClass:"II",summary:"正式目录字段",thicknessOptionsMm:[30],thermalConductivity:.02,correctionFactor:1};
function ctx(message="你们有哪些产品"){
  const tables:Record<string,unknown[]>={catalog_products:[product],product_specs:[{id:"spec",catalogProductId:"p",specClass:"II",thicknessMm:30}],knowledge_aliases:[{term:"正式保温板",alias:"蓝板"}],product_knowledge_links:[]};
  const db={select:()=>{let name="";const b:any={from:(table:any)=>{name=getTableName(table);return b;},innerJoin:()=>b,where:()=>b,orderBy:()=>b,limit:()=>b,then:(r:any)=>Promise.resolve(tables[name]??[]).then(r)};return b;},insert:vi.fn(),update:vi.fn()};
  return {app:{db},user:{id:"u"},conversation:{id:"c",projectId:null},userMessage:message,onEvent:vi.fn(),taskState:{taskType:"GENERAL"}} as any;
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
