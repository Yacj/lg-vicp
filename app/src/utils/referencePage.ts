import type { AiReferencePage, KnowledgePageRenderModel, ReferenceHighlight, ReferencePageMatch, ReferencePageSummary, RenderNumber, ThermalRenderOption } from '@/api/reference-page'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function hasPageRenderModel(value: unknown): value is KnowledgePageRenderModel {
  if (!record(value) || !Array.isArray(value.constructions))
    return false
  const ids = new Set<string>()
  return value.constructions.every((construction: unknown) => {
    if (!record(construction) || typeof construction.constructionId !== 'string' || !construction.constructionId || ids.has(construction.constructionId))
      return false
    ids.add(construction.constructionId)
    if (!Array.isArray(construction.layers) || !construction.layers.every(layer => record(layer) && typeof layer.name === 'string'))
      return false
    const optionIds = new Set<string>()
    return Array.isArray(construction.options) && construction.options.every((option: unknown) => {
      if (!record(option) || typeof option.optionId !== 'string' || !option.optionId || optionIds.has(option.optionId))
        return false
      optionIds.add(option.optionId)
      return true
    })
  })
}

export function formatReferenceNumber(value: RenderNumber | undefined, decimals?: number): string {
  if (typeof value === 'string')
    return value || '—'
  if (value == null || !Number.isFinite(value))
    return '—'
  if (decimals == null)
    return String(value)
  return Number(value.toFixed(decimals)) === value ? value.toFixed(decimals) : String(value)
}

/** 仅对 Backend 页面标题做视觉分层，不从回答识别系统或参数。 */
export function referencePageHeading(model: KnowledgePageRenderModel | null | undefined): { title: string, subtitle: string } {
  const title = model?.pageTitle?.trim() || ''
  const parts = title.match(/^(.*?)[（(]([^（）()]*系统)[）)]\s*$/)
  if (parts?.[1]?.trim() && parts[2]?.trim())
    return { title: parts[2].trim(), subtitle: parts[1].trim() }
  const systems = [...new Set(model?.constructions.map(item => item.systemName?.trim()).filter((name): name is string => !!name && name !== title && name.endsWith('系统')))]
  return systems.length === 1 ? { title: systems[0]!, subtitle: title } : { title, subtitle: '' }
}

export function referencePageInitialView(view: unknown): '原始页面' | '页面内容' {
  return view === 'image' ? '原始页面' : '页面内容'
}

/** 来源图片页只显示正式页标题，将选用表名称放在构造名称之后。 */
export function referencePageImageTitle(title: string): string {
  const value = title.trim()
  const parts = value.match(/^(.+参考选用表)\s*[（(]([^（）()]+)[）)]\s*$/)
  return parts ? `${parts[2]!.trim()}（${parts[1]!.trim()}）` : value
}

export function resolvePageHighlights(model: KnowledgePageRenderModel | null | undefined, matches: ReferenceHighlight[], pageId: string): ReferenceHighlight[] {
  if (!hasPageRenderModel(model))
    return []
  const result: ReferenceHighlight[] = []
  for (const match of matches) {
    if (match.pageId && match.pageId !== pageId)
      continue
    const owners = model.constructions.filter(construction => (!match.constructionId || match.constructionId === construction.constructionId)
      && (match.optionId ? construction.options.some(option => option.optionId === match.optionId) : !!match.constructionId))
    if (owners.length !== 1)
      continue
    const constructionId = owners[0]!.constructionId
    const existing = result.find(item => item.constructionId === constructionId && item.optionId === match.optionId)
    if (existing)
      existing.fieldKeys = [...new Set([...(existing.fieldKeys || []), ...(match.fieldKeys || [])])]
    else result.push({ ...match, constructionId, fieldKeys: [...(match.fieldKeys || [])] })
  }
  return result
}

