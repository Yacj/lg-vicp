/**
 * C 端回答体验：聊天正文只原样拼接服务端 user-visible content。
 * 过程话术 / Tool 名隔离由 Backend Agent Step 负责，前端不得用语义 Regex 改写正文。
 */

import type { ProductCardItem, ProductComparisonView } from './aiComparison'

export const DEFAULT_STATUS_COPY = '正在整理结果…'
export const REPORT_STATUS_COPY = '正在生成报告…'

const SOURCE_INQUIRY_PATTERN = /怎么得到|怎么查到|依据是什么|用了哪些资料|来源是什么|参考了什么|根据什么资料|你是怎么/
const PROFESSIONAL_MARKER_PATTERN = /传热系数|热阻|导热系数|计算公式|施工节点|规范条文|K\s*[=＝]|R\s*[=＝]|U\s*[=＝]/
const PROFESSIONAL_CHAR_THRESHOLD = 420

export interface AnswerLayers {
  summary: string
  details: string
  collapsible: boolean
}

export type ComparisonAttachAction = 'skip' | 'replace' | 'insert'

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 流式正文只做拼接，禁止删除或改写任何原始字符。 */
export function appendAssistantDelta(current: string, delta: string): string {
  return `${current}${delta}`
}

/** 历史 Assistant 正文必须等于服务器保存的 user-visible content。 */
export function restoreAssistantContent(serverContent: string): string {
  return serverContent
}

export function isSourceInquiry(value: string) {
  return SOURCE_INQUIRY_PATTERN.test(value.trim())
}

export function splitAnswerLayers(value: string, options: { forceExpand?: boolean } = {}): AnswerLayers {
  const text = value.trim()
  if (!text || options.forceExpand) {
    return { summary: text, details: '', collapsible: false }
  }
  const paragraphs = text.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  const professional = text.length >= PROFESSIONAL_CHAR_THRESHOLD || PROFESSIONAL_MARKER_PATTERN.test(text)
  if (!professional && paragraphs.length <= 2) {
    return { summary: text, details: '', collapsible: false }
  }

  if (paragraphs.length === 1) {
    const sentences = splitSentences(text)
    if (sentences.length <= 2) {
      return { summary: text, details: '', collapsible: false }
    }
    const summary = sentences.slice(0, 2).join('')
    const details = sentences.slice(2).join('')
    return { summary, details, collapsible: Boolean(details) }
  }

  let start = 1
  let summary = paragraphs[0]
  if (summary.length < 40 && paragraphs[1]) {
    summary = `${paragraphs[0]}\n\n${paragraphs[1]}`
    start = 2
  }
  const details = paragraphs.slice(start).join('\n\n')
  return { summary, details, collapsible: Boolean(details) }
}

export function formatReportCompletedMessage(_productNames: string[] = []) {
  return '报告已生成。'
}

export function isReportDump(value: string, productNames: string[] = []) {
  const text = value.trim()
  if (!text) {
    return true
  }
  if (text.length > 280) {
    return true
  }
  const hits = productNames.filter(name => name && text.includes(name)).length
  return hits >= 2 && text.length > 80
}

export function previousUserText<T extends { role: string, content?: string }>(messages: T[], assistantIndex: number) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'USER') {
      return asText(messages[index].content)
    }
  }
  return ''
}

export function resolveComparisonAttachAction(
  next: Pick<ProductComparisonView, 'comparisonId' | 'version'>,
  messages: Array<{ id?: string, comparison?: Pick<ProductComparisonView, 'comparisonId' | 'version'> | null }>,
  latestId?: string,
): ComparisonAttachAction {
  const existing = [...messages].reverse().find(item => item.comparison?.comparisonId && item.comparison.comparisonId === next.comparisonId)
  if (!existing?.comparison) {
    return 'insert'
  }
  if (existing.comparison.version === next.version) {
    return 'skip'
  }
  if (existing.id && latestId && existing.id === latestId) {
    return 'replace'
  }
  return 'replace'
}

export function sameProductCards(previous: ProductCardItem[] | undefined, next: ProductCardItem[]) {
  if (!previous?.length || !next.length || previous.length !== next.length) {
    return false
  }
  return previous.map(item => item.id).join('|') === next.map(item => item.id).join('|')
}

function splitSentences(value: string) {
  const parts: string[] = []
  let buffer = ''
  for (const char of value) {
    buffer += char
    if (char === '。' || char === '！' || char === '？') {
      parts.push(buffer)
      buffer = ''
    }
  }
  if (buffer.trim()) {
    parts.push(buffer)
  }
  return parts.map(item => item.trim()).filter(Boolean)
}

export function shouldAttachProductCards(
  next: ProductCardItem[],
  messages: Array<{ products?: ProductCardItem[] | null, comparison?: { products?: ProductCardItem[] } | null }>,
) {
  if (!next.length) {
    return false
  }
  return !messages.some(item => sameProductCards(item.products || undefined, next)
    || sameProductCards(item.comparison?.products, next))
}
