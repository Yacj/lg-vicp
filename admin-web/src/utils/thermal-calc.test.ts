import type { ThermalCalcRecord } from '@/types/thermal'
import { describe, expect, it } from 'vitest'
import {
  THERMAL_CALC_MODE_OPTIONS,
  thermalCalcEvidence,
  thermalCalcEvidenceLabel,
  thermalCalcLayerRows,
  thermalCalcModeLabel,
  thermalCalcReferenceCandidates,
  thermalCalcResultSummary,
  thermalCalcSourceLabel,
  thermalCalcThicknessLabel,
} from './thermal-calc'

function createRecord(overrides: Partial<ThermalCalcRecord> = {}): ThermalCalcRecord {
  return {
    id: 'record-1',
    requestId: 'req-1',
    mode: 'LAYERED',
    projectId: null,
    ruleId: null,
    ruleVersion: null,
    standardLimitId: null,
    limitVersion: null,
    input: {},
    layers: [],
    parameters: [],
    rule: null,
    standard: null,
    formulas: {},
    steps: [],
    result: {},
    createdById: null,
    createdAt: '2026-10-08T00:00:00Z',
    ...overrides,
  }
}

/** 后端 executeReferenceTable 的 resultJson 形状：结果只在 candidates[]，无顶层数值。 */
function createReferenceTableRecord(): ThermalCalcRecord {
  return createRecord({
    mode: 'REFERENCE_TABLE',
    input: { mode: 'REFERENCE_TABLE', thicknessMm: 50, regionCode: 'BJ' },
    standard: {
      version: 3,
      regionCode: 'BJ',
      basisName: 'DB11/891',
      clauseRef: '3.3.1',
      limitKValue: 0.25,
      evidenceSource: '北京市地方标准',
      evidenceRef: 'DB11/891-2020',
    },
    result: {
      valid: true,
      mode: 'REFERENCE_TABLE',
      candidates: [
        {
          setId: 'set-1',
          setCode: 'ATLAS-A',
          setVersion: 2,
          thicknessMm: 50,
          productThermalResistance: 1.6129,
          totalThermalResistance: 1.7939,
          totalThermalResistanceRounded: 1.7939,
          kValue: 0.5574,
          kValueRounded: 0.5574,
          evidenceSource: '图集节能计算参考选用表',
          evidenceRef: '第 12 页 表 4',
          evidenceLevel: 'A',
          compliant: true,
        },
        {
          setId: 'set-2',
          setCode: 'ATLAS-B',
          setVersion: 1,
          thicknessMm: 50,
          productThermalResistance: 1.55,
          totalThermalResistance: 1.73,
          totalThermalResistanceRounded: 1.73,
          kValue: 0.578,
          kValueRounded: 0.578,
          evidenceSource: '图集节能计算参考选用表',
          evidenceRef: '第 30 页 表 7',
          evidenceLevel: 'B',
          compliant: true,
        },
      ],
      compliant: true,
      errors: [],
      notes: [],
    },
  })
}

describe('thermalCalcResultSummary · REFERENCE_TABLE', () => {
  it('reads dual R and K from the first reference candidate instead of top-level fields', () => {
    const summary = thermalCalcResultSummary(createReferenceTableRecord())
    expect(summary.productResistance).toBe(1.6129)
    expect(summary.totalResistance).toBe(1.7939)
    expect(summary.kValue).toBe(0.5574)
    expect(summary.candidateCount).toBe(2)
  })

  it('falls back to the standard limit snapshot when result carries no limitKValue', () => {
    const summary = thermalCalcResultSummary(createReferenceTableRecord())
    expect(summary.limitKValue).toBe(0.25)
    expect(summary.compliant).toBe(true)
    expect(summary.thicknessMm).toBe(50)
  })

  it('uses the first reference row compliance when the response has no top-level verdict', () => {
    const record = createReferenceTableRecord()
    delete record.result.compliant
    expect(thermalCalcResultSummary(record).compliant).toBe(true)
  })

  it('returns nulls and zero candidates when the reference table has no exact match', () => {
    const record = createRecord({
      mode: 'REFERENCE_TABLE',
      input: { thicknessMm: 55 },
      standard: { limitKValue: 0.25 },
      result: { valid: true, mode: 'REFERENCE_TABLE', candidates: [], compliant: null, notes: ['没有精确匹配行'] },
    })
    const summary = thermalCalcResultSummary(record)
    expect(summary.productResistance).toBeNull()
    expect(summary.totalResistance).toBeNull()
    expect(summary.kValue).toBeNull()
    expect(summary.candidateCount).toBe(0)
    expect(summary.limitKValue).toBe(0.25)
  })

  it('keeps EQUIVALENT/LAYERED records on the top-level result fields', () => {
    const record = createRecord({
      mode: 'LAYERED',
      rule: { code: 'RULE-A', version: 4, name: '分层法', interiorSurfaceResistance: 0.11, exteriorSurfaceResistance: 0.04 },
      result: {
        productResistance: 1.6,
        productResistanceRounded: 1.6129,
        totalResistance: 1.79,
        totalResistanceRounded: 1.7939,
        kValue: 0.557,
        kValueRounded: 0.5574,
        compliant: false,
        limitKValue: 0.25,
      },
    })
    const summary = thermalCalcResultSummary(record)
    expect(summary.productResistance).toBe(1.6129)
    expect(summary.totalResistance).toBe(1.7939)
    expect(summary.kValue).toBe(0.5574)
    expect(summary.limitKValue).toBe(0.25)
    expect(summary.compliant).toBe(false)
    expect(summary.ruleCode).toBe('RULE-A')
    expect(summary.interiorSurfaceResistance).toBe(0.11)
    expect(summary.candidateCount).toBe(0)
  })
})

