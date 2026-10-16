import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

// 只校验留存的浏览器 DOM 与原图哈希；不启动或控制浏览器，不调用业务服务。
const read = name => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
const cases = read('browser-cases.json')
const expected = [
  [89, 20, [[5.225, 0.191], [5.198, 0.192]]],
  [89, 25, [[6.025, 0.166], [5.998, 0.167]]],
  [90, 20, [[5.369, 0.186], [5.369, 0.186]]],
  [90, 25, [[6.169, 0.162], [6.169, 0.162]]],
  [75, 20, [[6.916, 0.145], [7.540, 0.133]]],
  [75, 25, [[8.516, 0.117], [9.140, 0.109]]],
]
const rows = []
for (const [page, thickness, values] of expected) {
  const record = cases.find(item => item.page === page && item.thickness === thickness)
  assert.equal(record.groups, 2)
  assert.equal(record.options, page === 75 ? 14 : 12)
  assert.equal(record.cards.length, 2)
  values.forEach(([r, k], index) => {
    const text = record.cards[index]
    assert.ok(text.includes(`${thickness}mm`))
    assert.ok(text.includes(`传热阻 R：${r.toFixed(3)}`))
    assert.ok(text.includes(`传热系数 K ${k.toFixed(3)}`))
    assert.ok(text.includes(page === 75 ? index === 0 ? 'C1-3' : 'C1-4' : index === 0 ? '正置' : '倒置'))
    rows.push({ page, thickness, group: index, r, k, status: 'PASS', scope: '人工 Fixture 的浏览器 DOM' })
  })
}
const images = read('source-image-hashes.json')
for (const image of images) {
  const bytes = fs.readFileSync(image.path)
  assert.equal(bytes.length, image.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256)
}
const result = { scope: '留存证据核验；不能替代真实模型、权限、业务路由、OSS 或真机验收', rows, sourceImages: images }
fs.writeFileSync(new URL('browser-validation.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`)
console.log('12 行浏览器证据、6 构造分组及 3 张原图哈希核验通过。')
