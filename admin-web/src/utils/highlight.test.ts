import { describe, expect, it } from 'vitest'
import { buildHighlightSegments, mergeHighlightRanges } from './highlight'

describe('buildHighlightSegments', () => {
  it('splits full text by charStart/charEnd ranges', () => {
    const segments = buildHighlightSegments('ABCDEFGHIJ', [
      { charStart: 2, charEnd: 5 },
    ])
    expect(segments).toEqual([
      { text: 'AB', highlighted: false },
      { text: 'CDE', highlighted: true },
      { text: 'FGHIJ', highlighted: false },
    ])
  })

  it('falls back to text search when no coordinates are provided', () => {
    const segments = buildHighlightSegments('门窗洞口应做密封处理，门窗洞口周边应填塞', [
      { text: '门窗洞口' },
    ])
    const highlighted = segments.filter(segment => segment.highlighted)
    expect(highlighted).toHaveLength(2)
    expect(highlighted.every(segment => segment.text === '门窗洞口')).toBe(true)
  })

  it('merges overlapping ranges', () => {
    const segments = buildHighlightSegments('ABCDEFGHIJ', [
      { charStart: 0, charEnd: 4 },
      { charStart: 2, charEnd: 6 },
    ])
    expect(segments).toEqual([
      { text: 'ABCDEF', highlighted: true },
      { text: 'GHIJ', highlighted: false },
    ])
  })

  it('keeps the full text visible even when nothing can be located', () => {
    const text = '完整页面原文必须始终展示'
    const segments = buildHighlightSegments(text, [
      { charStart: 5, charEnd: 3 },
      { text: '不存在的片段' },
    ])
    expect(segments).toEqual([{ text, highlighted: false }])
  })

  it('clamps out-of-bounds coordinates instead of throwing', () => {
    const segments = buildHighlightSegments('abc', [{ charStart: 2, charEnd: 99 }])
    expect(segments).toEqual([
      { text: 'ab', highlighted: false },
      { text: 'c', highlighted: true },
    ])
  })

  it('returns empty result for empty text', () => {
    expect(buildHighlightSegments('', [{ text: 'x' }])).toEqual([])
  })
})

describe('mergeHighlightRanges', () => {
  it('sorts and merges adjacent ranges', () => {
    expect(mergeHighlightRanges([
      { start: 5, end: 8 },
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 8 },
    ])
  })
})
