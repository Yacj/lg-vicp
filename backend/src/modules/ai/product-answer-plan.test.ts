import { expect, it } from "vitest";
import { buildProductAnswerFacts } from "./product-answer.js";
import { renderProductAnswerPlan, productAnswerPlanPrompt } from "./product-answer-plan.js";
const facts = buildProductAnswerFacts({ products: [{ id:"p",name:"正式保温板",summary:null,productType:"复合板",specClass:null,
  thermalConductivity:.005,correctionFactor:1.25,thicknessOptionsMm:[25],specifications:[],knowledgeDocumentIds:[] }],sources:[],hasMore:false });
it("模型只选字段，参数由同一产品绑定；空介绍不编造优势或系列",()=>{
  expect(productAnswerPlanPrompt(facts)).toContain("JSON Schema");expect(productAnswerPlanPrompt(facts)).toContain("productId");
  const text=renderProductAnswerPlan({products:[{productId:"p",fields:["CATEGORY","LAMBDA"]}]},facts)!;
  expect(text).toContain("λ=0.005 W/(m·K)");expect(text).toContain("未提供已审核");expect(text).toContain("不代表完整系列");
  expect(text).not.toContain("行业领先");
});
it.each([
  {products:[{productId:"p",fields:["LAMBDA"],text:"λ=0.3"}]},
  {products:[{productId:"wrong",fields:["SUMMARY"]}]},
  {products:[]},
  {products:[{productId:"p",fields:["SUMMARY"]},{productId:"p",fields:["SUMMARY"]}]}
])("未知事实、产品身份、漏项、重复均回落",plan=>expect(renderProductAnswerPlan(plan as any,facts)).toBeNull());