function normalizeMatch(value: unknown): ReferencePageMatch | null {
  if (!record(value))
    return null
  const summary = normalizeSummary(value.summary)
  const constructionId = text(value.constructionId)
  const optionId = text(value.optionId)
  const candidateId = text(value.candidateId)
  if (!constructionId && !optionId && !candidateId && !summary)
    return null
  return { pageId: text(value.pageId) || undefined, constructionId: constructionId || undefined, optionId: optionId || undefined, candidateId: candidateId || undefined, fieldKeys: Array.isArray(value.fieldKeys) ? value.fieldKeys.filter((key): key is string => typeof key === 'string') : [], ...(typeof value.answerOffset === 'number' && Number.isInteger(value.answerOffset) && value.answerOffset >= 0 ? { answerOffset: value.answerOffset } : {}), ...(summary ? { summary } : {}) }
}
function normalizeSummary(value: unknown): ReferencePageSummary | undefined {
  if (!record(value))
    return undefined
  const result: ReferencePageSummary = {}
  for (const key of ['systemType', 'constructionCode', 'productName'] as const) {
    if (typeof value[key] === 'string')
      result[key] = value[key]
  }
  for (const key of ['thicknessMm', 'productThermalResistance', 'totalThermalResistance', 'kValue'] as const) {
    const number = value[key]
    if (number === null || typeof number === 'string' || (typeof number === 'number' && Number.isFinite(number)))
      result[key] = number
  }
  return Object.keys(result).length ? result : undefined
}

/** 新消息的嵌套页与旧消息的扁平页均保留；数值参数条不是定位标识。 */
export function normalizeReferencePages(value: unknown): AiReferencePage[] {
  if (!Array.isArray(value))
    return []
  const pages: AiReferencePage[] = []
  for (const raw of value) {
    if (!record(raw))
      continue
    const source = record(raw.page) ? raw.page : raw
    const pageId = text(source.pageId)
    const documentId = text(source.documentId)
    if (!pageId || !documentId)
      continue
    const matches = [...(Array.isArray(raw.matches) ? raw.matches : []), ...(Array.isArray(raw.highlights) ? raw.highlights : []), ...(raw.referenceHighlight ? [raw.referenceHighlight] : [])]
      .map(normalizeMatch)
      .filter((match): match is ReferencePageMatch => !!match)
    const page: AiReferencePage = { type: 'REFERENCE_PAGE', page: { pageId, documentId, documentTitle: text(source.documentTitle) || text(source.title), pageLabel: text(source.pageLabel) || undefined, docNumber: text(source.docNumber) || undefined, imageUrl: text(source.imageUrl) || text(source.pageImageUrl) || text(raw.pageImageUrl) || text(raw.pageImage) }, renderModel: hasPageRenderModel(raw.renderModel) ? raw.renderModel : null, summary: normalizeSummary(raw.summary), matches }
    const existing = pages.find(item => item.page.pageId === pageId && item.page.documentId === documentId)
    if (raw.answerStyle === 'THERMAL_SOLUTIONS')
      page.answerStyle = 'THERMAL_SOLUTIONS'
    const primaryFields = raw.primaryFieldKeys
    if (Array.isArray(primaryFields))
      page.primaryFieldKeys = (['thicknessMm', 'productThermalResistance', 'totalThermalResistance', 'kValue'] as const).filter(key => primaryFields.includes(key))
    if (existing) {
      // 模型版本改变时只接受新模型的标识，绝不把不同快照的行合在一起。
      if (page.renderModel)
        existing.renderModel = page.renderModel
      existing.page = { ...existing.page, ...page.page, imageUrl: page.page.imageUrl || existing.page.imageUrl, documentTitle: page.page.documentTitle || existing.page.documentTitle, pageLabel: page.page.pageLabel || existing.page.pageLabel, docNumber: page.page.docNumber || existing.page.docNumber }
      existing.matches = mergeMatches([...existing.matches, ...matches])
      existing.summary = page.summary || existing.summary
      existing.answerStyle = page.answerStyle || existing.answerStyle
      existing.primaryFieldKeys = page.primaryFieldKeys || existing.primaryFieldKeys
    }
    else {
      pages.push({ ...page, matches: mergeMatches(matches) })
    }
  }
  return pages
}
function mergeMatches(matches: ReferencePageMatch[]): ReferencePageMatch[] {
  const result: ReferencePageMatch[] = []
  const sameTarget = (left: ReferencePageMatch, right: ReferencePageMatch) => (!left.pageId || !right.pageId || left.pageId === right.pageId)
    && left.constructionId === right.constructionId && left.optionId === right.optionId
    && (left.optionId ? true : left.candidateId === right.candidateId)
  for (const match of matches) {
    const previous = result.find(item => sameTarget(item, match) && item.answerOffset === match.answerOffset)
    if (previous && (match.optionId || match.constructionId || match.candidateId))
      previous.fieldKeys = [...new Set([...(previous.fieldKeys || []), ...(match.fieldKeys || [])])]
    else result.push({ ...match, fieldKeys: [...(match.fieldKeys || [])] })
  }
  // 流事件先给正式档位，最终回答再补段落位置；已定位的引用接替待定位引用。
  // 同一档位在不同正式段落的引用仍分别保留，不依据正文或数值猜测。
  return result.filter((match) => {
    if (!match.optionId || (match.answerOffset != null && match.answerOffset > 0))
      return true
    const positioned = result.filter(item => sameTarget(item, match) && item.answerOffset != null && item.answerOffset > 0)
    for (const item of positioned) {
      item.fieldKeys = [...new Set([...(match.fieldKeys || []), ...(item.fieldKeys || [])])]
    }
    return positioned.length === 0
  })
}

