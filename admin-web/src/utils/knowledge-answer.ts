import type { KnowledgeReferencePageBlock, KnowledgeReferencePageMatch } from '@/types/knowledge'
import { marked, type Tokens } from 'marked'

export interface KnowledgeAnswerMatchGroup {
  key: string
  constructionCode: string
  page: KnowledgeReferencePageBlock['page']
  renderModel?: KnowledgeReferencePageBlock['renderModel']
  matches: KnowledgeReferencePageMatch[]
}
export interface KnowledgeAnswerBlock {
  content: string
  kind: string
  groups: KnowledgeAnswerMatchGroup[]
  start?: number
  end?: number
}

function answerBlockAt(blocks: KnowledgeAnswerBlock[], offset: number | undefined): number {
  if (offset == null || !Number.isInteger(offset) || offset < 0) return -1
  let index = blocks.findIndex(item => item.start != null && item.end != null && offset > item.start && offset <= item.end)
  while (index >= 0 && blocks[index]?.kind === 'space') index--
  return index >= 0 && ['paragraph', 'list_item', 'heading'].includes(blocks[index]!.kind) ? index : -1
}

/** 仅把后端匹配方案放到回答中的构造段落，不从回答提取厚度/R/K。 */
export function knowledgeAnswerContent(answer: string, pages: KnowledgeReferencePageBlock[]): { blocks: KnowledgeAnswerBlock[], unplacedCount: number } {
  let offset = 0
  const blocks: KnowledgeAnswerBlock[] = marked.lexer(answer).flatMap((token) => {
    const start = offset
    offset += token.raw.length
    if (token.type !== 'list') return [{ content: token.raw, kind: token.type, groups: [], start, end: offset }]
    let cursor = 0
    return (token as Tokens.List).items.map((item) => {
      const index = token.raw.indexOf(item.raw, cursor)
      cursor = index + item.raw.length
      return { content: item.raw, kind: 'list_item', groups: [], start: start + index, end: start + cursor }
    })
  })
  const groups: KnowledgeAnswerMatchGroup[] = []
  let unplacedCount = 0
  for (const block of pages) {
    const matches = block.matches?.length ? block.matches : [{ ...block, highlights: block.highlights ?? [] }]
    for (const match of matches) {
      const section = match.constructionId
        ? block.renderModel?.constructions.find(item => item.constructionId === match.constructionId
          && (!match.optionId || item.options.some(option => option.optionId === match.optionId)))
        : undefined
      const constructionCode = match.summary.constructionCode?.trim() || section?.rawConstructionLabel || section?.systemName || ''
      if (!constructionCode) { unplacedCount++; continue }
      const anchor = answerBlockAt(blocks, match.answerOffset)
      if (match.answerOffset != null && anchor < 0) { unplacedCount++; continue }
      const key = `${block.page.pageId}:${section && anchor >= 0 ? 'confirmed-page' : section?.constructionId || constructionCode}${anchor >= 0 ? `:${anchor}` : ''}`
      let group = groups.find(item => item.key === key)
      if (!group) { group = { key, constructionCode, page: block.page, renderModel: block.renderModel, matches: [] }; groups.push(group) }
      const existing = match.optionId ? group.matches.find(item => item.optionId === match.optionId && item.constructionId === match.constructionId) : undefined
      if (existing) existing.fieldKeys = [...new Set([...(existing.fieldKeys ?? []), ...(match.fieldKeys ?? [])])]
      else if ((match.optionId && match.constructionId) || !match.candidateId || !group.matches.some(item => item.candidateId === match.candidateId)) group.matches.push({ ...match })
    }
  }
  for (const group of groups) {
    const anchor = group.matches[0]?.answerOffset
    const indexByOffset = answerBlockAt(blocks, anchor)
    if (indexByOffset >= 0) { blocks[indexByOffset]!.groups.push(group); continue }
    // 无印刷编号时只使用服务端段落位置，不以口语标签搜索回答。
    if (group.matches.some(match => !match.summary.constructionCode?.trim())) {
      unplacedCount++
      continue
    }
    const code = group.constructionCode.replace(/^外墙\s*/, '')
    // 同一构造编号在不同来源页重复时，需要后端给出段落关联，不能任选一页。
    if (groups.filter(item => item.constructionCode.replace(/^外墙\s*/, '') === code).length !== 1) { unplacedCount++; continue }
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^A-Za-z0-9_=-])${escaped}(?=$|[^A-Za-z0-9_=-])`)
    const eligible = (block: KnowledgeAnswerBlock) => ['paragraph', 'list_item', 'heading'].includes(block.kind) && pattern.test(block.content)
    let index = blocks.findIndex(block => block.kind === 'list_item' && eligible(block))
    if (index < 0) index = blocks.findIndex(eligible)
    if (index < 0) { unplacedCount++; continue }
    // 兼容“构造标题 + 档位列表”：表格放在这组列表之后。
    if (blocks[index]!.kind !== 'list_item') {
      let cursor = index + 1
      while (blocks[cursor]?.kind === 'space') cursor++
      while (blocks[cursor]?.kind === 'list_item' && !groups.some(other => other !== group && blocks[cursor]!.content.includes(other.constructionCode))) index = cursor++
    }
    blocks[index]!.groups.push(group)
  }
  return { blocks, unplacedCount }
}
