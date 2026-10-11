import assert from 'node:assert/strict'
import { test } from 'node:test'
import { referenceFixture } from '../test/fixtures/referencePage'
import { thermalConstructionRows } from './thermalPageTable'

test('可变材料嵌入完整档位，公共参数合并，同页各构造保持正式选项身份', () => {
  const page = referenceFixture()
  const snapshot = JSON.stringify(page)
  for (const construction of page.renderModel!.constructions) {
    const rows = thermalConstructionRows(construction)
    assert.equal(rows.length, 5)
    assert.equal(rows[0]!.layer!.name, '砂浆')
    const options = rows.filter(row => row.option)
    assert.equal(options.length, 4)
    assert.ok(options.every(row => row.groupStart === 1 && row.groupLength === 4 && row.layer!.name === '保温板'))
    assert.deepEqual(options.map(row => row.option), construction.options)
    assert.deepEqual(options.map(row => row.optionIndex), [0, 1, 2, 3])
  }
  assert.equal(JSON.stringify(page), snapshot)
})

test('单厚度、无选项、空构造、多个可变层都不猜关联或补算数值', () => {
  const construction = referenceFixture().renderModel!.constructions[0]!
  assert.equal(thermalConstructionRows({ ...construction, options: [construction.options[0]!] }).length, 2)
  assert.equal(thermalConstructionRows({ ...construction, options: [] }).length, 2)
  assert.deepEqual(thermalConstructionRows({ ...construction, layers: [], options: [] }), [])
  const rows = thermalConstructionRows({ ...construction, layers: construction.layers.map(layer => ({ ...layer, variable: true })) })
  assert.ok(rows.filter(row => row.option).every(row => row.layer === null))
})
