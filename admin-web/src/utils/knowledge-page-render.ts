import type { KnowledgePageRenderModel, ReferenceHighlight, RenderNumber, ThermalRenderOption } from '@/types/knowledge-page-render'

/** 不改变 Backend 的正式字符串格式；数值仅补足三位，不截断更高精度。 */
export function formatThermalNumber(value: RenderNumber | undefined, decimals = 3): string {
  if (typeof value === 'string') return value || '—'
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(decimals))
  return rounded === value ? value.toFixed(decimals) : String(value)
}

export function formatRenderNumber(value: RenderNumber | undefined): string {
  return value == null || (typeof value === 'number' && !Number.isFinite(value)) || value === '' ? '—' : String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function hasRenderModel(model: unknown): model is KnowledgePageRenderModel {
  if (!isRecord(model) || !Array.isArray(model.constructions)) return false
  const ids = new Set<string>()
  return model.constructions.every((section: unknown) => {
    if (!isRecord(section) || typeof section.constructionId !== 'string' || !section.constructionId || ids.has(section.constructionId)) return false
    ids.add(section.constructionId)
    if (!Array.isArray(section.layers) || !section.layers.every(layer => isRecord(layer) && typeof layer.name === 'string')) return false
    const optionIds = new Set<string>()
    return Array.isArray(section.options) && section.options.every((option: unknown) => {
      if (!isRecord(option) || typeof option.optionId !== 'string' || !option.optionId || optionIds.has(option.optionId)) return false
      optionIds.add(option.optionId)
      return true
    })
  })
}

export function normalizeReferenceHighlights(value: unknown): ReferenceHighlight[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(item => ({
    confirmedRevision: typeof item.confirmedRevision === 'string' ? item.confirmedRevision : undefined,
    answerOffset: typeof item.answerOffset === 'number' && Number.isSafeInteger(item.answerOffset) && item.answerOffset >= 0 ? item.answerOffset : undefined,
    pageId: typeof item.pageId === 'string' ? item.pageId : undefined,
    constructionId: typeof item.constructionId === 'string' ? item.constructionId : undefined,
    optionId: typeof item.optionId === 'string' ? item.optionId : undefined,
    fieldKeys: Array.isArray(item.fieldKeys) ? item.fieldKeys.filter((key): key is string => typeof key === 'string') : [],
  })).filter(item => item.constructionId || item.optionId)
}

export interface ResolvedReferenceHighlight extends ReferenceHighlight {
  constructionId: string
}

/** 无构造标识时只接受全页唯一 optionId，禁止使用数值/候选序号猜测。 */
export function resolveReferenceHighlights(model: KnowledgePageRenderModel | null | undefined, matches: ReferenceHighlight[], pageId?: string | null): ResolvedReferenceHighlight[] {
  if (!hasRenderModel(model)) return []
  const resolved: ResolvedReferenceHighlight[] = []
  for (const match of matches) {
    if (match.confirmedRevision && match.confirmedRevision !== model.confirmedRevision) {
      continue
    }
    if (match.pageId && match.pageId !== pageId) continue
    const sections = model.constructions.filter(section => (!match.constructionId || section.constructionId === match.constructionId)
      && (match.optionId ? section.options.some(option => option.optionId === match.optionId) : !!match.constructionId))
    if (sections.length !== 1) continue
    const constructionId = sections[0]!.constructionId
    const previous = resolved.find(item => item.constructionId === constructionId && item.optionId === match.optionId)
    if (previous) previous.fieldKeys = [...new Set([...(previous.fieldKeys ?? []), ...(match.fieldKeys ?? [])])]
    else resolved.push({ ...match, constructionId, fieldKeys: [...(match.fieldKeys ?? [])] })
  }
  return resolved
}

/** 只提示缺失/无效字段与 Backend 告警，不重算或修正热工值。 */
export function optionHasWarning(option: Omit<ThermalRenderOption, 'optionId'>): boolean {
  return !!option.warnings?.length || [option.thicknessMm, option.productThermalResistance, option.totalThermalResistance, option.kValue]
    .some(value => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0)
}
