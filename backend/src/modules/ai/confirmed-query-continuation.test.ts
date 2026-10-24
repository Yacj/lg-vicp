import "dotenv/config";
import { expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ query:vi.fn(),publish:vi.fn() }));
vi.mock("../thermal/thermal-query-dictionary.service.js",()=>({loadThermalQueryDictionary:async()=>({entities:[],aliases:[]})}));
vi.mock("./semantic-query.service.js",()=>({parseSemanticQuery:async()=>({query:{filters:[{metric:"K",operator:"APPROX",value:.3}]},needsClarification:false})}));
vi.mock("./solution-candidate-query.service.js",()=>({querySolutionCandidates:mocks.query}));
vi.mock("./candidate-result.service.js",()=>({publishCandidateResult:mocks.publish}));
vi.mock("./ai-reference-pages.service.js",()=>({resolveConfirmedReferenceAnswer:(text:string,pages:unknown[])=>({text,pages})}));
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
it("零正式候选的确认页成功查询保留实际体系、指标、来源，局部追问不能变成全库查询",async()=>{
 const query={systemHint:"正式体系",filters:[{metric:"K",operator:"APPROX",value:.3}],documentIds:["doc"],knowledgeVersionIds:["version"]};
 mocks.query.mockResolvedValue({queryState:query,outcome:{},candidates:[],nearbyRaw:[],nearbyCandidates:[],identityMatchedButMetricFailed:[],
 pages:{candidates:[],sources:[]},nearbyPages:{candidates:[]},identityPages:{candidates:[],sources:[]},matchedCount:0,
 readOnlyReferences:{query,authoritative:true,answer:"已核验只读值",pages:[]}});
 const ctx={app:{log:{info:vi.fn()}},conversation:{id:"c",userId:"u",projectId:null,clientApp:"c_app"},user:{id:"u"},request:{log:{info:vi.fn()}},
 taskState:{taskType:"GENERAL"},domainDecision:{intent:"REFERENCE_QUERY",mutation:"QUERY",semantic:{pageQuery:{constraints:[{type:"METRIC",value:.3}]}}}} as any;
 await resolveReferenceQueryWithoutAgent(ctx);
 expect(ctx.taskState.confirmedPageLookup).toMatchObject({query,conversationId:"c",userId:"u",projectId:null,clientApp:"c_app"});
 expect(mocks.publish).not.toHaveBeenCalled();expect(ctx.taskState.lastReferenceLookup).toBeUndefined();
});
it("正式来源零命中同样保留有效条件，不能退回旧候选的包含边界查询",async()=>{
 const query={queryContractVersion:2,referenceSetIds:["set"],filters:[{metric:"K",mode:"GT",targetValue:.2322}]};
 mocks.query.mockResolvedValue({queryState:query,outcome:{},candidates:[],nearbyRaw:[],nearbyCandidates:[],identityMatchedButMetricFailed:[],
  pages:{candidates:[],sources:[]},nearbyPages:{candidates:[]},identityPages:{candidates:[],sources:[]},matchedCount:0,
  readOnlyReferences:{authoritative:false,answer:"没有满足严格条件的记录",pages:[]}});
 const old={query:{filters:[{metric:"K",mode:"MAX_LIMIT",targetValue:.2322}]},candidates:[{id:"old",kValue:.2322}],candidateQueryRevision:1};
 const ctx={app:{log:{info:vi.fn()}},conversation:{id:"c",userId:"u",projectId:null,clientApp:"c_app"},user:{id:"u"},request:{log:{info:vi.fn()}},
  taskState:{taskType:"GENERAL",lastReferenceLookup:old},domainDecision:{intent:"REFERENCE_QUERY",mutation:"QUERY",semantic:{pageQuery:{constraints:[{type:"METRIC",value:.2322}]}}}} as any;
 await resolveReferenceQueryWithoutAgent(ctx);
 expect(ctx.taskState.confirmedPageLookup.requestQuery).toEqual(query);expect(ctx.taskState.lastReferenceLookup).toBe(old);expect(mocks.publish).not.toHaveBeenCalled();
});
