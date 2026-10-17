import type { ThermalCalcRecord } from '@/types/thermal'
import TDesign from 'tdesign-vue-next'
import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { thermalCalcEvidence, thermalCalcResultSummary } from '@/utils/thermal-calc'
import ThermalCalcResultCard from './ThermalCalcResultCard.vue'

/**
 * 阶段3：结果卡片的真实 DOM 渲染。
 * 断言的是「用户真正看到什么」：标签是否绑定到正确的指标/单位/厚度语义，
 * 而不是组件内部字段名。三条硬约束：
 * 1. 双 R 必须分开标注（产品层热阻 R ≠ 总热阻 R₀），单位各自跟随；
 * 2. 厚度标签不能是「保温层厚度」——它是产品层总厚度；
 * 3. 不得出现「外墙主断面」这类把构造身份写死的说法。
 */
function createRecord(overrides: Partial<ThermalCalcRecord> = {}): ThermalCalcRecord {
  return {
    id: 'record-1', requestId: 'req-1', mode: 'LAYERED', projectId: null,
    ruleId: null, ruleVersion: null, standardLimitId: null, limitVersion: null,
    input: { thicknessMm: 35 }, layers: [], parameters: [], rule: null, standard: null,
    formulas: {}, steps: [], result: {}, createdById: null, createdAt: '2026-10-17T00:00:00Z',
    ...overrides,
  }
}

function render(record: ThermalCalcRecord): string {
  const container = document.createElement('div')
  const app = createApp({
    render: () => h(ThermalCalcResultCard, {
      mode: record.mode,
      summary: thermalCalcResultSummary(record),
      evidence: thermalCalcEvidence(record),
    }),
  })
  app.use(TDesign)
  app.mount(container)
  return container.textContent ?? ''
}

describe('ThermalCalcResultCard · 真实渲染', () => {
  it('双 R 分开标注，各带自己的单位', async () => {
    const text = render(createRecord({
      result: { productResistance: 5, totalResistance: 5.306822097834988, kValue: 0.18843669178357564 },
    }))
    await nextTick()
    expect(text).toContain('产品层热阻 R')
    expect(text).toContain('总热阻 R₀')
    expect(text).toContain('传热系数 K')
    // R 与 K 的单位不同，不能互相串用。
    expect(text).toContain('m²·K/W')
    expect(text).toContain('W/(m²·K)')
  })

  it('单产品层：厚度标签是「产品厚度」，不是「保温层厚度」', () => {
    const text = render(createRecord({
      layers: [{ layerOrder: 1, layerType: 'PRODUCT_LAYER', layerName: 'VICP 板', thicknessM: 0.025 }],
      result: { productResistance: 4, totalResistance: 4.3068, kValue: 0.2322 },
    }))
    expect(text).toContain('产品厚度')
    expect(text).not.toContain('保温层厚度')
  })

  it('多产品子层：厚度标签点明子层数（甲方分层例 10+15+10=35mm）', () => {
    const text = render(createRecord({
      input: { thicknessMm: 35 },
      layers: [
        { layerOrder: 1, layerType: 'PRODUCT_LAYER', layerName: '包覆层', thicknessM: 0.01 },
        { layerOrder: 2, layerType: 'PRODUCT_LAYER', layerName: '芯材', thicknessM: 0.015 },
        { layerOrder: 3, layerType: 'PRODUCT_LAYER', layerName: '包覆层', thicknessM: 0.01 },
      ],
      result: { productResistance: 5, totalResistance: 5.3068, kValue: 0.1884 },
    }))
    expect(text).toContain('产品总厚度（3 个子层）')
    expect(text).toContain('35')
  })

  it('不得把总热阻写成「外墙主断面」', () => {
    const text = render(createRecord({
      result: { productResistance: 4, totalResistance: 4.3068, kValue: 0.2322 },
      standard: { basisName: 'DB11/891', clauseRef: '3.3.1', limitKValue: 0.25 },
    }))
    expect(text).not.toContain('外墙主断面')
    expect(text).toContain('总热阻 R₀')
  })
})
