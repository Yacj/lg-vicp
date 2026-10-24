import { expect, it } from "vitest";
import { buildProductAnswerFacts } from "./product-answer.js";
import { renderProductAnswerPlan, productAnswerPlanPrompt } from "./product-answer-plan.js";
const facts = buildProductAnswerFacts({ products: [{ id:"p",name:"正式保温板",summary:null,productType:"复合板",specClass:null,
  thermalConductivity:.005,correctionFactor:1.25,thicknessOptionsMm:[25],specifications:[],knowledgeDocumentIds:[] }],sources:[],hasMore:false });
it("技术目标中模型只选字段，参数由同一产品绑定；不编造优势",()=>{
  expect(productAnswerPlanPrompt(facts)).toContain("JSON Schema");expect(productAnswerPlanPrompt(facts)).toContain("productId");
  const text=renderProductAnswerPlan({products:[{productId:"p",fields:["CATEGORY","LAMBDA"]}]},{...facts,mode:"TECHNICAL"})!;
  expect(text).toContain("λ=0.005 W/(m·K)");
  expect(text).not.toContain("行业领先");
});
it("简单介绍自然说明已有产品，模型选择技术字段也不堆参数；系列缺项仍说明",()=>{
  const text=renderProductAnswerPlan({products:[{productId:"p",fields:["CATEGORY","LAMBDA","CORRECTION","THICKNESS"]}]},{...facts,seriesRequested:true})!;
  expect(text).not.toContain("λ=");expect(text).not.toContain("α=");expect(text).not.toContain("25mm");
  expect(text).not.toContain("已审核");expect(text).toContain("产品介绍资料还不完整");expect(text).toContain("完整系列");
});
it.each([
  {products:[{productId:"p",fields:["LAMBDA"],text:"λ=0.3"}]},
  {products:[{productId:"wrong",fields:["SUMMARY"]}]},
  {products:[]},
  {products:[{productId:"p",fields:["SUMMARY"]},{productId:"p",fields:["SUMMARY"]}]}
])("未知事实、产品身份、漏项、重复均回落",plan=>expect(renderProductAnswerPlan(plan as any,facts)).toBeNull());
