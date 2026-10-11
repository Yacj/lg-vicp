import type { AiReferencePage } from '@/api/reference-page'
import MarkdownIt from 'markdown-it'
import { hasPageRenderModel, normalizeReferencePages, referenceSolutions } from './referencePage'

interface SourceBlock { start: number, end: number, kind: string }
interface BlockToken { type: string, level: number, map?: [number, number] | null }
export interface ReferenceAnswerBlock { content: string, pages: AiReferencePage[] }
const parser = new MarkdownIt({ html: false })

/** Markdown 分块仅用于展示，参数与段落关联都来自 Backend，不搜索回答中的数值或构造。 */
export function referenceAnswerContent(answer: string, references: AiReferencePage[], compact = false): { blocks: ReferenceAnswerBlock[], leadingPages: AiReferencePage[] } {
  const lineOffsets = [0]
  for (let index = 0; index < answer.length; index++) {
    if (answer[index] === '\n')
      lineOffsets.push(index + 1)
  }
  const spans: SourceBlock[] = []
  for (const token of parser.parse(answer, {}) as BlockToken[]) {
    if (!token.map || !((token.level === 0 && !['bullet_list_open', 'ordered_list_open'].includes(token.type)) || token.type === 'list_item_open'))
      continue
    const start = lineOffsets[token.map[0]] ?? answer.length
    const end = lineOffsets[token.map[1]] ?? answer.length
    if (spans.some(block => start >= block.start && end <= block.end))
      continue
    spans.push({ start, end, kind: token.type })
  }
  const placements = new Map<number, AiReferencePage[]>()
  const replaced = new Map<number, SourceBlock>()
  const leadingPages: AiReferencePage[] = []
  for (const page of normalizeReferencePages(references)) {
    const buckets = new Map<number, AiReferencePage['matches']>()
    for (const match of page.matches) {
      const block = typeof match.answerOffset === 'number' && match.answerOffset > 0 && match.answerOffset <= answer.length
        ? spans.find(item => match.answerOffset! > item.start && match.answerOffset! <= item.end && ['paragraph_open', 'heading_open', 'list_item_open'].includes(item.kind))
        : undefined
      const end = block?.end ?? -1
      buckets.set(end, [...(buckets.get(end) || []), match])
      // 仅替换已由正式模型绑定的方案段落；说明、结论、旧消息及无法定位的正文保留。
      if (compact && page.answerStyle === 'THERMAL_SOLUTIONS' && hasPageRenderModel(page.renderModel) && block && referenceSolutions({ ...page, matches: [match] }).length)
        replaced.set(end, block)
    }
    if (!buckets.size)
      buckets.set(-1, [])
    for (const [end, matches] of buckets) {
      const group = { ...page, matches }
      if (end < 0)
        leadingPages.push(group)
      else placements.set(end, [...(placements.get(end) || []), group])
    }
  }
  const blocks: ReferenceAnswerBlock[] = []
  let cursor = 0
  for (const end of [...placements.keys()].sort((left, right) => left - right)) {
    const span = replaced.get(end)
    blocks.push({ content: answer.slice(cursor, span ? Math.max(cursor, span.start) : end), pages: placements.get(end)! })
    cursor = end
  }
  if (cursor < answer.length || !blocks.length)
    blocks.push({ content: answer.slice(cursor), pages: [] })
  return { blocks, leadingPages }
}

/** 回答中同一来源页只嵌入一次完整表格，合并该页全部正式命中；摘要仍按正式段落位置处理。 */
export function referenceAnswerPageContent(answer: string, references: AiReferencePage[]): { blocks: ReferenceAnswerBlock[], leadingPages: AiReferencePage[] } {
  const pages = normalizeReferencePages(references)
  const content = referenceAnswerContent(answer, pages, true)
  const seen = new Set<string>()
  const project = (placements: AiReferencePage[]) => placements.flatMap((placement) => {
    const key = JSON.stringify([placement.page.documentId, placement.page.pageId])
    if (seen.has(key))
      return []
    seen.add(key)
    return pages.filter(page => page.page.documentId === placement.page.documentId && page.page.pageId === placement.page.pageId)
  })
  return { leadingPages: project(content.leadingPages), blocks: content.blocks.map(block => ({ ...block, pages: project(block.pages) })) }
}
