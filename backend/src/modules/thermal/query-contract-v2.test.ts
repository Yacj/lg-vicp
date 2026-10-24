import { expect, it } from "vitest";
import { inferThermalLookupMode, matchesMetric, parseThermalLookupMessage } from "./thermal-lookup-mode.js";
import { applySemanticQuery, parseSemanticFastPath } from "./semantic-query.js";
import { thermalQueryStateSchema, traceQueryState, validateCandidateAgainstQueryState } from "./thermal-query-state.js";
import { solutionConstraintFingerprint } from "../ai/solution-workflow.js";
import { formatLookupThickness } from "./thermal-lookup-thickness.js";
import { diagnoseReferenceQuery } from "./reference-query-diagnostics.js";
import { referenceQueryReplyFacts, renderReferenceQueryResponse } from "./reference-query-response.js";

it("V2厚度范围无命中保留名称和严格比较，不误问已经提供的名称",()=>{
  const query={queryContractVersion:2 as const,schemeCode:'WALL-X',thicknessMax:25,thicknessMaxExclusive:true};
  const diagnostic=diagnoseReferenceQuery(query,[{schemeCode:'WALL-X',thicknessMm:25}], 'JOINT');
  expect(diagnostic.issues).toEqual(['NO_MATCHING_VALUE']);expect(diagnostic.matchedCount).toBe(0);
  expect(diagnostic.metricScopes).toEqual([]);
  const facts=referenceQueryReplyFacts(diagnostic,query);
  expect(facts.identity).toContain('板厚严格小于25mm');expect(facts.nextSteps).toEqual(['REVISE_QUERY']);
  expect(renderReferenceQueryResponse(diagnostic,query)).not.toContain('具体板材名称');
  expect(formatLookupThickness(query)).toBe('厚度严格小于 25mm');
  expect(formatLookupThickness({thicknessMin:20,thicknessMinExclusive:true,thicknessMax:25})).toBe('厚度大于 20mm、不大于 25mm');
  expect(diagnoseReferenceQuery({...query,schemeCode:'UNKNOWN'},[{schemeCode:'WALL-X',thicknessMm:25}], 'JOINT').issues).toEqual(['IDENTITY_NOT_FOUND']);
});
it.each([['K小于0.2322','LT','MAX_LIMIT'],['K严格大于0.2322','GT','MIN_LIMIT'],['K不大于0.2322','MAX_LIMIT','MAX_LIMIT'],
  ['K不小于0.2322','MIN_LIMIT','MIN_LIMIT'],['K<=0.2322','MAX_LIMIT','MAX_LIMIT'],['K>=0.2322','MIN_LIMIT','MIN_LIMIT']])("%s新旧合同显式区分，包含边界仍兼容",(text,v2,v1)=>{
  expect(inferThermalLookupMode(text,2)).toBe(v2);expect(inferThermalLookupMode(text)).toBe(v1);
  expect(parseThermalLookupMessage(text,undefined,2).filters[0]?.mode).toBe(v2);
});
it.each(['LT','GT'] as const)("%s不使用EXACT精度或近似窗口纳入等值；旧上下界保持包含等值",mode=>{
  expect(matchesMetric(.2322,.2322,mode,100)).toBe(false);
  expect(matchesMetric(mode==='LT'?.232199999999:.232200000001,.2322,mode)).toBe(true);
  expect(matchesMetric(mode==='LT'?.232200000001:.232199999999,.2322,mode)).toBe(false);
  expect(matchesMetric(.2322,.2322,mode==='LT'?'MAX_LIMIT':'MIN_LIMIT')).toBe(true);
});
it("完整符号提案与执行入口记录V2；旧直接解析保留V1，新查询不会受模型较宽operator影响",()=>{
  const legacy=parseSemanticFastPath('K<0.2322')!;
  expect(legacy.constraints[0]?.operator).toBe('MAX_LIMIT');expect(parseSemanticFastPath('K<0.2322',2)?.constraints[0]?.operator).toBe('LT');
  const query=applySemanticQuery('K严格小于0.2322',{...legacy,constraints:legacy.constraints.map(item=>({...item,evidence:'K严格小于0.2322'}))},{entities:[],aliases:[]},undefined,{contractVersion:2});
  expect(query).toMatchObject({queryContractVersion:2,filters:[{metric:'K',mode:'LT',targetValue:.2322}]});
  expect(query.unresolved).toEqual([]);expect(thermalQueryStateSchema.parse(query).queryContractVersion).toBe(2);
  expect(validateCandidateAgainstQueryState({kValue:.2322},query).passed).toBe(false);
});
it("开闭边界矛盾被拒绝；继承的旧条件不重解释",()=>{
  expect(traceQueryState({filters:[{metric:'K',mode:'GT',targetValue:.2322},{metric:'K',mode:'MAX_LIMIT',targetValue:.2322}]}).unresolved).toContainEqual(expect.objectContaining({field:'conflict:K'}));
  const previous={filters:[{metric:'K' as const,mode:'MAX_LIMIT' as const,targetValue:.3}]};
  const next=applySemanticQuery('',{queryMode:'REFINE_QUERY',intent:'REFERENCE_LOOKUP',constraints:[],preferences:[],unresolved:[],confidence:.98},{entities:[],aliases:[]},previous,{contractVersion:2});
  expect(next.filters).toMatchObject(previous.filters);expect(previous.filters[0]?.mode).toBe('MAX_LIMIT');
});
it("严格厚度边界及其确认指纹保留；去掉边界后清理开放标志",()=>{
  const closed={thicknessMax:25},open={thicknessMax:25,thicknessMaxExclusive:true};
  expect(validateCandidateAgainstQueryState({thicknessMm:25},closed).passed).toBe(true);
  expect(validateCandidateAgainstQueryState({thicknessMm:25},open).passed).toBe(false);
  expect(solutionConstraintFingerprint(closed)).not.toBe(solutionConstraintFingerprint(open));
  expect(traceQueryState({thicknessMin:25,...open}).unresolved).toContainEqual(expect.objectContaining({field:'conflict:thickness'}));
  expect(traceQueryState({...open,thicknessMax:undefined}).thicknessMaxExclusive).toBeUndefined();
});
it.each([['K不要小于0.3','MIN_LIMIT'],['K不能严格大于0.3','MAX_LIMIT'],['K不能不小于0.3','LT'],['K不得不大于0.3','GT']])("V2否定数学关系%s保持逻辑边界",(text,mode)=>expect(inferThermalLookupMode(text,2)).toBe(mode));
it("厚度原话的开闭边界在Backend确定性绑定，不能沿用较宽模型提案",()=>{
  const semantic={queryMode:'NEW_QUERY',intent:'REFERENCE_LOOKUP',confidence:.98,unresolved:[],preferences:[],constraints:[{
    type:'THICKNESS',operation:'SET',field:null,entityText:null,resolvedText:null,metric:null,operator:'MAX_LIMIT',value:25,evidence:'板厚严格小于25mm',hard:true,confidence:.98}]};
  const query=applySemanticQuery('板厚严格小于25mm',semantic,{entities:[],aliases:[]},undefined,{contractVersion:2});
  expect(query).toMatchObject({queryContractVersion:2,thicknessMax:25,thicknessMaxExclusive:true});
  expect(validateCandidateAgainstQueryState({thicknessMm:25},query).passed).toBe(false);
});
it("明确替换板厚边界清除被替换的一侧，追加条件仍保留并报告真实矛盾",()=>{
  const previous={schemeCode:'WALL-X',substrateThickness:200,thicknessMax:25,filters:[{metric:'K' as const,mode:'MAX_LIMIT' as const,targetValue:.3}]};
  const input={queryMode:'REFINE_QUERY',intent:'REFERENCE_LOOKUP',confidence:.98,unresolved:[],preferences:[],constraints:[{
    type:'THICKNESS',operation:'REPLACE',field:null,entityText:null,resolvedText:null,metric:null,operator:'GT',value:25,evidence:'板厚严格大于25mm',hard:true,confidence:.98}]};
  const query=applySemanticQuery('换成板厚严格大于25mm',input,{entities:[],aliases:[]},previous,{contractVersion:2});
  expect(query).toMatchObject({schemeCode:'WALL-X',substrateThickness:200,thicknessMin:25,thicknessMinExclusive:true,filters:previous.filters});
  expect(query.thicknessMax).toBeUndefined();expect(query.unresolved).toEqual([]);
  const appended=applySemanticQuery('再要求板厚严格大于25mm',{...input,constraints:input.constraints.map(c=>({...c,operation:'APPEND'}))},{entities:[],aliases:[]},previous,{contractVersion:2});
  expect(appended.unresolved).toContainEqual(expect.objectContaining({field:'conflict:thickness'}));
});
