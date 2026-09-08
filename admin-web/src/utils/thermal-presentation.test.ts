import type { ThermalCalcRecord } from '@/types/thermal'
import { describe, expect, it } from 'vitest'
import { buildThermalCalcPresentation, closestThermalCandidateIds } from './thermal-presentation'

function createRecord(overrides: Partial<ThermalCalcRecord> = {}): ThermalCalcRecord {
  return {
    id: 'record-1',
    requestId: 'req-1',
    mode: 'LAYERED',
    projectId: null,
    ruleId: null,
    ruleVersion: 1,
    standardLimitId: null,
    limitVersion: 1,
    input: {},
    layers: [
      { layerOrder: 2, layerType: 'PRODUCT_LAYER', layerName: 'VICP 保温板', thicknessM: 0.025, lambda: 0.031, correctionFactor: 1.1 },
      { layerOrder: 1, layerType: 'BASE_LAYER', layerName: '混合砂浆', thicknessM: 0.02, lambda: 0.93, correctionFactor: 1 },
    ],
    parameters: [],
    rule: null,
    standard: {
      limitKValue: 0.25,
      basisName: 'DB11/891',
      clauseRef: '3.3.1',
    },
    formulas: {},
    steps: [
      { key: 'layer_1', label: '混合砂浆热阻', value: 0.0215, rounded: 0.022, formula: 'R = δ / λ' },
      { key: 'total_resistance', label: '总热阻汇总', value: 4.31, rounded: 4.31, formula: 'R0 = ΣRi' },
      { key: 'k_value', label: '传热系数', value: 0.232, rounded: 0.232, formula: 'K = 1 / R0' },
    ],
    result: {
      kValue: 0.23205,
      kValueRounded: 0.232,
      totalResistance: 4.3112,
      totalResistanceRounded: 4.311,
      compliant: true,
    },
    createdById: null,
    createdAt: '2026-08-29T00:00:00Z',
    ...overrides,
  }
}

describe('buildThermalCalcPresentation', () => {
  it('projects frozen snapshot into user view without recomputing K', () => {
    const presentation = buildThermalCalcPresentation(createRecord())
    expect(presentation.resultK).toBe(0.232)
    expect(presentation.targetK).toBe(0.25)
    expect(presentation.compliant).toBe(true)
    expect(presentation.standardLabel).toBe('DB11/891 · 3.3.1')
    expect(presentation.steps.map(step => step.key)).toEqual(['layer_1', 'total_resistance', 'k_value'])
    expect(presentation.steps[2]).toMatchObject({ value: 0.232, unit: 'W/(㎡·K)' })
  })

  it('converts layer thickness from meters to millimeters', () => {
    const presentation = buildThermalCalcPresentation(createRecord())
    const byName = new Map(presentation.layers.map(layer => [layer.name, layer]))
    expect(byName.get('VICP 保温板')).toMatchObject({ thicknessMm: 25 })
    expect(byName.get('混合砂浆')).toMatchObject({ thicknessMm: 20 })
  })

  it('tolerates missing snapshot sections', () => {
    const presentation = buildThermalCalcPresentation(createRecord({
      layers: [],
      steps: [],
      standard: null,
      result: {},
    }))
    expect(presentation.resultK).toBeNull()
    expect(presentation.targetK).toBeNull()
    expect(presentation.compliant).toBeNull()
    expect(presentation.steps).toEqual([])
    expect(presentation.layers).toEqual([])
  })
})

describe('closestThermalCandidateIds', () => {
  it('marks only candidates flagged by the backend as closest', () => {
    const candidates = [
      { candidateId: 'a', ranking: { kGap: 0.018, isClosestToTarget: false } },
      { candidateId: 'b', ranking: { kGap: 0.011, isClosestToTarget: true } },
      { candidateId: 'c' },
    ]
    expect(closestThermalCandidateIds(candidates)).toEqual(new Set(['b']))
  })

  it('never invents a closest marker when backend provides none', () => {
    expect(closestThermalCandidateIds([{ candidateId: 'a' }])).toEqual(new Set())
  })
})
