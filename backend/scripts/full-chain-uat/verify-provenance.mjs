import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const out = process.argv[2]
const manifest = JSON.parse(await readFile(`${out}/source-manifest.json`, 'utf8'))
const changed = []
for (const [file, hash] of Object.entries(manifest)) {
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash) changed.push(file)
}
const matrix = JSON.parse(await readFile(`${out}/matrix.json`, 'utf8'))
const frozenBytes = await readFile('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接/baseline/frozen-scenarios.json')
const frozen = JSON.parse(frozenBytes)
assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), matrix.frozenSha256)
for (const item of matrix.cases) {
  const original = frozen.cases.find(row => row.id === item.id)
  assert.deepEqual(item.prompts, original.prompts)
  assert.deepEqual(item.turns.map(turn => turn.userMessage), original.prompts)
  assert.deepEqual(item.turns.map(turn => turn.submittedBody.content), original.prompts)
}
const result = { at: new Date().toISOString(), files: Object.keys(manifest).length, changed, frozenSha256: matrix.frozenSha256,
  scenarios: matrix.cases.length, originalUserTurns: matrix.cases.reduce((n, item) => n + item.turns.length, 0), submittedUnchanged: true,
  note: '核对原始文件字节SHA、每轮实际H5提交内容及执行前后Backend/App源码；不代表业务正确性判定。', passed: changed.length === 0 }
await writeFile(`${out}/provenance-verification.json`, JSON.stringify(result, null, 2))
assert.equal(result.passed, true)
console.log(JSON.stringify(result))
