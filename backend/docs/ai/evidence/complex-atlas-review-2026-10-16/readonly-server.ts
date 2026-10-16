/** 审计专用：复用已知历史隔离库，DB强制只读、仅GET、对象仅get/stat/签名。无建库/迁移/消息/发布/删除。 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import * as s from "../../../../src/db/schema.js";
import { env } from "../../../../src/config/env.js";
import { createObjectStorage } from "../../../../src/storage/index.js";
import { authPlugin } from "../../../../src/plugins/auth.js";
import { errorHandlerPlugin } from "../../../../src/plugins/error-handler.js";
import { knowledgeRoutes } from "../../../../src/modules/knowledge/knowledge.routes.js";
import { aiKnowledgeRoutes } from "../../../../src/modules/ai/ai-knowledge.routes.js";
import { loadPublishedKnowledgeReferences } from "../../../../src/modules/ai/ai-reference-pages.service.js";
import { loadKnowledgeTestReferences } from "../../../../src/modules/knowledge/knowledge-test-reference.js";

const output=path.resolve("docs/ai/evidence/complex-atlas-review-2026-10-16");
const historical=JSON.parse(await readFile("docs/ai/evidence/complex-atlas-fixes-2026-10-16/real-attempt4/report.json","utf8"));
assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(historical.isolation.database));
const url=new URL(env.DATABASE_URL); url.pathname=`/${historical.isolation.database}`;
const client=postgres(url.toString(),{max:5,onnotice:()=>{},connect_timeout:5,connection:{options:"-c default_transaction_read_only=on -c statement_timeout=10000"}});
const app=Fastify({logger:false});
const storage=createObjectStorage(env);
const bridgeFile=path.join(os.tmpdir(),`atlas-readonly-review-${randomUUID()}.json`);
const blocked:string[]=[];
const report:any={scope:"当前代码+历史隔离库只读GET/共享查询；没有自然模型、消息写入、审核/发布或迁移",databaseReadOnly:true,storageProvider:storage.provider,checks:[],shared:[],errors:[]};
try {
  assert.equal((await client`show transaction_read_only`)[0]!.transaction_read_only,"on");
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  app.decorate("db",drizzle(client,{schema:s})); app.decorate("sqlClient",client);
  app.decorate("redis",{exists:async()=>{throw new Error("审计禁用Redis访问");}} as any);
  app.decorate("storage",new Proxy(storage,{get(target,property){
    const value=Reflect.get(target,property);
    if(typeof value!=="function")return value;
    if(!["statObject","getObject","createDownloadUrl"].includes(String(property)))return()=>{blocked.push(String(property));throw new Error("审计禁止对象写入");};
    return (key:string,...args:unknown[])=>value.call(target,key.startsWith(`${historical.isolation.prefix}/`)?key:`${historical.isolation.prefix}/${key}`,...args);
  }}));
  app.addHook("onError",async(request,_reply,error)=>{report.errors.push({path:request.url.split("?")[0],name:error.name,code:(error as any).code,causeCode:(error as any).cause?.code,status:(error as any).status});});
  app.addHook("onRequest",async(request,reply)=>{if(request.method!=="GET")return reply.code(405).send({success:false,error:{code:405,message:"审计服务仅允许GET，不执行消息、审核或发布"}});});
  await app.register(errorHandlerPlugin); await app.register(authPlugin);
  await app.register(knowledgeRoutes,{prefix:"/api/v1/platform/knowledge"});
  await app.register(aiKnowledgeRoutes,{prefix:"/api/v1/ai/knowledge"});
  const base=await app.listen({host:"127.0.0.1",port:0});
  const access=await app.db.select().from(s.userAppAccess);
  const admin=access.find(a=>a.app==="ADMIN"&&a.role==="SUPER_ADMIN"&&a.status==="ACTIVE");
  const normal=access.find(a=>a.app==="CLIENT"&&a.status==="ACTIVE"); assert(admin&&normal);
  const adminToken=app.jwt.sign({sub:admin.userId,tokenType:"access",clientType:"B_ADMIN",aud:"admin"},{expiresIn:"30m"});
  const clientToken=app.jwt.sign({sub:normal.userId,tokenType:"access",clientType:"C_APP",aud:"client"},{expiresIn:"30m"});
  const pages=Object.fromEntries(await Promise.all(["89","90","75"].map(async label=>[label,historical.cases.flatMap((c:any)=>c.pages??[]).find((p:any)=>p.page?.pageLabel===label)?.page.pageId])));
  assert(Object.values(pages).every(Boolean));
  const documentId=historical.fixture.documentId,versionId=historical.fixture.versionId;
  for(const label of ["89","90","75"]) {
    const pageId=pages[label];
    for(const [kind,token,route] of [["B",adminToken,`/api/v1/platform/knowledge/pages/${pageId}/recognition`],["C",clientToken,`/api/v1/ai/knowledge/source-detail?pageId=${pageId}`]]) {
      const response=await app.inject({url:route,headers:{authorization:`Bearer ${token}`}});const body=response.json();
      report.checks.push({kind,label,endpoint:"source",http:response.statusCode,success:body.success,error:body.error,groups:(kind==="B"?body.data?.renderModel:body.data?.page?.renderModel)?.constructions?.length});
      const image=await app.inject({url:`/api/v1/${kind==="B"?"platform/knowledge":"ai/knowledge"}/pages/${pageId}/image`,headers:{authorization:`Bearer ${token}`}});
      report.checks.push({kind,label,endpoint:"image",http:image.statusCode,type:image.headers["content-type"],bytes:image.rawPayload.length,sha256:createHash("sha256").update(image.rawPayload).digest("hex")});
    }
    for(const thicknessMm of [20,25]) {
      const query:any={intent:"REFERENCE_LOOKUP",parserSource:"LLM",pageLabel:label,thicknessMm};
      const b=await loadKnowledgeTestReferences(app,versionId,"隔离人工基线",[],"结构化审计",query);
      const c=await loadPublishedKnowledgeReferences(app,[{documentId,versionId,pageId}] as any,null,"结构化审计",query);
      assert.equal(b.totalMatched,2);assert.equal(c.totalMatched,2);assert.deepEqual(b.pages[0]!.renderModel,c.pages[0]!.renderModel);
      report.shared.push({label,thicknessMm,matched:c.totalMatched,groups:c.totalGroups,modelEqual:true,rows:c.pages.flatMap(p=>p.renderModel?.constructions.flatMap(g=>g.options.filter(o=>o.thicknessMm===thicknessMm).map(o=>({label:g.rawConstructionLabel,constructionId:g.constructionId,placement:g.placement,base:g.baseMaterial,optionId:o.optionId,r:o.totalThermalResistance,k:o.kValue})))??[])});
    }
  }
  report.blockedObjectOperations=blocked;
  await writeFile(`${output}/readonly-http.json`,JSON.stringify(report,null,2));
  await writeFile(bridgeFile,JSON.stringify({adminBase:base,clientBase:base,adminToken,clientToken,documentId,versionId,pages,conversations:{}}));
  console.log(`READONLY_BRIDGE=${bridgeFile}`);
  console.log(`READONLY_SERVER=${base}`);
  await new Promise<void>(resolve=>{process.on("SIGINT",resolve);process.on("SIGTERM",resolve);});
} finally {await app.close();await client.end({timeout:3});await rm(bridgeFile,{force:true});}