describe('thermalCalcReferenceCandidates', () => {
  it('preserves backend ordering and prefers rounded values', () => {
    const candidates = thermalCalcReferenceCandidates(createReferenceTableRecord())
    expect(candidates.map(item => item.setCode)).toEqual(['ATLAS-A', 'ATLAS-B'])
    expect(candidates[0]).toMatchObject({
      totalThermalResistance: 1.7939,
      kValue: 0.5574,
      evidenceLevel: 'A',
      compliant: true,
    })
  })

  it('tolerates a non-array candidates field', () => {
    const record = createRecord({ result: { candidates: 'nope' } })
    expect(thermalCalcReferenceCandidates(record)).toEqual([])
  })
})

describe('thermalCalcEvidence', () => {
  it('prefers atlas evidence over standard snapshot for reference-table results', () => {
    const evidence = thermalCalcEvidence(createReferenceTableRecord())
    expect(evidence.source).toBe('图集节能计算参考选用表')
    expect(evidence.ref).toBe('第 12 页 表 4')
    expect(evidence.level).toBe('A')
    expect(evidence.limitVersion).toBe(3)
    expect(evidence.candidateCount).toBe(2)
    expect(thermalCalcEvidenceLabel(evidence)).toBe('图集节能计算参考选用表 · 第 12 页 表 4')
  })

  it('falls back to rule and standard snapshot for computed results', () => {
    const record = createRecord({
      mode: 'EQUIVALENT',
      ruleVersion: 4,
      limitVersion: 3,
      rule: { code: 'RULE-A', version: 4, evidenceSource: '企业标准', evidenceRef: 'Q/LG 001' },
      standard: { basisName: 'DB11/891', clauseRef: '3.3.1', version: 3 },
    })
    const evidence = thermalCalcEvidence(record)
    expect(evidence.source).toBe('DB11/891')
    expect(evidence.ref).toBe('3.3.1')
    expect(evidence.ruleCode).toBe('RULE-A')
    expect(evidence.ruleVersion).toBe(4)
    expect(evidence.candidateCount).toBe(0)
  })

  it('returns an empty label when no evidence exists', () => {
    expect(thermalCalcEvidenceLabel(thermalCalcEvidence(createRecord()))).toBeNull()
  })
})

describe('thermal calc mode labels', () => {
  it('shows business labels for the three backend modes', () => {
    expect(thermalCalcModeLabel('EQUIVALENT')).toBe('等效热阻计算')
    expect(THERMAL_CALC_MODE_OPTIONS.map(item => item.label)).toEqual(['参考构造', '等效热阻计算', '分层构造计算'])
  })

  it('distinguishes reference-table results from computed results', () => {
    expect(thermalCalcSourceLabel('REFERENCE_TABLE')).toBe('图集参考值')
    expect(thermalCalcSourceLabel('EQUIVALENT')).toBe('系统计算结果')
    expect(thermalCalcSourceLabel('LAYERED')).toBe('系统计算结果')
  })
})

/**
 * 阶段3：层表 R 必须按步骤 key 里的层序绑定。
 * 旧实现按「步骤数组下标」兜底，在下面两种真实场景下会把别的层的 R 贴到这一层：
 * - EQUIVALENT（整体当量法）产品层步骤 key 是 product_N，不在 layer_* 里；
 * - includeNonProductLayers=false 时非产品层根本不产生步骤。
 */
