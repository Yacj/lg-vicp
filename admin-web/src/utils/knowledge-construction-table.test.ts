import type { KnowledgeConstructionContent } from '@/types/knowledge-page-render'
import { describe, expect, it } from 'vitest'
import { constructionTableRows, pageConstructionCellSpan, pageConstructionTableRows } from './knowledge-construction-table'

describe('构造原表的数据投影', () => {
  it('显式简图行单独展示，过滤不改变layerIndex或把档位绑到相邻层', () => {
    const construction: KnowledgeConstructionContent = { layers: [{ name: '防水层', sourceRegion: 'DIAGRAM' }, { name: '保温板', sourceRegion: 'THERMAL_TABLE', sourceLayerLabel: '4' }], options: [{ thicknessMm: 20, layerValues: [{ layerIndex: 1, thicknessMm: 20, rValue: 3.2 }] }] }
    const rows = constructionTableRows(construction)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'option', layerIndex: 1, layer: { sourceLayerLabel: '4' } })
    construction.options[0]!.layerValues![0]!.layerIndex = 0
    const invalid = constructionTableRows(construction)
    expect(invalid.filter(row => row.kind === 'option')[0]!.layer).toBeNull()
  })
  it('保温层多厚度在原层位置展开，后续构造层保留在其后，输入不修改', () => {
    const construction: KnowledgeConstructionContent = {
      layers: [{ name: '砂浆', order: 1, rValue: 0.023 }, { name: '保温板', order: 2, variable: true }, { name: '抹面层', order: 3, rValue: 0.005 }],
      options: [{ optionId: '18', thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }, { optionId: '20', thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 }],
    }
    const snapshot = JSON.stringify(construction)
    const rows = constructionTableRows(construction)
    expect(rows.map(row => [row.kind, row.layer?.name])).toEqual([['layer', '砂浆'], ['option', '保温板'], ['option', '保温板'], ['layer', '抹面层']])
    expect(rows[1]?.kind === 'option' && rows[1].option).toEqual(construction.options[0])
    expect(JSON.stringify(construction)).toBe(snapshot)
  })

  it('未明确对应层时不按材料名称或数值猜测，单独保留档位', () => {
    for (const layers of [[{ name: '保温板' }], [{ name: '材料一', variable: true }, { name: '材料二', variable: true }]]) {
      const rows = constructionTableRows({ layers, material: { name: '保温板' }, options: [{ thicknessMm: 18, productThermalResistance: 2.88 }] })
      expect(rows.filter(row => row.kind === 'layer')).toHaveLength(layers.length)
      expect(rows[rows.length - 1]).toMatchObject({ kind: 'option', layer: null, option: { thicknessMm: 18, productThermalResistance: 2.88 } })
    }
  })

  it('只有构造层、只有档位、单厚度均保留现有数据且不制造热工值', () => {
    const layer = { name: '保温板', variable: true, thicknessMm: 18, rValue: 2.88 }
    expect(constructionTableRows({ layers: [layer], options: [] })[0]).toMatchObject({ kind: 'layer', layer })
    const option = { thicknessMm: 18, kValue: 0.303 }
    expect(constructionTableRows({ layers: [], options: [option] })[0]).toMatchObject({ kind: 'option', layer: null, option })
    expect(constructionTableRows({ layers: [layer], options: [option] })[0]).toMatchObject({ kind: 'option', layer, option, groupLength: 1 })
    expect(constructionTableRows({ layers: [], options: [] })).toEqual([])
  })

  it('多构造共表时编号和材料合并不跨构造，空构造不影响后续偏移和键唯一性', () => {
    const construction: KnowledgeConstructionContent = {
      constructionId: 'A1-3',
      layers: [{ name: '基层' }, { name: '保温板', variable: true }, { name: '抹面层' }],
      options: Array.from({ length: 9 }, (_, index) => ({ optionId: `option-${index}`, thicknessMm: 15 + index * 5 })),
    }
    const constructions = [construction, { layers: [], options: [] }, { ...construction, constructionId: 'A1-4' }]
    const snapshot = JSON.stringify(constructions)
    const rows = pageConstructionTableRows(constructions)
    expect(rows).toHaveLength(22)
    expect(new Set(rows.map(row => row.viewerKey)).size).toBe(22)
    expect(pageConstructionCellSpan(rows[0]!, 0, 'constructionCode')).toEqual({ rowspan: 11 })
    expect(pageConstructionCellSpan(rows[11]!, 11, 'constructionCode')).toEqual({ rowspan: 11 })
    expect(pageConstructionCellSpan(rows[12]!, 12, 'name')).toEqual({ rowspan: 9 })
    expect(pageConstructionCellSpan(rows[12]!, 12, 'lambda')).toEqual({ rowspan: 9 })
    expect(pageConstructionCellSpan(rows[13]!, 13, 'name')).toEqual({})
    expect(pageConstructionCellSpan(rows[12]!, 12, 'totalThermalResistance')).toEqual({})
    expect(pageConstructionCellSpan(rows[21]!, 21, 'name')).toEqual({})
    expect(rows[12]?.construction.constructionId).toBe('A1-4')
    expect(JSON.stringify(constructions)).toBe(snapshot)
  })
})
