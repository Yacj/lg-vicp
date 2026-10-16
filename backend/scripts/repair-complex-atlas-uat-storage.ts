/** 仅修正本轮隔离夹具的图片指针，并清理本轮HTTP生成的精确副本；不读取/修改业务页。 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { env } from '../src/config/env.js';
import { createObjectStorage } from '../src/storage/index.js';
const root = 'docs/ai/evidence/complex-atlas-phase5';
const storage = createObjectStorage(env);
const result: any = { scope: '仅本次随机UAT文档副本；旧业务对象不处理', pages: [] };
for (const directory of ['real-uat-attempt1', 'real-uat']) {
  const report = JSON.parse(await readFile(`${root}/${directory}/report.json`, 'utf8'));
  const dbName = report.isolation.database;
  assert(/^vicp_ai_uat_[a-f0-9]{32}$/.test(dbName));
  assert.equal(report.isolation.prefix, dbName.replace('vicp_ai_uat_', 'vicp-ai-uat-'));
  const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || env.DATABASE_URL); url.pathname = `/${dbName}`;
  const sql = directory === 'real-uat' ? postgres(url.toString(), { max: 1, onnotice: () => {} }) : null;
  try {
    for (const label of ['89', '90', '75']) {
      const draft = JSON.parse(await readFile(`${root}/${directory}/page-${label}.draft.json`, 'utf8'));
      const page = draft.data.page;
      const key = page.pageImageObjectKey;
      assert(key.startsWith(`knowledge/page-images/${report.fixture.documentId}/${report.fixture.versionId}/`));
      assert(/^p[123]-[a-f0-9-]{36}\.png$/.test(key.split('/').at(-1)));
      const copy = await storage.getObject(key);
      const baseline = JSON.parse(await readFile(`tests/fixtures/complex-atlas/page-${label}.json`, 'utf8'));
      assert.equal(createHash('sha256').update(copy).digest('hex'), baseline.imageSha256);
      const originalKey = `${report.isolation.prefix}/complex-atlas/source-${label}.png`;
      if (sql) {
        const original = await storage.getObject(originalKey);
        assert.equal(createHash('sha256').update(original).digest('hex'), baseline.imageSha256);
        const changed = await sql`update knowledge_pages set page_image_object_key = ${originalKey} where id = ${page.id} and document_id = ${report.fixture.documentId} and version_id = ${report.fixture.versionId} and page_image_object_key = ${key} returning id`;
        assert.equal(changed.length, 1);
      }
      await storage.removeObject(key);
      assert.equal(await storage.statObject(key), null);
      result.pages.push({ directory, label, key, sha256: baseline.imageSha256, removedOwnedCopy: true, isolatedPointerUpdated: Boolean(sql) });
    }
  } finally { if (sql) await sql.end() }
}
result.status = 'PASS';
await writeFile(`${root}/storage-isolation-correction.json`, JSON.stringify(result, null, 2));
console.log('本轮6个精确副本已逐一验SHA清理；当前3个隔离页面仅指向原有UAT前缀，未修改确认事实。');
