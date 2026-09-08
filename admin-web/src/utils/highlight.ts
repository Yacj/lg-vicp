/**
 * 原文高亮分段纯函数：把命中区间（charStart/charEnd 或文本匹配）投影为原文分段。
 * 查找失败时只丢失高亮、不丢失原文——完整页内容始终完整返回。
 */

export interface HighlightRangeInput {
  charStart?: number | null
  charEnd?: number | null
  text?: string | null
}

export interface HighlightSegment {
  text: string
  highlighted: boolean
}

interface CoordinateRange {
  kind: 'coordinate'
  start: number
  end: number
}

interface TextRange {
  kind: 'text'
  text: string
}

type HighlightRange = CoordinateRange | TextRange

function normalizeRanges(ranges: HighlightRangeInput[]): HighlightRange[] {
  const normalized: HighlightRange[] = []
  for (const range of ranges) {
    const start = typeof range.charStart === 'number' && Number.isFinite(range.charStart) ? Math.floor(range.charStart) : null
    const end = typeof range.charEnd === 'number' && Number.isFinite(range.charEnd) ? Math.floor(range.charEnd) : null
    if (start !== null && end !== null && start >= 0 && end > start) {
      normalized.push({ kind: 'coordinate', start, end })
      continue
    }
    if (typeof range.text === 'string' && range.text.length > 0) {
      normalized.push({ kind: 'text', text: range.text })
    }
  }
  return normalized
}

interface Span {
  start: number
  end: number
}

/** 合并重叠/相邻区间并按起点排序 */
export function mergeHighlightRanges(ranges: Span[]): Span[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    }
    else {
      merged.push({ ...range })
    }
  }
  return merged
}

/**
 * 把全文按命中区间切段：
 * 1. 优先使用 charStart/charEnd 坐标；
 * 2. 无坐标时用 text 在全文中查找（所有出现位置都定位）；
 * 3. 查不到的区间静默丢弃——只影响高亮，不影响原文展示。
 */
export function buildHighlightSegments(fullText: string, ranges: HighlightRangeInput[]): HighlightSegment[] {
  const normalized = normalizeRanges(ranges)

  const coordinateSpans = mergeHighlightRanges(
    normalized
      .filter((range): range is CoordinateRange => range.kind === 'coordinate')
      .map(range => ({
        start: Math.min(range.start, fullText.length),
        end: Math.min(range.end, fullText.length),
      }))
      .filter(range => range.end > range.start),
  )

  const textSpans: Span[] = []
  for (const range of normalized) {
    if (range.kind !== 'text') {
      continue
    }
    let cursor = 0
    while (cursor <= fullText.length - range.text.length) {
      const found = fullText.indexOf(range.text, cursor)
      if (found < 0) {
        break
      }
      textSpans.push({ start: found, end: found + range.text.length })
      cursor = found + range.text.length
    }
  }

  const all = mergeHighlightRanges([...coordinateSpans, ...textSpans])
  if (all.length === 0) {
    return fullText.length > 0 ? [{ text: fullText, highlighted: false }] : []
  }

  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const range of all) {
    if (range.start > cursor) {
      segments.push({ text: fullText.slice(cursor, range.start), highlighted: false })
    }
    segments.push({ text: fullText.slice(range.start, range.end), highlighted: true })
    cursor = range.end
  }
  if (cursor < fullText.length) {
    segments.push({ text: fullText.slice(cursor), highlighted: false })
  }
  return segments
}
