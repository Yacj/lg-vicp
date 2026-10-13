import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull, or, count } from "drizzle-orm";
import { Redis } from "ioredis";
import { generateObject } from "ai";
import { z } from "zod";
import { env } from "../src/config/env.js";
import * as s from "../src/db/schema.js";
import { loadThermalQueryDictionary } from "../src/modules/thermal/thermal-query-dictionary.service.js";
import { queryThermalCandidates } from "../src/modules/thermal/thermal-candidate.service.js";
import { resolveScopedThermalStandard } from "../src/modules/thermal/thermal-standard-scope.service.js";
import { resolveProductConsultation } from "../src/modules/ai/product-read.service.js";
import { resolveComplianceRead } from "../src/modules/ai/compliance-read.service.js";
import { domainDecision } from "../src/modules/ai/ai-domain-turn-decision.js";
import { resolveSceneRuntime } from "../src/modules/ai/ai-runtime.service.js";
import { createObjectStorage } from "../src/storage/index.js";
import { publishedReferenceConditions } from "../src/modules/construction/construction-structure.service.js";

const output: Record<string, unknown> = {startedAt:new Date().toISOString(),mode:"PRODUCTION_READ_ONLY",checks:[]};
const checks = output.checks as Array<Record<string, unknown>>;
const record = (name:string,status:string,details:unknown={}) => { const item={name,status,details}; checks.push(item);console.log(JSON.stringify(item)); };
const errorInfo = (error:unknown) => ({errorType:error instanceof Error?error.name:"UNKNOWN",errorCode:(error as {code?:unknown;statusCode?:unknown})?.code,statusCode:(error as {statusCode?:unknown})?.statusCode,
  noHostRule:error instanceof Error&&/pg_hba/.test(error.message),sslOffMentioned:error instanceof Error&&/SSL off|no encryption/i.test(error.message),passwordRejected:error instanceof Error&&/password authentication failed/i.test(error.message)});