/** 卡片与高亮项共用正式原页同一行，summary 不能覆盖原页数值。 */
export function referenceSolutions(page: AiReferencePage): Array<{ key: string, match?: ReferenceHighlight, title: string, system: string, base?: string, option: Omit<ThermalRenderOption, 'optionId'> }> {
  if (hasPageRenderModel(page.renderModel)) {
    return resolvePageHighlights(page.renderModel, page.matches, page.page.pageId).flatMap((match) => {
      const construction = page.renderModel!.constructions.find(item => item.constructionId === match.constructionId)!
      const option = construction.options.find(item => item.optionId === match.optionId)
      const title = construction.constructionCode || construction.title || '参考构造'
      const system = construction.systemName && construction.systemName !== title ? construction.systemName : construction.material?.name || (construction.specClass ? `${construction.specClass}型VICP` : '')
      return option ? [{ key: `${construction.constructionId}-${option.optionId}`, match, title, system, base: construction.baseMaterial ? `${construction.baseMaterial}${construction.baseThicknessMm != null ? ` ${formatReferenceNumber(construction.baseThicknessMm)}mm` : ''}基层` : undefined, option }] : []
    })
  }
  const summaries = page.matches.length ? page.matches.flatMap(match => match.summary ? [match.summary] : []) : page.summary ? [page.summary] : []
  return summaries.filter(summary => summary.thicknessMm != null || summary.kValue != null).map((summary, index) => ({ key: `summary-${index}`, title: summary.constructionCode || '参考方案', system: summary.systemType || summary.productName || '', option: summary }))
}

/** 签名地址只用于当前内存会话，持久化时去除；重新进入来源页向 Backend 获取。 */
export function withoutReferenceImageUrls(pages: AiReferencePage[]): AiReferencePage[] {
  return pages.map(page => ({ ...page, page: { ...page.page, imageUrl: '' } }))
}

export function referencePersistenceSnapshot(state: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(state.messages))
    return state
  return { ...state, messages: state.messages.map(message => record(message) && Array.isArray(message.referencePages)
    ? { ...message, referencePages: withoutReferenceImageUrls(normalizeReferencePages(message.referencePages)) }
    : message) }
}

/** 服务器未带来源字段时，仅恢复同一会话、相同消息和原样正文的已接收来源。 */
export function restoreMessageReferences<T extends { id: string, conversationId: string, content: string, referencePages?: AiReferencePage[] }>(messages: T[], previous: T[]): T[] {
  return messages.map((message) => {
    if ('referencePages' in message)
      return message
    const cached = previous.find(item => item.id === message.id && item.conversationId === message.conversationId && item.content === message.content)
    return cached?.referencePages?.length ? { ...message, referencePages: withoutReferenceImageUrls(normalizeReferencePages(cached.referencePages)) } : message
  })
}
