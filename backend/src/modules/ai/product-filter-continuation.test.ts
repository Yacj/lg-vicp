import "dotenv/config";
import { expect, it } from "vitest";
import { bindProductFilterContinuation, previousProductQueryContext } from "./product-consultation-context.js";
import { productContinuationTarget } from "./product-parameter-focus.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";

const conversation = { id:"c",userId:"u",clientApp:"c_app",projectId:null };
const filter = { field:"LAMBDA",operator:"LT",targetValue:.017,unit:"W/(m·K)",scope:"MATERIAL_LAYER",referenceName:"甲板" };
function previous() {
  return previousProductQueryContext([{id:"a",createdAt:new Date(),metadata:{queryScope:conversation,backendDecision:{
    domainIntent:"PRODUCT_DISCOVERY",productQueryDiagnostics:{reason:"CATALOG_MATCH",parameterFilter:filter,
      scope:{scope:"CATALOG",entityText:null,granularity:"CATALOG",evidence:"找其他产品"}},
    productParameterFocus:[{field:"LAMBDA",value:.017,unit:"W/(m·K)",scope:"MATERIAL_LAYER",entityId:"k",entityName:"甲板",sourceKey:"source"}]
  }}}],conversation)!;
}
function proposal(message:string) {
  return domainSemanticFixture(message,"PRODUCT_PARAMETER_QUERY",{relation:"REFINE",requestedEffect:"READ_ONLY",queryContext:"PREVIOUS_PARAMETER",
    parameterQuery:{parameter:"LAMBDA",subjectType:"ANY",subjectText:null,systemText:null,operator:"EXACT",targetValue:.026,tolerance:null,unit:"W/(m·K)",evidence:message},
    reference:{scope:"NONE",revision:null,items:[]}});
}
it("产品反查修改数值沿用真实来源焦点及旧比较符，不另找不存在的独立参数查询", () => {
  const text="数值换成0.026",p=previous(),raw=proposal(text),before=JSON.stringify(raw);
  const result=bindProductFilterContinuation(text,raw,p);
  expect(result).toMatchObject({intent:"PRODUCT_DISCOVERY",requestedEffect:"READ_ONLY",queryContext:"CURRENT_TURN",parameterQuery:null,
    productContinuation:{action:"FIND_OTHERS",field:"LAMBDA",match:"LT",evidence:text}});
  expect(JSON.stringify(raw)).toBe(before);expect(p.parameterFilter).toEqual(filter);
  expect(bindProductFilterContinuation(text,{...raw,queryContext:"CURRENT_TURN"},p)?.productContinuation?.match).toBe("LT");
});
it.each([["换成大于0.026","GT"],["调到不高于0.026","LTE"],["改为等于0.026","EXACT"]])("%s按原话改比较关系",(message,operator)=>{
  expect(bindProductFilterContinuation(message,proposal(message),previous())?.productContinuation?.match).toBe(operator);
});
it.each(["context","expired","malformed","topic","pending","scope","effect","calculation","thermal","name","multiple","value","unit","metric","reference","object"])("%s不跨越原读取合同",reason=>{
  let text="数值换成0.026",p:any=previous(),s:any=proposal(text);
  if(reason==="context")p=undefined;
  if(reason==="expired")p=previousProductQueryContext([{id:"a",createdAt:new Date(0),metadata:{}}],conversation);
  if(reason==="malformed")p={...p,parameterFilter:undefined};
  if(reason==="topic")s.relation="SWITCH_TOPIC";
  if(reason==="pending")s.queryContext="CLARIFICATION_REPLY";
  if(reason==="scope")s.parameterQuery.subjectType="SPEC_NOMINAL";
  if(reason==="effect")s.requestedEffect="STATE_MUTATION";
  if(reason==="calculation")s.calculationRequest={};
  if(reason==="thermal")s.pageQuery={};
  if(reason==="name")s.parameterQuery.subjectText="乙板";
  if(reason==="multiple")text="0.026到0.04";
  if(reason==="value")s.parameterQuery.targetValue=.05;
  if(reason==="unit")text="改成26mm";
  if(reason==="metric")text="K改成0.026";
  if(reason==="reference")s.reference.scope="CURRENT_SELECTED";
  if(reason==="object")s.readGoal="SCHEMES";
  s.evidence=text;s.parameterQuery.evidence=text;
  expect(bindProductFilterContinuation(text,s,p)).toBeUndefined();
});
it("只改新值不让模型的EXACT覆盖已确认的上限；明确比较符仍优先",()=>{
 expect(productContinuationTarget("调整为0.041","LAMBDA","EXACT","LT")).toMatchObject({value:.041,match:"LT"});
 expect(productContinuationTarget("大于0.041","LAMBDA","EXACT","LT")).toMatchObject({value:.041,match:"GT"});
 for(const message of ["不等于0.041","!=0.041","≠0.041"])
   expect(productContinuationTarget(message,"LAMBDA","EXACT","LT").error).toBeTruthy();
});
