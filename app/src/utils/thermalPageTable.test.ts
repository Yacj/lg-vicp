import assert from 'node:assert/strict'
import { test } from 'node:test'
import { referenceFixture } from '../test/fixtures/referencePage'
import { thermalConstructionRows, thermalLayerValue, thermalSourceResistance } from './thermalPageTable'
import { constructionDiagramNotes, hasSharedSourceResistance, sourceHeaderNotice, sourceTableHeader, thermalColumnHeader, thermalGroupHeader } from './thermalSourceLabels'

test('简图文字不混入热工行，保留跳号及原始layerIndex；不从空值或名称猜来源', () => {
  const group = referenceFixture().renderModel!.constructions[0]!
  group.sourceTableHeaders = { identifier: '编号', diagram: '构造简图', layers: '构造层' }
  group.diagramNotes = ['1. 隔汽层：按工程设计']
  group.layers = [{ name: '简图防水层', sourceRegion: 'DIAGRAM' }, { name: '保温板', sourceRegion: 'THERMAL_TABLE', sourceLayerLabel: '4' }]
  group.options.forEach(option => option.layerValues = [{ layerIndex: 1, thicknessMm: 20, rValue: 3.2 }])
  const rows = thermalConstructionRows(group)
  assert.ok(rows.every(row => row.layerIndex === 1 && row.layer?.sourceLayerLabel === '4'))
  assert.equal(sourceTableHeader([group], 'identifier'), '编号')
  assert.deepEqual(constructionDiagramNotes(group), ['1. 隔汽层：按工程设计', '简图防水层'])
  group.options.forEach(option => option.layerValues![0]!.layerIndex = 0)
  assert.ok(thermalConstructionRows(group).filter(row => row.option).every(row => row.layer === null))
})

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

test('单列热阻只是显示放置，层值优先且不向产品字段补数', () => {
  const group = referenceFixture().renderModel!.constructions[0]!
  const row = thermalConstructionRows(group).find(row => row.option)!
  const before = JSON.stringify(group)
  assert.equal(thermalLayerValue(row, 'rValue'), null)
  assert.equal(thermalSourceResistance(row, false), null)
  assert.equal(thermalSourceResistance(row, true), row.option!.productThermalResistance)
  assert.equal(JSON.stringify(group), before)
  row.option!.layerValues = [{ layerIndex: row.layerIndex!, rValue: 3.2 }]
  assert.equal(thermalSourceResistance(row, true), 3.2)
  assert.notEqual(row.option!.productThermalResistance, 3.2)
})

test('无来源、重复列、分组冲突或不同布局不套用原表头、不自动合列', () => {
  const group = referenceFixture().renderModel!.constructions[0]!
  assert.equal(hasSharedSourceResistance([group]), false)
  assert.equal(thermalGroupHeader([group]), '')
  assert.ok(sourceHeaderNotice([group]))
  group.sourceColumns = [
    { fieldKey: 'rValue', label: '原列热阻', scope: 'LAYER' },
    { fieldKey: 'totalThermalResistance', label: '传热阻R', groupLabel: '外墙主断面', scope: 'CONSTRUCTION' },
    { fieldKey: 'kValue', label: '传热系数K', groupLabel: '板材主断面', scope: 'CONSTRUCTION' },
  ]
  group.sourceTableLayout = { resistance: 'SHARED_LAYER_OPTION' }
  assert.equal(thermalGroupHeader([group]), '')
  assert.equal(hasSharedSourceResistance([group, { ...group, sourceTableLayout: undefined }]), false)
  group.sourceColumns.push({ fieldKey: 'rValue', label: '另一个热阻', scope: 'UNKNOWN' })
  assert.equal(hasSharedSourceResistance([group]), false)
  assert.equal(thermalColumnHeader([group], 'rValue').label, '热阻')
  assert.ok(sourceHeaderNotice([group]))
})
