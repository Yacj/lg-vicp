import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({generate:vi.fn()}));vi.mock("ai",()=>({generateObject:m.generate}));
import { reviewSourceQuery, reviewMissingQuerySource, sourceReviewCacheKey } from "./source-query-review.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const message="查看甲表中基层180毫米的记录";
const sources=[{id,name:"甲资料集",code:"SOURCE-A",source:"甲表",reference:"页一"},{id:other,name:"乙资料集",code:"SOURCE-B",source:"乙表",reference:"页二"}];
function proposal(){return domainSemanticFixture(message,"REFERENCE_QUERY",{relation:"NEW",requestedEffect:"QUERY",confidence:.86,
 pageQuery:{intent:"REFERENCE_LOOKUP",queryMode:"NEW_QUERY",constraints:[],preferences:[],unresolved:[],confidence:.86,sourceScope:{kind:"REFERENCE_SET",ids:[id],evidence:"甲表"}},reference:{scope:"NONE",revision:null,items:[]}})}
beforeEach(()=>{vi.resetAllMocks();m.generate.mockResolvedValue({object:{faithfulQuery:true,confidence:.95,evidence:"甲表",sourceLabels:["甲资料集"]}})});
it("来源遗漏复核不接收其他职责的置信度，原查询和阈值保持不变",async()=>{
 const original={...proposal().pageQuery!,sourceScope:null};
 m.generate.mockResolvedValue({object:{operation:"KEEP",confidence:.95,evidence:null}});
 const result=await reviewMissingQuerySource({} as any,"看看外墙参考做法",original,sources,AbortSignal.timeout(1000));
 expect(result).toBe(original);expect(result.confidence).toBe(.86);
 const input=JSON.parse(m.generate.mock.calls[0]![0].prompt);expect(input).toEqual({message:"看看外墙参考做法"});
 m.generate.mockResolvedValueOnce({object:{operation:"KEEP",confidence:.89,evidence:null}});
 expect((await reviewMissingQuerySource({} as any,"看看外墙参考做法",original,sources,AbortSignal.timeout(1000))).unresolved).toHaveLength(1);
});
it("已有来源提案也不将上游ID传给独立复核，不明确限制来源时取消模型自加范围",async()=>{
 const original={...proposal().pageQuery!,confidence:.99};
 m.generate.mockResolvedValue({object:{operation:"KEEP",confidence:.95,evidence:null}});
 const actual=await reviewMissingQuerySource({} as any,"查屋面20毫米档",original,sources,AbortSignal.timeout(1000));
 expect(actual.sourceScope).toBeNull();expect(actual.constraints).toBe(original.constraints);
 const input=JSON.parse(m.generate.mock.calls[0]![0].prompt);expect(input).not.toHaveProperty('query');expect(input).not.toHaveProperty('sourceLabels');expect(JSON.stringify(input)).not.toContain(id);
});
it("来源名称由当前集合绑定真实ID，复核后仍保留原条件，独立评估不复制主模型置信度",async()=>{
 const original=proposal();const result=await reviewSourceQuery({} as any,message,original,sources,AbortSignal.timeout(1000));
 expect(result?.pageQuery).toMatchObject({confidence:.95,sourceScope:{ids:[id],evidence:"甲表"}});expect(result?.pageQuery?.constraints).toEqual(original.pageQuery!.constraints);
 const input=JSON.parse(m.generate.mock.calls[0]![0].prompt);expect(input.query.confidence).toBeUndefined();expect(input.query.sourceScope.ids).toBeUndefined();expect(JSON.stringify(input)).not.toContain(id);
});
it("不能接受未发布/虚构来源、改变来源集合或伪造用户来源证据",async()=>{
 for(const object of [{faithfulQuery:true,confidence:.95,evidence:"甲表",sourceLabels:["不存在"]},{faithfulQuery:true,confidence:.95,evidence:"甲表",sourceLabels:["乙资料集"]},{faithfulQuery:true,confidence:.95,evidence:"编造的引用",sourceLabels:["甲资料集"]}]){
  m.generate.mockResolvedValueOnce({object});expect(await reviewSourceQuery({} as any,message,proposal(),sources,AbortSignal.timeout(1000))).toBeUndefined();
 }
});
it("含糊来源、原条件不忠实或重复显示名均不签发绑定，也不补足置信度",async()=>{
 for(const object of [{faithfulQuery:false,confidence:.95,evidence:"甲表",sourceLabels:["甲资料集"]},{faithfulQuery:true,confidence:.86,evidence:"甲表",sourceLabels:["甲资料集"]}]){
  m.generate.mockResolvedValueOnce({object});expect(await reviewSourceQuery({} as any,message,proposal(),sources,AbortSignal.timeout(1000))).toBeUndefined();
 }
 expect(await reviewSourceQuery({} as any,message,proposal(),[...sources,{...sources[0]!,id:other}],AbortSignal.timeout(1000))).toBeUndefined();
});
it("来源复核不能把方案操作转换为查询或使用原提案未授权的ID",async()=>{
 expect(await reviewSourceQuery({} as any,message,{...proposal(),intent:"SOLUTION_ACTION",requestedEffect:"STATE_MUTATION"},sources,AbortSignal.timeout(1000))).toBeUndefined();
 expect(await reviewSourceQuery({} as any,message,proposal(),[],AbortSignal.timeout(1000))).toBeUndefined();expect(m.generate).not.toHaveBeenCalled();
});
it("没有来源变更的续问只做来源存在性判断，不发送工程条件或候选ID，原条件由Backend保留",async()=>{
 const original={...proposal().pageQuery!,queryMode:'REFINE_QUERY' as const,sourceScope:null,constraints:[]};
 m.generate.mockResolvedValue({object:{operation:"KEEP",confidence:.95,evidence:null}});
 const previous={schemeCode:'WALL-X',schemeId:'private-id',thicknessMin:25,thicknessMinExclusive:true,filters:[{metric:'K' as const,mode:'LT' as const,targetValue:.3}]};
 await reviewMissingQuerySource({} as any,'沿用条件重新查询',original,sources,AbortSignal.timeout(1000),previous);
 const input=JSON.parse(m.generate.mock.calls[0]![0].prompt);
 expect(input).toEqual({message:'沿用条件重新查询'});expect(JSON.stringify(input)).not.toContain('private-id');expect(m.generate).toHaveBeenCalledTimes(1);
});
it("先确认来源要求再绑定名称，只有第二阶段消费有效工程历史，不能把目录存在当用户指定",async()=>{
 const original={...proposal().pageQuery!,queryMode:'REFINE_QUERY' as const,sourceScope:null};
 const previous={thicknessMin:25,thicknessMinExclusive:true,filters:[{metric:'K' as const,mode:'LT' as const,targetValue:.3}],referenceSetIds:[id]};
 m.generate.mockResolvedValueOnce({object:{operation:'SET',confidence:.97,evidence:'甲表'}})
  .mockResolvedValueOnce({object:{sourceReferenced:true,faithfulQuery:true,confidence:.95,evidence:'甲表',sourceLabels:['甲资料集']}});
 const actual=await reviewMissingQuerySource({} as any,message,original,sources,AbortSignal.timeout(1000),previous);
 expect(actual.sourceScope?.ids).toEqual([id]);
 const first=JSON.parse(m.generate.mock.calls[0]![0].prompt),second=JSON.parse(m.generate.mock.calls[1]![0].prompt);
 expect(first).toEqual({message});expect(second.inheritedConditions).toMatchObject({thicknessMin:25,thicknessMinExclusive:true,filters:previous.filters});
 expect(second.verifiedSourceMention).toBe('甲表');expect(second.query).not.toHaveProperty('sourceScope');expect(second.query.confidence).toBeUndefined();
});
it("当前来源只从Backend有效历史继承，无历史/新查询/撤回来源不能由模型猜身份",async()=>{
 const original={...proposal().pageQuery!,queryMode:'REFINE_QUERY' as const};
 m.generate.mockResolvedValue({object:{operation:'CURRENT',confidence:.95,evidence:'刚才那份'}});
 const actual=await reviewMissingQuerySource({} as any,'只查刚才那份',original,sources,AbortSignal.timeout(1000),{referenceSetIds:[id]});
 expect(actual.sourceScope).toBeNull();expect(actual.constraints).toBe(original.constraints);expect(m.generate).toHaveBeenCalledTimes(1);
 for(const [query,previous] of [[original,undefined],[{...original,queryMode:'NEW_QUERY' as const},{referenceSetIds:[id]}],[original,{referenceSetIds:['withdrawn']}]] as const)
  expect((await reviewMissingQuerySource({} as any,'只查刚才那份',query,sources,AbortSignal.timeout(1000),previous)).unresolved).toContainEqual(expect.objectContaining({field:'sourceScope'}));
});
it("KEEP与本轮明确文件线索矛盾时追加完整复核，只有真实合格来源/查询结果可绑定",async()=>{
 const original={...proposal().pageQuery!,sourceScope:null};
 const excel=[{...sources[0]!,code:'SOURCE-EXCEL',source:'甲表.xlsx',reference:'Sheet1'}];
 m.generate.mockResolvedValueOnce({object:{operation:'KEEP',evidence:null,confidence:.95}})
  .mockResolvedValueOnce({object:{sourceReferenced:true,faithfulQuery:true,confidence:.94,evidence:'Excel',sourceLabels:['甲资料集']}});
 const result=await reviewMissingQuerySource({} as any,'按Excel查参考行',original,excel,AbortSignal.timeout(1000));
 expect(result.sourceScope).toMatchObject({ids:[id],evidence:'Excel'});expect(result.confidence).toBe(.94);expect(result.constraints).toBe(original.constraints);
 expect(m.generate).toHaveBeenCalledTimes(2);
 m.generate.mockResolvedValueOnce({object:{operation:'KEEP',evidence:null,confidence:.99}})
  .mockResolvedValueOnce({object:{sourceReferenced:true,faithfulQuery:false,confidence:.99,evidence:'Excel',sourceLabels:['甲资料集']}});
 expect((await reviewMissingQuerySource({} as any,'按Excel查参考行',original,excel,AbortSignal.timeout(1000))).unresolved).toContainEqual(expect.objectContaining({field:'sourceScope'}));
});
it("同轮来源核验键不受置信度/上游来源表示影响；工程条件或原话变化仍独立核验",()=>{
 const original=proposal().pageQuery!;
 expect(sourceReviewCacheKey(message,original)).toBe(sourceReviewCacheKey(message,{...original,confidence:.99,sourceScope:null}));
 expect(sourceReviewCacheKey(message,original)).not.toBe(sourceReviewCacheKey(message+'再改条件',original));
 expect(sourceReviewCacheKey(message,original)).not.toBe(sourceReviewCacheKey(message,{...original,readFields:['layers']}));
});
