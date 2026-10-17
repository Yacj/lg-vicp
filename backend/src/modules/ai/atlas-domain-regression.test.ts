import 'dotenv/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({generate:vi.fn(),runtime:vi.fn()}));
vi.mock('ai',()=>({generateObject:mocks.generate}));
vi.mock('./ai-runtime.service.js',()=>({resolveSceneRuntime:mocks.runtime}));
vi.mock('./reference-fact-history.js',()=>({readReferenceFactHistory:vi.fn(async()=>[])}));
vi.mock('./query-clarification-context.js',()=>({readQueryClarification:async()=>null}));
vi.mock('../thermal/thermal-query-dictionary.service.js',()=>({loadThermalQueryDictionary:vi.fn(async()=>({entities:[],aliases:[]}))}));
import { repairDomainSemanticText } from './domain-semantic-output.js';
import { domainSemanticFixture } from './domain-semantic.fixture.js';
import { resolveDomainTurn } from './ai-domain-turn-decision.service.js';
import { applySemanticQuery, type SemanticQuery } from '../thermal/semantic-query.js';
import { groundedPageAttribute } from '../../shared/confirmed-page-query.js';
import { validateCandidateAgainstQueryState } from '../thermal/thermal-query-state.js';
import { parseThermalLookupMessage } from '../thermal/thermal-lookup-mode.js';
import { describeNumberRoles } from '../thermal/semantic-query.js';
const entity=(text:string,field:'placement'|'pageLabel'|'applicationPart',operation:'SET'|'APPEND'='SET'):SemanticQuery['constraints'][number]=>({type:'ENTITY',field,operation,entityText:text,resolvedText:null,value:null,metric:null,operator:null,evidence:text,confidence:1,hard:true});
const query=(constraints:SemanticQuery['constraints']):SemanticQuery=>({intent:'REFERENCE_LOOKUP',queryMode:'NEW_QUERY',constraints,preferences:[],unresolved:[],confidence:1});
const context=(message:string)=>({app:{db:{},log:{warn:vi.fn()}},conversation:{id:'conversation',userId:'user',projectId:null,clientApp:'c_app',scene:'general_chat'},userMessage:message,taskState:{taskType:'GENERAL'}} as any);
beforeEach(()=>{vi.resetAllMocks();mocks.runtime.mockResolvedValue({primary:{languageModel:{}}})});
describe('真实图集UAT语义提案回归，不使用口语路由',()=>{
  it('25厚是厚度格式，不能被附近K错误吸收为目标值',()=>{
    expect(parseThermalLookupMessage('只看倒置屋面25厚的K。').filters).toEqual([]);
    expect(describeNumberRoles('只看倒置屋面25厚的K。')[0]?.role).toBe('THICKNESS');
    expect(parseThermalLookupMessage('25厚，K=0.25').filters).toMatchObject([{metric:'K',targetValue:0.25}]);
  });
  it('仅修复只读提案的null空数组，动作/额外字段仍拒绝',()=>{
    const proposal={...domainSemanticFixture('读取原页','REFERENCE_VIEW'),constraintPatch:null};
    expect(JSON.parse(repairDomainSemanticText(JSON.stringify(proposal))!).constraintPatch).toEqual([]);
    expect(repairDomainSemanticText(JSON.stringify({...proposal,requestedEffect:'STATE_MUTATION'}))).toBeNull();
    expect(repairDomainSemanticText(JSON.stringify({...proposal,schemeId:'invented'}))).toBeNull();
  });
  it('印刷页码是受约束格式，不接受整句或以型号推等级',()=>{
    expect(groundedPageAttribute('pageLabel','第90页')).toBe('90');
    expect(groundedPageAttribute('pageLabel','90頁')).toBe('90');
    expect(groundedPageAttribute('pageLabel','第90页以外')).toBeUndefined();
    expect(groundedPageAttribute('waterproofGrade','I型')).toBeUndefined();
  });
  it('正倒置保留为集合，缺属性不满足；追问单值替换集合',()=>{
    const initial=applySemanticQuery('正置和倒置',query([entity('倒置','placement','APPEND'),entity('正置','placement')]),{entities:[],aliases:[]});
    expect(initial.unresolved).toEqual([]);expect(initial.placements).toEqual(['UPRIGHT','INVERTED']);expect(initial.placement).toBeUndefined();
    expect(validateCandidateAgainstQueryState({},initial).passed).toBe(false);
    const next=applySemanticQuery('只看倒置',{...query([entity('倒置','placement')]),queryMode:'REFINE_QUERY'},{entities:[],aliases:[]},initial);
    expect(next.placement).toBe('INVERTED');expect(next.placements).toBeUndefined();
    expect(applySemanticQuery('正置和倒置',query([entity('正置','placement'),entity('倒置','placement')]),{entities:[],aliases:[]}).unresolved).not.toEqual([]);
  });
  it('读取指标被误作空目标时，用唯一复核修正，仍共用超时预算',async()=>{
    const message='屋面20mm的传热系数是多少？';
    const base=domainSemanticFixture(message,'REFERENCE_QUERY',{relation:'NEW',reference:{scope:'NONE',revision:null,items:[]}});
    const valid=query([entity('屋面','applicationPart'),{type:'THICKNESS',field:null,operation:'SET',entityText:null,resolvedText:null,metric:null,operator:'EXACT',value:20,evidence:'20mm',hard:true,confidence:1}]);
    mocks.generate.mockResolvedValueOnce({object:{...base,pageQuery:{...valid,constraints:[...valid.constraints,{type:'METRIC',field:null,operation:'SET',entityText:null,resolvedText:null,metric:'K',operator:null,value:null,evidence:'传热系数',hard:true,confidence:1}]}}}).mockResolvedValueOnce({object:{...base,pageQuery:valid}});
    expect(await resolveDomainTurn(context(message))).toMatchObject({mutation:'QUERY',policyReason:'READ_ONLY_QUERY'});
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const requests=mocks.generate.mock.calls.map(c=>c[0]);expect(requests[0].abortSignal).toBe(requests[1].abortSignal);expect(requests[1].prompt).toContain('PAGE_QUERY_CONSTRAINTS_INVALID');
  });
  it('独立按页读取提案目标不一致时重验，不把READ_ONLY直接当QUERY',async()=>{
    const message='把第90页完整原表打开';const pageQuery=query([entity('第90页','pageLabel')]);
    mocks.generate.mockResolvedValueOnce({object:{...domainSemanticFixture(message,'REFERENCE_VIEW'),pageQuery}}).mockResolvedValueOnce({object:{...domainSemanticFixture(message,'REFERENCE_QUERY'),pageQuery}});
    expect(await resolveDomainTurn(context(message))).toMatchObject({mutation:'QUERY'});expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[1]![0].prompt).toContain('PAGE_QUERY_SCOPE_INVALID');
  });
});
