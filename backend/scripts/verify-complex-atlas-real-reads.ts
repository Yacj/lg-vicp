/** 强制只读本次随机UAT库，直接验证B/C共享读取函数；不冒充自然语言/正式HTTP成功。 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema.js';
import { env } from '../src/config/env.js';
import { createObjectStorage } from '../src/storage/index.js';
import { loadKnowledgeTestReferences, KnowledgeReferenceCitationStream } from '../src/modules/knowledge/knowledge-test-reference.js';
import { loadPublishedKnowledgeReferences } from '../src/modules/ai/ai-reference-pages.service.js';
import type { ThermalQueryState } from '../src/modules/thermal/thermal-query-state.js';
const root = 'docs/ai/evidence/complex-atlas-phase5';
const bridge = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
const report = JSON.parse(await readFile(`${root}/real-uat/report.json`, 'utf8'));
assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(report.isolation.database));
const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || env.DATABASE_URL); url.pathname = `/${report.isolation.database}`;
const sql = postgres(url.toString(), { max: 1, onnotice: () => {}, connection: { options: '-c default_transaction_read_only=on' } });
const app = { db: drizzle(sql, { schema }), storage: createObjectStorage(env) } as any;
const cases: any[] = [];
function redact(value: any): any { if (typeof value === 'string' && /^https?:/.test(value)) return '[AUTHORIZED_URL_REDACTED]'; if (Array.isArray(value)) return value.map(redact); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)])); return value }
try {
  assert.equal((await sql`show transaction_read_only`)[0]!.transaction_read_only, 'on');
  for (const page of ['89','90','75']) for (const thicknessMm of [20,25]) {
    const query: ThermalQueryState = { intent: 'REFERENCE_LOOKUP', parserSource: 'LLM', pageLabel: page, thicknessMm, applicationPart: page==='75'?'EXTERNAL_WALL':'ROOF', ...(page==='75'?{}:{roofForm:page==='89'?'SLOPED':'FLAT'}) };
    const b = await loadKnowledgeTestReferences(app, bridge.versionId, '隔离人工基线', [], '结构化只读测试', query);
    const c = await loadPublishedKnowledgeReferences(app, [{documentId:bridge.documentId,versionId:bridge.versionId,pageId:bridge.pages[page]}] as any, null, '结构化只读测试',query);
    assert.equal(b.totalMatched,2); assert.equal(c.totalMatched,2); assert.equal(c.solutionCandidates,undefined);
    assert.deepEqual(b.pages[0]!.renderModel,c.pages[0]!.renderModel);
    const model = b.pages[0]!.renderModel!;
    assert.equal(model.constructions.length,2); assert.equal(model.constructions.reduce((n,g)=>n+g.options.length,0),page==='75'?14:12);
    const fixture = JSON.parse(await readFile(`tests/fixtures/complex-atlas/page-${page}.json`,'utf8')).data;
    const citations = new KnowledgeReferenceCitationStream();
    citations.push(b.answer ?? '', true);
    const resolvedPages = citations.resolve(b.pages, b.citationOptionIds);
    const rows = resolvedPages[0]!.matches.map(match=>{
      const group = model.constructions.find(g=>g.constructionId===match.constructionId)!;
      const option = group.options.find(o=>o.optionId===match.optionId)!;
      const index = model.constructions.indexOf(group);
      const baseline = fixture.systems[index].options.find((o:any)=>o.thicknessMm===thicknessMm);
      assert.equal(option.totalThermalResistance,baseline.totalThermalResistance); assert.equal(option.kValue,baseline.kValue); assert.equal(option.productThermalResistance,null);
      return {page,constructionId:group.constructionId,optionId:option.optionId,label:group.rawConstructionLabel,constructionCode:group.constructionCode,base:group.baseMaterial,thicknessMm,r:option.totalThermalResistance,k:option.kValue};
    });
    assert.equal(new Set(rows.map(r=>r.constructionId)).size,2);
    cases.push({page,thicknessMm,status:'PASS_REAL_DB_SHARED_SERVICE',rows});
    await writeFile(`${root}/real-uat/read-${page}-${thicknessMm}.json`,JSON.stringify(redact({query,b,c,resolvedPages}),null,2));
  }
  await writeFile(`${root}/real-reads-summary.json`,JSON.stringify({scope:'真实隔离只读DB与正式B/C共享读取函数；结构化条件直接注入，不是自然语义/HTTP/SSE成功',cases,status:'PASS'},null,2));
  console.log('六次结构化共享服务查询、12行构造事实与完整38档模型一致；不代表自然问答通过。');
} finally { await sql.end() }
