import "dotenv/config";
import { expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({generate:vi.fn()}));vi.mock("ai",()=>({generateObject:m.generate}));
vi.mock("./ai-runtime.service.js",()=>({resolveSceneRuntime:async()=>({primary:{languageModel:{}}})}));
vi.mock("./reference-fact-history.js",()=>({readReferenceFactHistory:async()=>[]}));
vi.mock("./query-clarification-context.js",async original=>({...await original<any>(),readQueryClarification:async()=>null}));
vi.mock("../thermal/thermal-query-dictionary.service.js",()=>({loadThermalQueryDictionary:async()=>({entities:[],aliases:[],sourceSets:[{id:"00000000-0000-4000-8000-000000000001",code:"A",name:"甲资料集",source:"甲表",reference:"页一"}]})}));
import {domainSemanticFixture} from "./domain-semantic.fixture.js";
import {resolveDomainTurn} from "./ai-domain-turn-decision.service.js";
it("先修正查询/计算错分后仍须完成独立来源绑定，保留厚度及原校验门槛",async()=>{
 const message="读取甲表板厚18mm的K值",id="00000000-0000-4000-8000-000000000001";
 const pageQuery={intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",readFields:["kValue"],sourceScope:{kind:"REFERENCE_SET",ids:[id],evidence:"甲表"},constraints:[{type:"THICKNESS",operation:"SET",field:null,entityText:null,resolvedText:null,metric:null,operator:"EXACT",value:18,evidence:"板厚18mm",hard:true,confidence:.95}],preferences:[],unresolved:[],confidence:.86};
 const original=domainSemanticFixture(message,"THERMAL_CALCULATE",{requestedEffect:"CALCULATE",confidence:.86,relation:"NEW",pageQuery:{...pageQuery,intent:"THERMAL"} as any,reference:{scope:"NONE",revision:null,items:[]}});
 const corrected=domainSemanticFixture(message,"REFERENCE_QUERY",{requestedEffect:"QUERY",confidence:.86,relation:"NEW",pageQuery:pageQuery as any,reference:{scope:"NONE",revision:null,items:[]}});
 m.generate.mockResolvedValueOnce({object:original}).mockResolvedValueOnce({object:corrected})
  .mockResolvedValueOnce({object:{operation:'SET',confidence:.95,evidence:'甲表'}})
  .mockResolvedValueOnce({object:{sourceReferenced:true,faithfulQuery:true,confidence:.95,evidence:"甲表",sourceLabels:["甲资料集"]}});
 const result=await resolveDomainTurn({app:{} as any,conversation:{id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat"} as any,userMessage:message});
 expect(result).toMatchObject({intent:"REFERENCE_QUERY",mutation:"QUERY",policyReason:"READ_ONLY_QUERY",semantic:{pageQuery:{confidence:.95,sourceScope:{ids:[id]},constraints:pageQuery.constraints}}});
 expect(m.generate).toHaveBeenCalledTimes(4);expect(result.semantic?.calculationRequest).toBeUndefined();
});
it("主提案高置信度自加来源也必须独立复核，不能只因带有效ID就限定查询",async()=>{
 m.generate.mockReset();
 const message="查询20毫米已有档位",id="00000000-0000-4000-8000-000000000001";
 const pageQuery={intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",readFields:["kValue"],sourceScope:{kind:"REFERENCE_SET",ids:[id],evidence:message},constraints:[{type:"THICKNESS",operation:"SET",field:null,entityText:null,resolvedText:null,metric:null,operator:"EXACT",value:20,evidence:"20毫米",hard:true,confidence:.99}],preferences:[],unresolved:[],confidence:.99};
 m.generate.mockResolvedValueOnce({object:domainSemanticFixture(message,"REFERENCE_QUERY",{requestedEffect:"QUERY",confidence:.99,relation:"NEW",pageQuery:pageQuery as any,reference:{scope:"NONE",revision:null,items:[]}})})
  .mockResolvedValueOnce({object:{operation:'KEEP',confidence:.95,evidence:null}});
 const result=await resolveDomainTurn({app:{} as any,conversation:{id:"c",userId:"u",clientApp:"c_app",projectId:null,scene:"general_chat"} as any,userMessage:message});
 expect(result).toMatchObject({intent:"REFERENCE_QUERY",mutation:"QUERY",semantic:{pageQuery:{sourceScope:null,constraints:pageQuery.constraints}}});
 expect(m.generate).toHaveBeenCalledTimes(2);
});
