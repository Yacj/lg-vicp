// 仅重放人工 Fixture 载荷与浏览器 DOM 记录，不连接数据库、模型或 OSS。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(evidence, '../../../../../backend');
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
const { buildKnowledgePageRenderModel } = await import(pathToFileURL(path.join(backend, 'src/shared/knowledge-page-render.ts')).href);
const browser = read('browser-twelve-rows.json');
const baseline = {
  89: [[20, 5.225, .191, 5.198, .192], [25, 6.025, .166, 5.998, .167]],
  90: [[20, 5.369, .186, 5.369, .186], [25, 6.169, .162, 6.169, .162]],
  75: [[20, 6.916, .145, 7.540, .133], [25, 8.516, .117, 9.140, .109]],
};
const hashes = {
  89: '6d48ac8f8a746eb6c012f8c9ad6c2bf24a4161ab65b00ee9222f351e41a4ba9c',
  90: '3cda1d4a7da48652b779c637bf19418c0fd4b894dccaaf0fdb951b7a8d916aa3',
  75: 'a712567ae0622aa41f14961f2cf6cd5ebe28e8ecf701391c0d6814dc3e6ebcea',
};
const pages = [];
const twelveRows = [];
for (const p of [89, 90, 75]) {
  const original = JSON.parse(fs.readFileSync(path.join(backend, `tests/fixtures/complex-atlas/page-${p}.json`), 'utf8')).data;
  const saved = read(`saved-${p}.json`).structuredData;
  const confirmed = read(`confirmed-${p}.json`);
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.pageLabelEvidence, String(p));
  assert.equal(saved.systems.length, 2);
  assert.equal(confirmed.recognitionStatus, 'CONFIRMED');
  assert.equal(confirmed.thermal.upserted, 0);
  const render = confirmed.recognition.renderModel;
  assert.equal(new Set(render.constructions.map(c => c.constructionId)).size, 2);
  for (let i = 0; i < 2; i++) {
    const group = saved.systems[i];
    assert.deepEqual(group.options, original.systems[i].options);
    // 编辑控件将可选层数值 null 表示为未填写；两者语义相同，不能变成 0。
    const layerValues = layers => layers.map(layer => ({ ...layer, ...Object.fromEntries(['order', 'thicknessMm', 'lambda', 'alpha', 'rValue'].map(key => [key, layer[key] ?? null])) }));
    assert.deepEqual(layerValues(group.layers), layerValues(original.systems[i].layers));
    assert.deepEqual(group.sourceColumns, original.systems[i].sourceColumns);
    for (const key of ['rawConstructionLabel', 'applicationPart', 'roofForm', 'placement', 'specClass', 'waterproofGrade', 'baseMaterial', 'baseThicknessMm']) {
      assert.equal(group[key], original.systems[i][key] ?? undefined);
    }
    assert.equal(group.constructionCode, p === 75 ? `C1-${i + 3}` : null);
    assert.ok(group.options.every(o => o.productThermalResistance === null));
  }
  for (const [thickness, r0, k0, r1, k1] of baseline[p]) {
    const record = browser.cases.find(item => item.page === p && item.thickness === thickness);
    assert.equal(record.rows.length, 2);
    for (const [i, r, k] of [[0, r0, k0], [1, r1, k1]]) {
      const option = saved.systems[i].options.find(o => o.thicknessMm === thickness);
      assert.equal(option.totalThermalResistance, r);
      assert.equal(option.kValue, k);
      assert.ok(record.rows[i].endsWith(`${thickness}${r.toFixed(3)}${k.toFixed(3)}${p}`));
      const c = render.constructions[i];
      const row = c.options.find(o => o.thicknessMm === thickness);
      twelveRows.push({ page: p, construction: saved.systems[i].rawConstructionLabel, thicknessMm: thickness, totalThermalResistance: r, kValue: k, constructionId: c.constructionId, optionId: row.optionId, status: 'PASS_FIXTURE_AND_BROWSER_DOM' });
    }
  }
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(evidence, `source-page-${p}.png`))).digest('hex');
  assert.equal(sha256, hashes[p]);
  // 旧快照 ID 与最终载荷绑定；改标题也必须失效，不能重绑到新行。
  const changed = buildKnowledgePageRenderModel(`fixture-page-${p}`, { ...saved, pageTitle: saved.pageTitle + ' revised' });
  assert.notEqual(changed.constructions[0].constructionId, render.constructions[0].constructionId);
  const sse = read(`last-sse-${p}.json`).block;
  assert.equal(sse.matches.length, 2);
  assert.equal(new Set(sse.matches.map(m => `${m.constructionId}:${m.optionId}`)).size, 2);
  pages.push({ page: p, constructionCount: 2, optionCounts: saved.systems.map(s => s.options.length), productRRemainsNull: true, sourceFieldsPreserved: true, fixtureMemoryConfirmedOnly: true, thermalUpserted: 0, sha256 });
}
const result = { scope: '人工源图Fixture、保存载荷、内存确认、浏览器DOM；不是正式Backend查询或数据库确认', pages, totalOptions: pages.reduce((n, p) => n + p.optionCounts.reduce((a, b) => a + b, 0), 0), twelveRows, realVision: 'NOT_RUN_PHASE2', realBackendHttpSse: 'NOT_RUN', realDatabaseConfirm: 'NOT_RUN', realOss: 'NOT_RUN', appH5: 'NOT_RUN_PHASE2' };
fs.writeFileSync(path.join(evidence, 'verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log('PASS: 3 pages, 6 constructions, 38 preserved options, 12 browser rows, original PNG hashes; FIXTURE ONLY');
