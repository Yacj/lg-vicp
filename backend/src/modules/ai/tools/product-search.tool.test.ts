import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { createGetProductDataTool,getProductDataInput } from "./get-product-data.tool.js";
import { createCompareProductsTool,compareProductsInput } from "./compare-products.tool.js";
import { domainDecision } from "../ai-domain-turn-decision.js";
const m=vi.hoisted(()=>({search:vi.fn(),compare:vi.fn(),parameters:vi.fn()}));
vi.mock("./tool-runtime.js",()=>({runRegisteredTool:async(_c:any,_n:any,_a:any,_o:any,run:any)=>run()}));
vi.mock("../product-read.service.js",()=>({searchProductCatalog:m.search}));
vi.mock("../product-parameter-read.service.js",()=>({readProductParameters:m.parameters}));
vi.mock("../compare-product.service.js",()=>({compareProducts:m.compare,toProductCompareToolOutput:()=>({requiresUserSelection:false})}));
const ctx=()=>({app:{db:{insert:vi.fn()}},conversation:{id:"c",projectId:null},user:{id:"u"},userMessage:"有哪些产品",domainDecision:domainDecision("PRODUCT_DISCOVERY","有哪些产品"),onEvent:vi.fn()}) as any;
beforeEach(()=>{vi.clearAllMocks();m.search.mockResolvedValue({products:[{id:"p",name:"正式板",summary:null,specClass:"II",thermalConductivity:.02,thicknessOptionsMm:[30],specifications:[{id:"s",thicknessMm:30}],knowledgeDocumentIds:[]}],sources:[],hasMore:false});});
it("SEARCH无需ProductId，返回正式字段后才授权READ",async()=>{const c=ctx();const t=createGetProductDataTool(c);const first:any=await t.execute!(getProductDataInput.parse({operation:"SEARCH"}),{toolCallId:"s",messages:[]});expect(first.data.products[0]).toMatchObject({id:"p",thermalConductivity:.02,specifications:[{id:"s"}]});expect(c.productReadIds).toEqual(["p"]);expect((await t.execute!(getProductDataInput.parse({productIds:["p"]}),{toolCallId:"r",messages:[]}) as any).ok).toBe(true);});
it("模型猜ID的READ不查目录",async()=>{const c=ctx();expect(await createGetProductDataTool(c).execute!(getProductDataInput.parse({productIds:["invented"]}),{toolCallId:"r",messages:[]})).toMatchObject({ok:false,code:"PRODUCT_REFERENCE_REQUIRED"});expect(m.search).not.toHaveBeenCalled();});
it("模型猜ID的Compare不调用比较服务",async()=>{const c=ctx();c.domainDecision=domainDecision("MATERIAL_COMPARE","对比产品");expect(await createCompareProductsTool(c).execute!(compareProductsInput.parse({productIds:["fake1","fake2"]}),{toolCallId:"x",messages:[]})).toMatchObject({ok:false,code:"PRODUCT_REFERENCE_REQUIRED"});expect(m.compare).not.toHaveBeenCalled();});
it("概念解释不能被模型改为产品选择等待",async()=>{const c=ctx();c.domainDecision=domainDecision("KNOWLEDGE_EXPLAIN","热阻区别");c.productReadIds=["p","q"];expect(await createCompareProductsTool(c).execute!(compareProductsInput.parse({productIds:["p","q"]}),{toolCallId:"x",messages:[]})).toMatchObject({ok:false,code:"DOMAIN_COMPARE_NOT_AUTHORIZED"});expect(m.search).not.toHaveBeenCalled();});
it("PARAMETER_QUERY只消费服务器Domain条件，Tool不接受重写λ目标",async()=>{
  const c=ctx();c.domainDecision=domainDecision("PRODUCT_PARAMETER_QUERY","导热系数");
  m.parameters.mockResolvedValue({facts:[],query:{parameter:"LAMBDA",targetValue:.3},diagnostics:{issues:["VALUE_NO_MATCH"]},answer:"本次范围无匹配",sources:[]});
  const args=getProductDataInput.parse({operation:"PARAMETER_QUERY",targetValue:.005,subjectType:"MATERIAL"});
  expect(args).toEqual({operation:"PARAMETER_QUERY"});
  expect(await createGetProductDataTool(c).execute!(args,{toolCallId:"lambda",messages:[]})).toMatchObject({ok:true,data:{query:{targetValue:.3},diagnostics:{issues:["VALUE_NO_MATCH"]}}});
  expect(m.parameters).toHaveBeenCalledWith(c);expect(m.search).not.toHaveBeenCalled();expect(c.productReadIds).toBeUndefined();
});
it("没有本轮参数Domain授权时，Tool不能单独选择参数分支",async()=>{
  const c=ctx();expect(await createGetProductDataTool(c).execute!(getProductDataInput.parse({operation:"PARAMETER_QUERY"}),{toolCallId:"lambda",messages:[]})).toMatchObject({ok:false,code:"DOMAIN_PARAMETER_QUERY_REQUIRED"});
  expect(m.parameters).not.toHaveBeenCalled();
});
