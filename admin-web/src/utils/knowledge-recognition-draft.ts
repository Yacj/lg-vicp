import type { RecognitionDraft } from '@/components/business/knowledge/recognition/types'
import type { PageRecognitionResult } from '@/types/knowledge'

/** 编辑态保持全部后端证据；与原对象隔离，数值留空不变成0。 */
export function copyRecognitionDraft(value?: PageRecognitionResult | null): RecognitionDraft {
  if (!value) {
    return { pageLabel: '', pageTitle: '', fullText: '', systems: [] }
  }
  const data: PageRecognitionResult = JSON.parse(JSON.stringify(value))
  return { ...data, pageLabel: data.pageLabel ?? '', pageTitle: data.pageTitle ?? '', systems: data.systems.map(system => ({ ...system, systemName: system.systemName ?? '', specClass: system.specClass ?? undefined, rawConstructionLabel: system.rawConstructionLabel ?? undefined, constructionCodeEvidence: system.constructionCodeEvidence ?? undefined, applicationPart: system.applicationPart ?? undefined, roofForm: system.roofForm ?? undefined, placement: system.placement ?? undefined, waterproofGrade: system.waterproofGrade ?? undefined, constructionCode: system.constructionCode ?? '', baseMaterial: system.baseMaterial ?? '', baseThicknessMm: system.baseThicknessMm ?? undefined, layers: (system.layers ?? []).map(layer => ({ ...layer, sourceLayerLabel: layer.sourceLayerLabel ?? undefined, sourceGroupLabel: layer.sourceGroupLabel ?? undefined, order: layer.order ?? undefined, thicknessMm: layer.thicknessMm ?? undefined, lambda: layer.lambda ?? undefined, alpha: layer.alpha ?? undefined, rValue: layer.rValue ?? undefined })), options: (system.options ?? []).map(option => ({ ...option, thicknessMm: option.thicknessMm ?? undefined, productThermalResistance: option.productThermalResistance ?? undefined, totalThermalResistance: option.totalThermalResistance ?? undefined, kValue: option.kValue ?? undefined })) })) }
}

/** 空编号/空数字显式为空；不计算参数，不从标签提取编号。 */
export function recognitionDraftPayload(draft: RecognitionDraft): PageRecognitionResult {
  return JSON.parse(JSON.stringify({ ...draft, pageLabel: draft.pageLabel?.trim() || null, systems: draft.systems.map(system => ({ ...system, constructionCode: system.constructionCode?.trim() || null, options: system.options.map(option => ({ ...option, thicknessMm: option.thicknessMm ?? null, productThermalResistance: option.productThermalResistance ?? null, totalThermalResistance: option.totalThermalResistance ?? null, kValue: option.kValue ?? null })) })) })) as PageRecognitionResult
}

/** 删除层时仅重排数组引用，已删除层的档位引用一起删除，不串到下一层。 */
export function removeRecognitionLayer(system: RecognitionDraft['systems'][number], index: number): void {
  system.layers.splice(index, 1)
  for (const option of system.options) {
    option.layerValues = option.layerValues?.filter(value => value.layerIndex !== index)
      .map(value => ({ ...value, layerIndex: value.layerIndex > index ? value.layerIndex - 1 : value.layerIndex }))
  }
}
