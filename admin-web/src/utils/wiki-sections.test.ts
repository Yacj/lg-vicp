import type { KnowledgeVersionSection } from '@/types/knowledge'
import { describe, expect, it } from 'vitest'
import { buildSectionTree, filterSectionTree, flattenSectionTree, pagesInSection } from './wiki-sections'

function node(overrides: Partial<KnowledgeVersionSection> & { id: string }): KnowledgeVersionSection {
  return {
    parentId: null,
    title: overrides.id,
    level: 1,
    sectionPath: [],
    startPage: null,
    endPage: null,
    sortOrder: 0,
    ...overrides,
  }
}

const docSections: KnowledgeVersionSection[] = [
  node({ id: 'ch1', title: '第1章 总则', level: 1, startPage: 1, endPage: 4, sortOrder: 0 }),
  node({ id: 'ch5', title: '第5章 设计与构造', level: 1, startPage: 20, endPage: 40, sortOrder: 1 }),
  node({ id: 's51', parentId: 'ch5', title: '5.1 一般规定', level: 2, startPage: 20, endPage: 24, sortOrder: 2 }),
  node({ id: 's52', parentId: 'ch5', title: '5.2 薄抹灰外保温系统', level: 2, startPage: 25, endPage: 40, sortOrder: 3 }),
]

describe('buildSectionTree', () => {
  it('nests nodes by parentId and preserves backend order', () => {
    const tree = buildSectionTree(docSections)
    expect(tree.map(item => item.id)).toEqual(['ch1', 'ch5'])
    expect(tree[1]!.children.map(item => item.id)).toEqual(['s51', 's52'])
  })

  it('promotes orphan nodes whose parent does not exist', () => {
    const tree = buildSectionTree([
      node({ id: 'a' }),
      node({ id: 'b', parentId: 'missing', title: '孤儿节点' }),
    ])
    expect(tree.map(item => item.id)).toEqual(['a', 'b'])
  })
})

describe('filterSectionTree', () => {
  it('keeps matched nodes and their ancestor chain, prunes unmatched branches', () => {
    const tree = buildSectionTree(docSections)
    const filtered = filterSectionTree(tree, '薄抹灰')
    expect(filtered.map(item => item.id)).toEqual(['ch5'])
    expect(filtered[0]!.children.map(item => item.id)).toEqual(['s52'])
  })

  it('is case-insensitive and returns everything for blank keywords', () => {
    const tree = buildSectionTree(docSections)
    expect(filterSectionTree(tree, '  ')).toHaveLength(2)
    expect(filterSectionTree(tree, '总则')).toHaveLength(1)
  })
})

describe('flattenSectionTree', () => {
  it('emits depth for indentation', () => {
    const flat = flattenSectionTree(buildSectionTree(docSections))
    expect(flat.map(item => item.node.id)).toEqual(['ch1', 'ch5', 's51', 's52'])
    expect(flat.map(item => item.depth)).toEqual([0, 0, 1, 1])
  })
})

describe('pagesInSection', () => {
  const pages = [
    { pageNumber: 1, sectionPath: '第1章 总则' },
    { pageNumber: 21, sectionPath: '5.1 一般规定' },
    { pageNumber: 26, sectionPath: '5.2 薄抹灰外保温系统' },
    { pageNumber: 41, sectionPath: '第6章' },
  ]

  it('uses the start/end page range when available', () => {
    expect(pagesInSection(docSections[1]!, pages)).toEqual([21, 26])
    expect(pagesInSection(docSections[2]!, pages)).toEqual([21])
  })

  it('falls back to title matching when the section has no page range', () => {
    expect(pagesInSection(node({ id: 'x', title: '5.2 薄抹灰外保温系统' }), pages)).toEqual([26])
  })

  it('returns empty instead of guessing when nothing matches', () => {
    expect(pagesInSection(node({ id: 'y', title: '不存在的章节' }), pages)).toEqual([])
  })
})
