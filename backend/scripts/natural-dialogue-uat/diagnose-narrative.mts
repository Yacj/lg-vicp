import 'dotenv/config';
import postgres from 'postgres';import {drizzle} from 'drizzle-orm/postgres-js';import * as schema from '../../src/db/schema.js';
import {resolveSceneRuntime} from '../../src/modules/ai/ai-runtime.service.js';
import {generateProductNarrative} from '../../src/modules/ai/product-narrative.js';
import {writeFile} from 'node:fs/promises';
const ev='docs/ai/evidence/natural-dialogue-repair-2026-10-20/round-11';
const evidence=await(await fetch('http://127.0.0.1:4339/__uat/evidence')).json();
const m=evidence.messages.find((m:any)=>m.metadata?.backendDecision?.productAnswerFacts?.mode==='INTRODUCTION');
const c=evidence.conversations.find((c:any)=>c.id===m.conversation_id);
const u=new URL(process.env.DATABASE_URL!);u.pathname='/vicp_h5_uat_187e3ebdf8544f39bd197f73ababcf41';
const s=postgres(u.toString(),{connection:{options:'-c default_transaction_read_only=on'}});const db=drizzle(s,{schema});
try { const runtime=await resolveSceneRuntime(db,c.scene??'general_chat','OFF');const model:any=runtime.primary.languageModel;const drafts:any[]=[];
const proxy=new Proxy(model,{get(t,k){if(k==='doGenerate')return async(...args:any[])=>{const result=await t.doGenerate(...args);drafts.push(result.content);return result};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v}});
const result=await generateProductNarrative(proxy,'目前有哪些VICP产品',m.metadata.backendDecision.productAnswerFacts,AbortSignal.timeout(60000));
await writeFile(ev+'/narrative-diagnostic.json',JSON.stringify({drafts,code:result.code},null,2));console.log(JSON.stringify({code:result.code,drafts:drafts.length}));
}finally {await s.end()}
