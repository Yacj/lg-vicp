/** 客户附件P0真实模型HTTP/SSE；业务写入限定随机临时库。 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import * as s from "../src/db/schema.js";
import { observeDomainSemantic } from "../src/modules/ai/ai-domain-turn-decision.service.js";
import { parseConversationTaskState } from "../src/modules/ai/conversation-task.js";
import { sendTurn } from "../tests/uat/sse.js";
import { seedCustomerParameterFixture, seedParameterScopeSentinels } from "../tests/uat/customer-parameter-fixture.js";
import { redact } from "../tests/uat/report.js";
import type { createUatEnvironment } from "../tests/uat/environment.js";
const groups: Array<[string,string[]]> = [
  ["Q01",["保温0.3有么","导热系数"]], ["Q02",["保温0.3有么","传热系数"]], ["Q03",["保温0.3有么","产品热阻"]],
  ["Q04",["薄膜灰导热系数0.3有么"]], ["Q05",["薄抹灰 K=0.3 有哪些构造"]], ["Q06",["保温薄抹灰0.3传热系数方案"]],
  ["Q07",["薄抹灰 0.3","K","改 0.28","那35mm呢"]], ["Q08",["VICP 复合保温板λ多少"]], ["Q09",["有λ=0.3产品吗"]],
  ["Q10",["介绍下VLCP一系列产品"]], ["Q11",["我不是工程师，请简单说说VICP"]], ["Q12",["薄抹灰屋面正置/倒置的20mm K"]],
  ["Q13",["55mm按公式重算K"]], ["Q14",["江苏这个K达标吗"]], ["Q15",["给个通用参考方案，不考虑地区"]],
  ["Q16",["直接生成正式PDF"]], ["Q17",["不要算，只给原表"]], ["Q18",["如果以后确认方案，能生成报告吗"]],
  ["SOURCE-INTRO",["我不是工程师，请简单介绍VICP复合保温板"]], ["AMBIGUOUS-NAME",["薄膜灰0.3系数的产品有么"]],
  ["SOURCE-ROOF",["I型VICP屋面保温系统平屋面正置/倒置20mm K"]],
  ["SOURCE-RAW",["薄抹灰 K0.3 有哪些构造","不要算，只给原表"]],
  ["SOURCE-SCOPE",["构造材料层的λ=0.3记录有吗"]]
];
const out=path.resolve(process.env.PARAMETER_UAT_OUTPUT??`docs/ai/evidence/xiaoge-parameter-phase4/${new Date().toISOString().replaceAll(/[:.]/g,"-")}`);
await mkdir(out,{recursive:true});
const report:any={startedAt:new Date().toISOString(),mode:"REAL_HTTP_SSE",repeatsQ01Q07:3,cases:[],permissions:[],limits:["客户知识库仅首表18档+第33表平屋面12档；非全图集","Confirm/Snapshot/PDF正向闭环须单列验收","不裁定Excel芯材R4.8/产品R5.0语义"]};
const ids=new Map<string,string>();
function sanitized(value:unknown){return JSON.parse(JSON.stringify(redact(value)).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,id=>{if(!ids.has(id))ids.set(id,`ID_${ids.size+1}`);return ids.get(id)!;}));}
const save=()=>writeFile(path.join(out,"trace.json"),JSON.stringify(sanitized(report),null,2));
let environment:Awaited<ReturnType<typeof createUatEnvironment>>|undefined;
let unobserve:(()=>unknown)|undefined;
try{
  const {createUatEnvironment}=await import("../tests/uat/environment.js");
  console.log("[参数UAT] 只读配置源；创建随机隔离库/Redis队列/OSS前缀");
  environment=await createUatEnvironment();report.fixture=await seedCustomerParameterFixture(environment);report.runtime=environment.runtimeConfig;
  let semanticTraces:unknown[]=[];unobserve=observeDomainSemantic(environment.app,trace=>semanticTraces.push(trace));
  const api=async(route:string,token:string,body?:unknown)=>{
    const response=await fetch(`${environment!.baseUrl}/api/v1/ai${route}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
    const value=await response.json() as any;if(!value.success)throw new Error(`API ${response.status}/${value.error?.code}`);return value.data;
  };
  const protectedCounts=async()=>({snapshots:(await environment!.db.select({value:count()}).from(s.solutionSnapshots))[0]!.value,reports:(await environment!.db.select({value:count()}).from(s.reports))[0]!.value,calculations:(await environment!.db.select({value:count()}).from(s.thermalCalcRecords))[0]!.value});
  const selectedCase=process.argv.find(arg=>arg.startsWith("--case="))?.slice(7);
  if(!selectedCase||selectedCase==="SOURCE-SCOPE")report.permissionSentinels=await seedParameterScopeSentinels(environment);
  for(const [group,messages] of groups.filter(([group])=>!selectedCase||selectedCase===group))for(let repetition=1;repetition<=(Number(group.slice(1))<=7?3:1);repetition++){
    const user=await environment.createUser("SALES",`${group}-${repetition}`);
    const created=await api("/conversations",user.token,{clientApp:"pc_ai",scene:"general_chat",title:`参数隔离验收 ${group}-${repetition}`,reasoningMode:"OFF"});
    const conversationId=created.conversation.id;
    for(const [index,message] of messages.entries()){
      const record:any={group,repetition,turn:index+1,userMessage:message,label:"REPRODUCED_TEST",status:"RUNNING",checks:[]};report.cases.push(record);await save();
      const progress=setInterval(()=>console.log(`[参数UAT] ${group}/${repetition}/${index+1} 等待真实模型`),30_000);
      try{
        const [prior]=await environment.db.select().from(s.aiConversationStates).where(eq(s.aiConversationStates.conversationId,conversationId));record.priorQuery=parseConversationTaskState(prior?.taskStateJson);
        const before=await protectedCounts();semanticTraces=[];
        const events=await sendTurn(environment.baseUrl,user.token,conversationId,message,()=>{});
        const done=events.find(event=>event.event==="done")!;
        const [answer]=await environment.db.select().from(s.aiMessages).where(eq(s.aiMessages.id,String(done.data.messageId)));
        const [state]=await environment.db.select().from(s.aiConversationStates).where(eq(s.aiConversationStates.conversationId,conversationId));
        const task=parseConversationTaskState(state?.taskStateJson),decision=(answer!.metadata as any).backendDecision;
        const query=task.confirmedPageLookup?.query??task.lastReferenceLookup?.query;
        Object.assign(record,{semanticAttempts:semanticTraces,backendDecision:decision,query,answer:answer!.content,events,task});
        record.tools=await environment.db.select().from(s.aiToolCalls).where(eq(s.aiToolCalls.messageId,answer!.id));
        record.sourceScope={catalog:"ACTIVE",specification:"PUBLISHED/EFFECTIVE",knowledge:"CURRENT/PUBLISHED/AI_ENABLED/PLATFORM",fixture:report.fixture.scope};
        const check=(name:string,passed:boolean)=>record.checks.push({name,passed});
        check("不自动生成快照/报告/计算",JSON.stringify(before)===JSON.stringify(await protectedCounts()));check("非正式方案写入",decision.solutionStateMutated===false);
        const filters=query?.filters??[];
        if(["Q01","Q02","Q03"].includes(group)&&index===0)check("只澄清真实缺失指标",decision.domainIntent==="CLARIFY"&&!answer!.content.includes("实际基层"));
        if(group==="Q01"&&index===1)check("继承0.3独立λ查询",decision.domainIntent==="PRODUCT_PARAMETER_QUERY"&&decision.parameterQuery?.targetValue===.3&&decision.toolRoute?.includes("backend:product_parameter_query")&&!answer!.content.includes("基层"));
        if(group==="Q02"&&index===1||group==="Q05"||group==="Q06"){
          check("K0.3只读查询",["REFERENCE_QUERY","REFERENCE_REFINE"].includes(decision.domainIntent)&&filters.some((f:any)=>f.metric==="K"&&f.targetValue===.3));
          const mode=filters.find((f:any)=>f.metric==="K")?.mode;
          check("客户表匹配模式准确",mode==="EXACT" ? decision.referenceQueryDiagnostics?.matchedCount===0
            : decision.referenceQueryDiagnostics?.matchedCount===(group==="Q02"?5:3)&&decision.referencePageIds?.length>0);
        }
        if(group==="Q03"&&index===1)check("PRODUCT_R0.3无芯材替代",filters.length===1&&filters[0]!.metric==="PRODUCT_R"&&filters[0]!.targetValue===.3&&decision.referenceQueryDiagnostics?.matchedCount===0);
        if(group==="Q04")check("λ已明确且名称不擅改",(decision.parameterQuery?.systemText==="薄膜灰"||decision.parameterQuery?.subjectText==="薄膜灰")&&decision.parameterQueryDiagnostics?.issues?.includes("NAME_UNRESOLVED"));
        if(group==="Q07"&&index>0)check("局部纠正/厚度继承",filters.some((f:any)=>f.metric==="K"&&f.targetValue===(index===1?.3:.28))&&(index!==3||query?.thicknessMm===35));
        if(group==="Q08")check("正式产品λ来源",decision.domainIntent==="PRODUCT_PARAMETER_QUERY"&&answer!.content.includes("0.005"));
        if(group==="Q09")check("λ0.3无匹配不放宽",decision.parameterQueryDiagnostics?.issues?.includes("VALUE_NO_MATCH")&&decision.parameterQueryDiagnostics.matchedCount===0);
        if(group==="Q10")check("VLCP无正式别名不能替成VICP",decision.productQueryDiagnostics?.reason==="NAME_UNRESOLVED"&&decision.productAnswerFacts?.products.length===0);
        if(group==="Q11"||group==="SOURCE-INTRO")check("介绍不强制堆参数",!answer!.content.includes("λ=")&&!answer!.content.includes("α="));
        if(group==="Q12")check("体系线索不擅自联结屋面",query?.systemHint?.includes("薄抹灰")===true&&decision.referenceQueryDiagnostics?.matchedCount===0);
        if(group==="SOURCE-ROOF")check("屋面同值正倒置保留两身份",decision.referenceQueryDiagnostics?.matchedCount===2&&decision.referencePageIds?.length>0);
        if(group==="SOURCE-RAW"&&index===1)check("有效历史只读原表不计算",decision.referencePageIds?.length>0&&decision.requestedEffect!=="CALCULATE");
        if(group==="SOURCE-SCOPE")check("六种不可读λ哨兵全部排除",decision.parameterQuery?.subjectType==="MATERIAL_LAYER"&&decision.parameterQuery?.subjectText==null
          &&decision.parameterQueryDiagnostics?.scannedCount===18&&decision.parameterQueryDiagnostics?.identityCount===6&&decision.parameterQueryDiagnostics?.matchedCount===0&&decision.parameterQueryDiagnostics?.issues?.includes("VALUE_NO_MATCH"));
        if(group==="Q16")check("正式报告请求保留受Snapshot门禁",decision.domainIntent==="REPORT_REQUEST"&&!decision.reportQueued);
        if(group==="Q18")check("假设报告只解释",decision.requestedEffect==="READ_ONLY"&&!decision.reportQueued);
        record.status=record.checks.every((item:any)=>item.passed)?"PASS":"FAIL";
        console.log(`[参数UAT] ${group}/${repetition}/${index+1} ${record.status} ${decision.domainIntent}/${decision.policyReason}`);
      }catch(error){record.status="FAIL";record.error=error instanceof Error?error.name:"UNKNOWN";record.semanticAttempts=semanticTraces;console.log(`[参数UAT] ${group}/${repetition}/${index+1} FAIL ${record.error}`);}
      finally{clearInterval(progress);await save();}
    }
    const stranger=await environment.createUser("SALES",`${group}-stranger`);
    const response=await fetch(`${environment.baseUrl}/api/v1/ai/conversations/${conversationId}`,{headers:{Authorization:`Bearer ${stranger.token}`}});
    const denied=await response.json() as any;report.permissions.push({group,repetition,foreignConversationDenied:denied.success===false});
    if(group==="SOURCE-SCOPE"){
      const token=environment.app.jwt.sign({sub:user.id,tokenType:"access",clientType:"C_APP",aud:"client",role:"NORMAL_USER",jti:"isolated-client-negative"},{expiresIn:"5m"});
      const otherClient=await fetch(`${environment.baseUrl}/api/v1/ai/conversations/${conversationId}`,{headers:{Authorization:`Bearer ${token}`}});
      report.permissions.push({group,crossClientDenied:(await otherClient.json() as any).success===false});
    }
  }
}catch(error){report.environmentError=error instanceof Error?error.message:"UNKNOWN";report.status="BLOCKED";console.log(`[参数UAT] BLOCKED ${report.environmentError}`);}
finally{
  unobserve?.();if(environment)try{await environment.cleanup();report.cleanup="COMPLETED";}catch{report.cleanup="FAILED";}
  report.finishedAt=new Date().toISOString();report.summary={executed:report.cases.length,passed:report.cases.filter((r:any)=>r.status==="PASS").length,failed:report.cases.filter((r:any)=>r.status==="FAIL").length,
    permissionFailures:report.permissions.filter((r:any)=>r.foreignConversationDenied===false||r.crossClientDenied===false).length};
  await save();console.log(`[参数UAT] ${JSON.stringify(report.summary)}；${out}`);if(report.environmentError||report.summary.failed||report.summary.permissionFailures||report.cleanup==="FAILED")process.exitCode=1;
}
