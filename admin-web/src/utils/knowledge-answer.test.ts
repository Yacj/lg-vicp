import type { KnowledgeReferencePageBlock } from '@/types/knowledge'
import { describe, expect, it } from 'vitest'
import { knowledgeAnswerContent } from './knowledge-answer'

const page: KnowledgeReferencePageBlock = {
  page: { documentId: 'doc', pageId: 'page', documentTitle: '热工选用表', pageNumber: 3, pageLabel: '69', imageUrl: '/page.png' },
  summary: { constructionCode: '外墙A1-3', thicknessMm: 8, kValue: 0.325 },
  matches: [
    { candidateId: 'A1-3-8', summary: { constructionCode: '外墙A1-3', thicknessMm: 8, totalThermalResistance: 3.076, kValue: 0.325 }, highlights: [] },
    { candidateId: 'A1-3-10', summary: { constructionCode: '外墙A1-3', thicknessMm: 10, kValue: 0.269 }, highlights: [] },
    { candidateId: 'A1-4-8', summary: { constructionCode: '外墙A1-4', thicknessMm: 8, kValue: 0.270 }, highlights: [] },
  ],
}
const answer = '有。外墙A1-3 和外墙A1-4 有接近的方案。\n\n- **外墙A1-3**：8mm 的 K 为 0.325，10mm 为 0.269。\n- **外墙A1-4**：8mm 的 K 为 0.270。\n\n依据：\n\n- 外墙A1-3，第69页\n- 外墙A1-4，第69页'

describe('回答段落关联匹配档位', () => {
  it('后端回答位置精准关联重复编号和多页', () => {
    const text = '外墙A1-3 第一处。\n\n外墙A1-3 第二处。'
    const result = knowledgeAnswerContent(text, [
      { ...page, matches: [{ ...page.matches![0]!, answerOffset: text.indexOf('。') }] },
      { ...page, page: { ...page.page, pageId: 'other' }, matches: [{ ...page.matches![0]!, answerOffset: text.length - 1 }] },
    ])
    const linked = result.blocks.filter(block => block.groups.length)
    expect(linked).toHaveLength(2)
    expect(linked[0]!.groups[0]!.page.pageId).toBe('page')
    expect(linked[1]!.groups[0]!.page.pageId).toBe('other')
    expect(result.unplacedCount).toBe(0)
  })
  it('每个构造只在对应回答条目下展示，既不提前插入开场也不重复插入依据', () => {
    const before = JSON.stringify(page)
    const result = knowledgeAnswerContent(answer, [page])
    const withTable = result.blocks.filter(block => block.groups.length)
    expect(withTable).toHaveLength(2)
    expect(withTable[0]?.content).toContain('0.325')
    expect(withTable[0]?.groups[0]?.matches.map(match => match.summary.thicknessMm)).toEqual([8, 10])
    expect(withTable[1]?.content).toContain('0.270')
    expect(withTable[1]?.groups[0]?.matches).toHaveLength(1)
    expect(result.unplacedCount).toBe(0)
    expect(JSON.stringify(page)).toBe(before)
  })
  it('标题后有档位列表时在该构造的列表后插入', () => {
    const result = knowledgeAnswerContent('**外墙A1-3**\n\n- 厚度8mm\n- 厚度10mm\n\n**外墙A1-4**\n\n- 厚度8mm', [page])
    const linked = result.blocks.filter(block => block.groups.length)
    expect(linked[0]?.content).toContain('厚度10mm')
    expect(linked[0]?.groups[0]?.constructionCode).toBe('外墙A1-3')
    expect(linked[1]?.content).toContain('厚度8mm')
    expect(linked[1]?.groups[0]?.constructionCode).toBe('外墙A1-4')
  })
  it('数值相同不用于关联，A1-3 不匹配 A1-30 或代码块', () => {
    const result = knowledgeAnswerContent('外墙A1-30，K=0.325。\n\n```text\n外墙A1-3\n```', [page])
    expect(result.blocks.flatMap(block => block.groups)).toEqual([])
    expect(result.unplacedCount).toBe(2)
  })
  it('同编号存在于不同来源页时不猜测段落来源', () => {
    const result = knowledgeAnswerContent(answer, [page, { ...page, page: { ...page.page, pageId: 'another-page' } }])
    expect(result.blocks.flatMap(block => block.groups)).toEqual([])
    expect(result.unplacedCount).toBe(4)
  })
  it('同页重复候选按 candidateId 合并，缺少 matches 时兼容已有主候选', () => {
    const result = knowledgeAnswerContent(answer, [page, page])
    expect(result.blocks.flatMap(block => block.groups).flatMap(group => group.matches)).toHaveLength(3)
    const legacy = knowledgeAnswerContent(answer, [{ ...page, matches: undefined }])
    expect(legacy.blocks.flatMap(block => block.groups)[0]?.matches[0]?.summary.kValue).toBe(0.325)
  })
  it('流式回答未出现构造编号时不追加独立表，不从文字提取数值', () => {
    const result = knowledgeAnswerContent('有。厚度8mm传热系数0.325', [page])
    expect(result.blocks.flatMap(block => block.groups)).toEqual([])
    expect(result.unplacedCount).toBe(2)
    const textOnly = knowledgeAnswerContent(answer, [])
    expect(textOnly.blocks.flatMap(block => block.groups)).toEqual([])
  })
})
