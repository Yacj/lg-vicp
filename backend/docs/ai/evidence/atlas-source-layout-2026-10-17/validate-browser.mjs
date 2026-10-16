import fs from 'node:fs'
import assert from 'node:assert/strict'
const out = import.meta.dirname
const results = JSON.parse(fs.readFileSync(`${out}/browser.json`, 'utf8'))
const models = JSON.parse(fs.readFileSync(`${out}/models.json`, 'utf8'))
const checks = []
assert.deepEqual(results.errors, [])
for (const row of results.results.filter(row => row.client === 'H5' && row.groups)) {
  const model = Object.values(models).find(model => model.constructions[0].rawConstructionLabel === row.groups[0].code.trim())
  assert.ok(model)
  assert.equal(row.documentOverflow, false)
  assert.ok(!row.tableHeaders.includes('产品整体热阻'))
  assert.equal(row.groups.length, model.constructions.length)
  row.groups.forEach((group, i) => {
    assert.equal(group.code.trim(), model.constructions[i].rawConstructionLabel)
    assert.ok(!group.materialNames.some(name => name.includes('按工程设计')))
    for (const option of model.constructions[i].options) {
      const cell = group.cells.find(cell => cell.col === '3' && Number(cell.text) === option.thicknessMm && group.cells.some(item => item.col === '8' && item.row === cell.row && item.text !== ''))
      assert.ok(cell)
      const value = col => Number(group.cells.find(item => item.col === String(col) && item.row === cell.row)?.text)
      assert.equal(value(7), option.totalThermalResistance)
      assert.equal(value(8), option.kValue)
      assert.equal(value(6), option.layerValues[0].rValue)
      checks.push({ width: row.width, page: model.pageLabel, construction: group.code.trim(), thicknessMm: option.thicknessMm, r: value(7), k: value(8), status: 'PASS' })
    }
  })
}
const alignments = results.results.filter(row => row.alignment)
assert.equal(alignments.length, 15)
assert.ok(alignments.every(row => row.alignment.difference <= 1 && row.alignment.body > 0))
assert.equal(checks.length, 204)
fs.writeFileSync(`${out}/browser-validation.json`, JSON.stringify({ scope: '正式组件浏览器UI+人工基线Fixture，非真实SSE联测', status: 'PASS', checks, alignments }, null, 2))
console.log(JSON.stringify({ status: 'PASS', checkedOptionRows: checks.length, viewports: [320, 375, 430], headerBodyScrollAligned: alignments.length }))
