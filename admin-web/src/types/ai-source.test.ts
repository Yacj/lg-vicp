import { describe, expect, it } from 'vitest'
import { aiSourceRefFromSearchHit, normalizeAiSource, resolveAiSourceLocator } from './ai-source'

describe('resolveAiSourceLocator', () => {
  it('prefers the most specific locator: block > page > section > chunk > document', () => {
    const base = {
      title: '图集',
      documentId: 'doc-1',
      sectionId: 'sec-1',
      pageId: 'page-1',
      blockId: 'block-1',
      chunkId: 'chunk-1',
    }
    expect(resolveAiSourceLocator(base)?.blockId).toBe('block-1')

    const { blockId: _block, ...withoutBlock } = base
    expect(resolveAiSourceLocator(withoutBlock)?.pageId).toBe('page-1')

    const { pageId: _page, ...withoutPage } = withoutBlock
    expect(resolveAiSourceLocator(withoutPage)?.sectionId).toBe('sec-1')

    const { sectionId: _section, ...withoutSection } = withoutPage
    expect(resolveAiSourceLocator(withoutSection)?.chunkId).toBe('chunk-1')

    const { chunkId: _chunk, ...documentOnly } = withoutSection
    expect(resolveAiSourceLocator(documentOnly)).toEqual({ documentId: 'doc-1' })
  })

  it('returns null when nothing can locate the source', () => {
    expect(resolveAiSourceLocator({ title: '仅标题' })).toBeNull()
  })

  it('keeps matchedText as highlight fallback (truncated to 2000 chars)', () => {
    const locator = resolveAiSourceLocator({
      title: '规程',
      documentId: 'doc-1',
      matchedText: 'x'.repeat(3000),
    })
    expect(locator?.matchedText).toHaveLength(2000)
  })
})

describe('aiSourceRefFromSearchHit', () => {
  it('maps wiki-level search hits onto the unified source contract', () => {
    const source = aiSourceRefFromSearchHit({
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      versionId: 'ver-1',
      sectionId: 'sec-1',
      pageId: 'page-1',
      pageBlockId: 'block-1',
      sourceTitle: '《VICP应用技术规程》',
      sourcePage: 21,
      pageEnd: 22,
      sourceSection: '5.2 VICP薄抹灰外保温系统',
      content: '命中正文',
      snippet: '命中摘要',
      score: 0.87,
      evidenceLevel: 'A',
    })
    expect(source).toMatchObject({
      sourceType: 'KNOWLEDGE',
      retrievalUnit: 'CHUNK',
      blockId: 'block-1',
      pageStart: 21,
      pageEnd: 22,
      matchedText: '命中正文',
    })
    const locator = resolveAiSourceLocator(source)
    expect(locator).toMatchObject({ blockId: 'block-1', matchedText: '命中正文' })
  })
})

describe('normalizeAiSource', () => {
  it('normalizes legacy flat sources (KnowledgeQaSource / retrieval logs)', () => {
    const source = normalizeAiSource({
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      title: '旧来源',
      page: 5,
      section: '第3章',
      score: 0.5,
    })
    expect(source).toMatchObject({
      title: '旧来源',
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      pageNumber: 5,
      retrievalUnit: 'CHUNK',
    })
    expect(resolveAiSourceLocator(source!)).toEqual({ chunkId: 'chunk-1' })
  })

  it('returns null for malformed payloads', () => {
    expect(normalizeAiSource(null)).toBeNull()
    expect(normalizeAiSource({ chunkId: 'chunk-1' })).toBeNull()
  })
})