describe('thermalCalcLayerRows · 层热阻按层序绑定', () => {
  const layeredRecord = (overrides: Partial<ThermalCalcRecord> = {}): ThermalCalcRecord => createRecord({
    mode: 'LAYERED',
    layers: [
      { layerOrder: 1, layerType: 'PRODUCT_LAYER', layerName: 'VICP 板', thicknessM: 0.035, lambda: 0.008, correctionFactor: 1.25 },
      { layerOrder: 2, layerType: 'BASE_LAYER', layerName: '钢筋混凝土', thicknessM: 0.2, lambda: 1.74, correctionFactor: 1 },
      { layerOrder: 3, layerType: 'FIXING_LAYER', layerName: '粘结砂浆', thicknessM: 0.01, lambda: 0.93, correctionFactor: 1 },
    ],
    steps: [
      { key: 'layer_1', value: 3.5, rounded: 3.5 },
      { key: 'layer_2', value: 0.1149, rounded: 0.1149 },
      { key: 'layer_3', value: 0.0108, rounded: 0.0108 },
    ],
    ...overrides,
  })

  it('LAYERED：每层取到自己那一步的 R', () => {
    const rows = thermalCalcLayerRows(layeredRecord())
    expect(rows.map(row => row.order)).toEqual([1, 2, 3])
    expect(rows.map(row => row.rValue)).toEqual([3.5, 0.1149, 0.0108])
    expect(rows.map(row => row.layerTypeLabel)).toEqual(['产品层', '基层', '固定层'])
  })

  it('EQUIVALENT：产品层步骤 key 为 product_N，仍能绑定到产品层', () => {
    const record = layeredRecord({
      mode: 'EQUIVALENT',
      steps: [
        { key: 'product_1', value: 3.5, rounded: 3.5 },
        { key: 'layer_2', value: 0.1149, rounded: 0.1149 },
        { key: 'layer_3', value: 0.0108, rounded: 0.0108 },
      ],
    })
    const rows = thermalCalcLayerRows(record)
    expect(rows[0]!.rValue).toBe(3.5)
    expect(rows[1]!.rValue).toBe(0.1149)
    expect(rows[2]!.rValue).toBe(0.0108)
  })

  it('includeNonProductLayers=false：没有步骤的层留空，不得用相邻层的 R 顶替', () => {
    const record = layeredRecord({ steps: [{ key: 'layer_1', value: 3.5, rounded: 3.5 }] })
    const rows = thermalCalcLayerRows(record)
    expect(rows[0]!.rValue).toBe(3.5)
    // 旧实现会在这里给出 3.5（下标兜底），把产品层 R 贴到基层上。
    expect(rows[1]!.rValue).toBeNull()
    expect(rows[2]!.rValue).toBeNull()
  })

  it('层序不连续（快照只保留部分层）时按 key 取，不按下标平移', () => {
    const record = layeredRecord({
      layers: [
        { layerOrder: 2, layerType: 'BASE_LAYER', layerName: '钢筋混凝土', thicknessM: 0.2, lambda: 1.74, correctionFactor: 1 },
        { layerOrder: 5, layerType: 'FIXING_LAYER', layerName: '粘结砂浆', thicknessM: 0.01, lambda: 0.93, correctionFactor: 1 },
      ],
      steps: [
        { key: 'layer_2', value: 0.1149, rounded: 0.1149 },
        { key: 'layer_5', value: 0.0108, rounded: 0.0108 },
      ],
    })
    expect(thermalCalcLayerRows(record).map(row => row.rValue)).toEqual([0.1149, 0.0108])
  })
})

describe('厚度标签绑定产品层，不冒充保温层厚度', () => {
  it('单产品层显示「产品厚度」', () => {
    const summary = thermalCalcResultSummary(createRecord({
      input: { thicknessMm: 25 },
      layers: [{ layerOrder: 1, layerType: 'PRODUCT_LAYER', layerName: 'VICP 板' }],
    }))
    expect(summary.productLayerCount).toBe(1)
    expect(thermalCalcThicknessLabel(summary)).toBe('产品厚度')
  })

  it('多产品子层显示「产品总厚度（N 个子层）」', () => {
    const summary = thermalCalcResultSummary(createRecord({
      input: { thicknessMm: 35 },
      layers: [
        { layerOrder: 1, layerType: 'PRODUCT_LAYER', layerName: '包覆层' },
        { layerOrder: 2, layerType: 'PRODUCT_LAYER', layerName: '芯材' },
        { layerOrder: 3, layerType: 'PRODUCT_LAYER', layerName: '包覆层' },
      ],
    }))
    expect(summary.productLayerCount).toBe(3)
    expect(thermalCalcThicknessLabel(summary)).toBe('产品总厚度（3 个子层）')
  })
})
