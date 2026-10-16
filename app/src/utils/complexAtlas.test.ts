import assert from 'node:assert/strict'
import { test } from 'node:test'
import { complexAtlasFixture } from '../test/fixtures/complexAtlas'
import { normalizeReferencePages, referencePersistenceSnapshot, referenceSolutions, resolvePageHighlights } from './referencePage'
import { thermalConstructionRows, thermalLayerValue } from './thermalPageTable'
import { constructionAttributes, constructionLabel, thermalColumnHeader, thermalGroupHeader } from './thermalSourceLabels'

test('三页全部 38 档、12 行基线和同值双身份均保留，层热阻不拿产品热阻补位', () => {
  const expected = { 89: [[5.225, 0.191, 6.025, 0.166], [5.198, 0.192, 5.998, 0.167]], 90: [[5.369, 0.186, 6.169, 0.162], [5.369, 0.186, 6.169, 0.162]], 75: [[6.916, 0.145, 8.516, 0.117], [7.540, 0.133, 9.140, 0.109]] }
  let count = 0
  for (const pageNumber of [89, 90, 75] as const) {
    const page = complexAtlasFixture(pageNumber)
    const before = JSON.stringify(page)
    const groups = page.renderModel!.constructions
    assert.equal(groups.length, 2)
    assert.equal(thermalGroupHeader(groups), '外墙主断面')
    assert.equal(thermalColumnHeader(groups, 'totalThermalResistance').label, '传热阻 R')
    groups.forEach((group, index) => {
      const options = group.options.filter(option => [20, 25].includes(Number(option.thicknessMm)))
      assert.deepEqual(options.flatMap(option => [option.totalThermalResistance, option.kValue]), expected[pageNumber][index])
      const rows = thermalConstructionRows(group).filter(row => row.option)
      assert.equal(rows.length, pageNumber === 75 ? 7 : 6)
      assert.ok(rows.every(row => row.layer?.name.includes('真空绝热板')))
      assert.deepEqual(rows.map(row => thermalLayerValue(row, 'rValue')), group.options.map(option => option.layerValues![0]!.rValue))
      assert.ok(group.options.every(option => option.productThermalResistance === null))
      count += rows.length
      if (pageNumber !== 75) {
        assert.equal(group.constructionCode, null)
        assert.match(constructionLabel(group), /屋面/)
        assert.ok(constructionAttributes(group).includes('防水等级待核对'))
      }
    })
    assert.notEqual(groups[0]!.constructionId, groups[1]!.constructionId)
    const repeated = normalizeReferencePages([page, page, page])
    assert.equal(repeated.length, 1)
    assert.equal(referenceSolutions(repeated[0]!).length, 2)
    assert.equal(JSON.stringify(page), before)
    const restored = referencePersistenceSnapshot({ messages: [{ referencePages: repeated }] }) as { messages: Array<{ referencePages: typeof repeated }> }
    assert.equal(restored.messages[0]!.referencePages[0]!.page.imageUrl, '')
    assert.equal(referenceSolutions(restored.messages[0]!.referencePages[0]!).length, 2)
  }
  assert.equal(count, 38)
})

test('来源 R₀ 仅按证据显示，缺失、重复及冲突保守退化；换版不继承旧来源状态和 URL', () => {
  const page = complexAtlasFixture(90)
  const groups = page.renderModel!.constructions
  const altered = structuredClone(groups)
  altered[0]!.sourceColumns!.find(column => column.fieldKey === 'totalThermalResistance')!.symbol = 'R₀'
  assert.match(thermalColumnHeader([altered[0]!], 'totalThermalResistance').label, /R₀/)
  assert.doesNotMatch(thermalColumnHeader(altered, 'totalThermalResistance').label, /R₀/)
  altered[1]!.sourceColumns!.push(altered[1]!.sourceColumns![0]!)
  assert.doesNotMatch(thermalColumnHeader([], 'totalThermalResistance').label, /R₀/)
  const changed = structuredClone(page)
  changed.renderModel!.confirmedRevision = 'new'
  changed.matches = []
  changed.page.imageUrl = ''
  page.answerStyle = 'THERMAL_SOLUTIONS'
  const result = normalizeReferencePages([page, changed])[0]!
  assert.equal(result.page.imageUrl, '')
  assert.equal(result.answerStyle, undefined)
  assert.deepEqual(resolvePageHighlights(changed.renderModel, page.matches, changed.page.pageId), [])
  assert.deepEqual(result.matches, [])
})

test('显式层索引优先，重复或多层证据不挪用产品热阻，旧 DTO 允许空层热阻', () => {
  const group = complexAtlasFixture(89).renderModel!.constructions[0]!
  group.layers.forEach(layer => layer.variable = false)
  const rows = thermalConstructionRows(group).filter(row => row.option)
  assert.ok(rows.every(row => row.layer?.name.endsWith('真空绝热板')))
  const row = rows[0]!
  row.option!.productThermalResistance = 123
  row.option!.layerValues = []
  assert.equal(thermalLayerValue(row, 'rValue'), null)
  assert.equal(thermalLayerValue(row, 'thicknessMm'), 5)
  assert.ok(thermalConstructionRows(group).filter(item => item.option).every(item => item.layer === null))
})