// Startup参数对每个连接强制只读，所有业务方法即使误写也由PostgreSQL拒绝。
const configuredUrl=new URL(env.DATABASE_URL);
record("连接配置（脱敏）","INFO",{urlSslMode:["require","verify-full","verify-ca","prefer","disable"].includes(configuredUrl.searchParams.get("sslmode")??"")?configuredUrl.searchParams.get("sslmode"):"UNSPECIFIED",explicitSslRetry:process.env.DOMAIN_READONLY_SSL==="require"});
const sql=postgres(env.DATABASE_URL,{max:2,connect_timeout:5,onnotice:()=>{},...(process.env.DOMAIN_READONLY_SSL==="require"?{ssl:"require" as const}:{}),connection:{default_transaction_read_only:"on",application_name:"vicp-domain-readonly-check"}});
const db=drizzle(sql,{schema:s});
const app={db,log:{warn:()=>{},info:()=>{}}} as any;
const dependencyRedis=new Redis(env.REDIS_URL,{lazyConnect:true,retryStrategy:()=>null,connectTimeout:3000,maxRetriesPerRequest:0});dependencyRedis.on("error",()=>{});
try{await dependencyRedis.connect();await dependencyRedis.ping();record("Redis只读PING","PASS");}catch(error){record("Redis只读PING","BLOCKED",errorInfo(error));}finally{dependencyRedis.disconnect();}
try{
  const metadata=await createObjectStorage(env).statObject("codex-readonly-connectivity-probe-not-created");
  record("对象存储签名HEAD检查","ENDPOINT_PASS",{provider:env.STORAGE_PROVIDER,probeObjectExists:metadata!==null,actualSourceDownload:"NOT RUN"});
}catch(error){record("对象存储签名HEAD检查","BLOCKED",errorInfo(error));}
try {
  const [proof]=await sql`select current_setting('transaction_read_only') as read_only, (select rolcreatedb from pg_roles where rolname=current_user) as can_create_isolated_database`;
  if(proof?.read_only!=="on")throw new Error("READ_ONLY_REQUIRED");
  record("PostgreSQL","PASS",proof);
  const [counts]=await sql`select (select count(*) from catalog_products where status='ACTIVE')::int as active_products,
    (select count(*) from thermal_reference_sets where status='PUBLISHED')::int as published_reference_sets,
    (select count(*) from thermal_reference_rows)::int as reference_rows,
    (select count(*) from thermal_standard_limits where status='PUBLISHED')::int as published_limits,
    (select count(*) from ai_models where enabled=true and last_test_status='PASSED')::int as admitted_models`;
  record("正式数据概况","PASS",counts);
  const dictionary=await loadThermalQueryDictionary(db);
  record("正式目录与别名读取","PASS",{entities:dictionary.entities.length,aliases:dictionary.aliases.length});
  const candidateQuery=await queryThermalCandidates(app,{} as any,{id:"readonly-audit",role:"NORMAL_USER",clientType:"PC_AI"} as any,{filters:[{metric:"K",targetValue:.3,mode:"APPROX"}],neighborTolerance:1,limit:12} as any);
  record("真实正式K近似查表","PASS",{found:candidateQuery.candidates.length>0,returned:candidateQuery.candidates.length,missingConditions:candidateQuery.missingConditions,
    values:candidateQuery.candidates.slice(0,4).map((candidate:any)=>({schemeCode:candidate.schemeCode,thicknessMm:candidate.thicknessMm,kValue:candidate.kValue,productThermalResistance:candidate.productThermalResistance,totalThermalResistance:candidate.totalThermalResistance,substrateMaterial:candidate.substrateMaterial}))});
  const limits=await db.select().from(s.thermalStandardLimits).where(and(...publishedReferenceConditions(s.thermalStandardLimits))).limit(12);
  let applicable=0;
  for(const limit of limits){
    const scopes=await db.select().from(s.standardApplicability).where(and(eq(s.standardApplicability.documentId,limit.standardDocumentId??"00000000-0000-0000-0000-000000000000"),...publishedReferenceConditions(s.standardApplicability)));
    for(const scope of scopes){ if(!scope.buildingTypes.length)continue;
      const checked=await resolveScopedThermalStandard(db,{regionCode:limit.regionCode,buildingType:scope.buildingTypes[0],structureType:scope.structureTypes[0],standardLimitId:limit.id});
      if(checked.limit) applicable++;
    }
  }
  record("正式标准适用范围核验",applicable?"PASS":"DATA_UNAVAILABLE",{publishedSample:limits.length,applicableSample:applicable});
  // 只读服务使用一个实际存在且有效的无项目会话；不读取私人消息、不伪造或写入会话。
  const sessions=await db.select({id:s.aiConversations.id,userId:s.aiConversations.userId,clientApp:s.aiConversations.clientApp,projectId:s.aiConversations.projectId}).from(s.aiConversations)
    .where(and(eq(s.aiConversations.status,"active"),isNull(s.aiConversations.deletedAt),isNull(s.aiConversations.projectId),or(eq(s.aiConversations.clientApp,"pc_ai"),eq(s.aiConversations.clientApp,"c_app")))).limit(1);
  if(sessions[0]){
    const conversation=sessions[0];const user={id:conversation.userId,role:"NORMAL_USER",clientType:conversation.clientApp==="pc_ai"?"PC_AI":"C_APP"} as any;
    const context={app,request:{} as any,user,conversation:conversation as any,userMessage:"你们有哪些产品",domainDecision:domainDecision("PRODUCT_DISCOVERY","你们有哪些产品"),taskState:{taskType:"GENERAL" as const}};
    const products=await resolveProductConsultation(context);
    record("真实无ProductId产品咨询","PASS",{returned:products.products.length,hasMore:products.hasMore,needsClarification:products.needsClarification,fields:products.products.slice(0,3).map(p=>({name:p.name,specClass:p.specClass,productType:p.productType,specifications:p.specifications.length,linkedPublishedSources:p.knowledgeDocumentIds.length}))});
    const scopeEntity=dictionary.entities.find(item=>item.field==="regionCode");const building=dictionary.entities.find(item=>item.field==="buildingType");
    const message=scopeEntity&&building?`${scopeEntity.names[0]}${building.names[0]}K0.3是否达标` : "K0.3是否达标";
    const compliance=await resolveComplianceRead({...context,userMessage:message,domainDecision:domainDecision("COMPLIANCE_CHECK",message)});
    record("真实只读合规咨询","PASS",{result:compliance.compliance,answer:compliance.facts.canonicalAnswers[0],sources:compliance.sources.length});
  }else record("真实会话归属的只读服务","NOT RUN",{reason:"没有无项目的有效C/PC会话；未新增会话"});
  const pages=await db.select({objectKey:s.knowledgePages.pageImageObjectKey}).from(s.knowledgePages).innerJoin(s.knowledgeDocuments,eq(s.knowledgeDocuments.id,s.knowledgePages.documentId))
    .innerJoin(s.knowledgeDocumentVersions,and(eq(s.knowledgeDocumentVersions.id,s.knowledgePages.versionId),eq(s.knowledgeDocumentVersions.id,s.knowledgeDocuments.currentVersionId)))
    .where(and(isNull(s.knowledgeDocuments.projectId),eq(s.knowledgeDocuments.status,"ACTIVE"),isNull(s.knowledgeDocuments.deletedAt),eq(s.knowledgeDocumentVersions.status,"PUBLISHED"))).limit(1);
  if(pages[0]?.objectKey)try{const bytes=await createObjectStorage(env).getObject(pages[0].objectKey);record("对象存储实际只读下载","PASS",{provider:env.STORAGE_PROVIDER,bytes:bytes.length});}catch(error){record("对象存储实际只读下载","BLOCKED",errorInfo(error));}
  else record("对象存储实际只读下载","NOT RUN",{reason:"未找到当前发布公共原页图片"});
  try{
    const runtime=await resolveSceneRuntime(db,"general_chat","OFF");
    const generated=await generateObject({model:runtime.primary.languageModel,schema:z.object({ok:z.boolean()}),system:"只输出JSON，返回ok为true。",prompt:"这是连接复测，请返回{\"ok\":true}。",maxRetries:0,abortSignal:AbortSignal.timeout(30000)});
    record("正式模型实际JSON请求",generated.object.ok?"PASS":"FAIL",{model:runtime.primary.modelId});
  }catch(error){record("正式模型实际JSON请求","BLOCKED",errorInfo(error));}
}catch(error){record("线上只读复测","BLOCKED",errorInfo(error));process.exitCode=1;}
finally{
  await sql.end({timeout:5});output.finishedAt=new Date().toISOString();await mkdir("logs/domain-online-check",{recursive:true});
  await writeFile("logs/domain-online-check/readonly.json",JSON.stringify(output,null,2));
}
