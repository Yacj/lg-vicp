/** 补充验收：正式HTTP选择/Confirm→真实SSE报告授权→生产Processor/Chromium/隔离OSS。 */
import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema.js";
import { DEFAULT_REPORT_SECTIONS } from "../src/modules/reports/report-template.service.js";
import { createReportProcessor } from "../src/workers/report.worker.js";
import type { ObjectStorage } from "../src/storage/storage.js";
import { sendTurn } from "../tests/uat/sse.js";
import { seedCustomerParameterFixture } from "../tests/uat/customer-parameter-fixture.js";
import { redact } from "../tests/uat/report.js";
import { createUatEnvironment } from "../tests/uat/environment.js";
const out=path.resolve(`docs/ai/evidence/xiaoge-parameter-phase4/confirm-${new Date().toISOString().replaceAll(/[:.]/g,"-")}`);
await mkdir(out,{recursive:true});
const report:any={startedAt:new Date().toISOString(),scope:"仅随机隔离库、独立队列和OSS前缀；客户首表参考值",checks:[],status:"RUNNING"};
let environment:Awaited<ReturnType<typeof createUatEnvironment>>|undefined;
const objects=new Set<string>();
let baseStorage:ObjectStorage|undefined;
const ids=new Map<string,string>();
const save=()=>writeFile(path.join(out,"trace.json"),JSON.stringify(redact(report),null,2).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,id=>{if(!ids.has(id))ids.set(id,`ID_${ids.size+1}`);return ids.get(id)!;}));
try{
  environment=await createUatEnvironment();report.fixture=await seedCustomerParameterFixture(environment);
  const env=environment,db=env.db;baseStorage=env.app.storage;
  const key=(value:string)=>value.startsWith(`${env.prefix}/`)?value:`${env.prefix}/${value}`;
  // 所有读写都由测试注入的存储边界强制映射到随机前缀；不启动默认Worker或修改服务配置。
  const storage:ObjectStorage={provider:baseStorage.provider,bucket:baseStorage.bucket,
    ensureBucket:()=>Promise.reject(new Error("UAT不创建桶")),healthCheck:()=>baseStorage!.healthCheck(),
    createUploadUrl:(value,type,ttl)=>baseStorage!.createUploadUrl(key(value),type,ttl),
    createDownloadUrl:(value,name,ttl)=>baseStorage!.createDownloadUrl(key(value),name,ttl),
    createPreviewUrl:(value,ttl)=>baseStorage!.createPreviewUrl(key(value),ttl),
    statObject:value=>baseStorage!.statObject(key(value)),getObject:value=>baseStorage!.getObject(key(value)),
    putObject:async(value,data,type)=>{const actual=key(value);assert(actual.startsWith(`${env.prefix}/`));objects.add(actual);await baseStorage!.putObject(actual,data,type);},
    removeObject:value=>baseStorage!.removeObject(key(value))};
  env.app.storage=storage;
  await db.insert(s.reportTemplates).values({code:"standard_report",version:1,name:"客户资料隔离验收技术方案",status:"PUBLISHED",sectionsJson:DEFAULT_REPORT_SECTIONS,evidenceSource:"隔离模板布局",evidenceRef:"UAT-only"});
  const user=await env.createUser("SALES","confirm-pdf"),stranger=await env.createUser("SALES","confirm-stranger");
  const api=async(route:string,body?:unknown,token=user.token)=>{
    const response=await fetch(`${env.baseUrl}/api/v1/ai${route}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
    return await response.json() as any;
  };
  const requireData=(response:any)=>{assert(response.success,`API拒绝：${response.error?.code}/${response.error?.message}`);return response.data;};
  const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});assert(passed,name);};
  const conversation=requireData(await api("/conversations",{clientApp:"pc_ai",scene:"general_chat",title:"Confirm/PDF客户资料隔离验收"})).conversation;
  const base=`/conversations/${conversation.id}/solution`;
  let state=requireData(await api(base,{}));
  state=requireData(await api(`${base}/query`,{expectedVersion:state.version,query:{systemHint:"薄抹灰",filters:[{metric:"K",targetValue:.3,mode:"APPROX"}]}}));
  report.queried=state;
  check("真实客户表来源绑定后3个正式候选",state.poolCandidateIds.length===3);
  const early=await api(`${base}/actions`,{solutionStateId:state.id,action:"CONFIRM",expectedVersion:state.version,candidateSetRevision:state.candidateSetRevision});
  check("无Final不能Confirm",early.success===false);
  for(const action of ["SELECT","SET_FINAL","CONFIRM"]){
    const result=requireData(await api(`${base}/actions`,{solutionStateId:state.id,action,expectedVersion:state.version,candidateSetRevision:state.candidateSetRevision,...(action==="CONFIRM"?{}:{candidateIds:[state.poolCandidateIds[0]]})}));
    state=result.solutionState;report[action]=result;await save();
  }
  check("显式Confirm后冻结Snapshot",state.stage==="CONFIRMED"&&!!state.confirmedSnapshotId);
  const [frozen]=await db.select().from(s.solutionSnapshots).where(eq(s.solutionSnapshots.id,state.confirmedSnapshotId));
  const frozenText=JSON.stringify(frozen);
  check("其他用户不能读快照",(await api(`${base}/snapshots/${state.confirmedSnapshotId}`,undefined,stranger.token)).success===false);
  const events=await sendTurn(env.baseUrl,user.token,conversation.id,"生成这份已确认方案的正式技术方案PDF",()=>{});report.reportEvents=events;
  const queued=events.find(event=>event.event==="report_queued");check("本轮SSE明确授权后排队",!!queued);
  const reportId=String(queued!.data.reportId),taskId=String(queued!.data.taskId);
  const chromium=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
  assert(chromium,"没有已安装Chromium，真实PDF未执行");
  console.log("[Confirm UAT] 已确认快照，开始真实Chromium PDF和隔离OSS写入");
  const processor=createReportProcessor(db,storage,{executablePath:chromium});
  report.processor=await processor({data:{reportId,taskId},attemptsMade:0,opts:{attempts:1},updateProgress:async()=>{}} as any);
  check("生产Processor完成真实PDF",report.processor.status==="READY");
  const artifacts=await db.select({artifact:s.reportArtifacts,file:s.files}).from(s.reportArtifacts).innerJoin(s.files,eq(s.files.id,s.reportArtifacts.fileId)).where(eq(s.reportArtifacts.reportId,reportId));
  const pdf=artifacts.find(row=>row.artifact.type==="PDF");assert(pdf,"缺PDF产物");
  const bytes=await storage.getObject(pdf.file.objectKey);check("OSS真实PDF文件头",bytes.subarray(0,5).toString()==="%PDF-");
  await writeFile(path.join(out,"report.pdf"),bytes);report.pdfBytes=bytes.length;
  const [after]=await db.select().from(s.solutionSnapshots).where(eq(s.solutionSnapshots.id,state.confirmedSnapshotId));
  check("报告过程不改冻结快照",JSON.stringify(after)===frozenText);
  report.status="PASS";
}catch(error){report.status="FAIL";report.error=error instanceof Error?error.message:"UNKNOWN";console.log(`[Confirm UAT] FAIL ${report.error}`);}
finally{
  if(baseStorage&&environment)for(const value of objects){assert(value.startsWith(`${environment.prefix}/`));await baseStorage.removeObject(value).catch(()=>{report.cleanupObjectsFailed=true;});}
  if(environment)try{await environment.cleanup();report.cleanup="COMPLETED";}catch{report.cleanup="FAILED";}
  report.finishedAt=new Date().toISOString();await save();console.log(`[Confirm UAT] ${report.status} ${out}`);if(report.status!=="PASS"||report.cleanup!=="COMPLETED"||report.cleanupObjectsFailed)process.exitCode=1;
}
