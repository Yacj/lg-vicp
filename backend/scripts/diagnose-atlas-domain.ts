/** 只读模型配置、真实结构化提案诊断；不启动业务写入，不保存模型推理链或凭据。 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateObject } from 'ai';
import { env } from '../src/config/env.js';
import * as schema from '../src/db/schema.js';
import { resolveSceneRuntime } from '../src/modules/ai/ai-runtime.service.js';
import { domainTurnSemanticSchema } from '../src/modules/ai/ai-domain-semantic.js';
import { DOMAIN_SEMANTIC_PROMPT } from '../src/modules/ai/ai-domain-turn-decision.service.js';
import { applyDomainPolicy } from '../src/modules/ai/ai-domain-policy.js';
import { repairDomainSemanticText } from '../src/modules/ai/domain-semantic-output.js';
import { languageModelSamplingOptions, getAiTaskRuntimePolicy } from '../src/modules/ai-config/ai-task-runtime-policy.js';
const out = process.argv[2] ?? 'docs/ai/evidence/complex-atlas-fixes-2026-10-16/domain-before';
await mkdir(out,{recursive:true});
const sql = postgres(process.env.AI_UAT_CONFIG_DATABASE_URL || env.DATABASE_URL,{max:1,onnotice:()=>{},connection:{options:'-c default_transaction_read_only=on'}});
try {
  const db=drizzle(sql,{schema});
  const runtime=await resolveSceneRuntime(db,'semantic_query','OFF').catch(()=>resolveSceneRuntime(db,'general_chat','OFF'));
  for(const [id,message] of [
    ['T01','I型VICP坡屋面正置和倒置，20mm的传热系数分别多少？看下表。'],
    ['T03','II型平屋面正置和倒置的20mm参数一样吗？'],
    ['T05','外墙C1-3和C1-4都是20mm，哪个K小？基层什么材料？'],
    ['T08','把第90页原图、备注和完整厚度表打开。'],
  ]) {
    const started=Date.now(); const report:Record<string,unknown>={id,message,scope:'真实结构化提案；源配置强制只读；不执行业务目标'};
    try {
      const result=await generateObject({model:runtime.primary.languageModel,schema:domainTurnSemanticSchema,system:DOMAIN_SEMANTIC_PROMPT,prompt:JSON.stringify({message,previousQuery:null,recentAssistantMessages:[],referenceSourceScope:null,recentBusinessGoals:[],pendingAdviceGoal:null,candidateScopeActive:false,candidates:null}),...languageModelSamplingOptions('SEMANTIC_QUERY'),maxRetries:0,experimental_repairText:async({text})=>repairDomainSemanticText(text),abortSignal:AbortSignal.timeout(getAiTaskRuntimePolicy('SEMANTIC_QUERY').timeoutMs)});
      report.proposal=result.object;report.finishReason=result.finishReason;report.usage=result.usage;report.policy=applyDomainPolicy(message,result.object);
    }catch(error){ const e=error as any; report.invalidProposal=e.cause?.value; report.error={name:e.name,finishReason:e.finishReason,causeName:e.cause?.name,issues:(e.cause?.cause?.issues??e.cause?.issues)?.map((i:any)=>({path:i.path,code:i.code,message:i.message})),causeKeys:e.cause?Object.keys(e.cause):[]}; }
    report.durationMs=Date.now()-started;await writeFile(`${out}/${id}.json`,JSON.stringify(report,null,2));console.log(`${id} ${report.durationMs}ms ${report.error?'ERROR':(report.policy as any).policyReason}`);
  }
}finally{await sql.end()}
