import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUICK_PROMPTS,
  LEGACY_QUICK_PROMPT_CONTENTS,
  QUICK_PROMPT_EDITOR_FIELD_KEYS,
  QUICK_PROMPT_LIST_COLUMN_KEYS,
  QUICK_PROMPT_REMOVED_LIST_COLUMN_KEYS,
  applyDragSortedOrders,
  collectLegacySystemWordingQuickPrompts,
  diffQuickPromptSortOrders,
  findDefaultQuickPromptByTitle,
  isSystemWordingQuickPrompt,
  nextQuickPromptSortOrder,
  systemWordingQuickPromptMessage,
} from './ai-quick-prompt'

describe('default quick prompts', () => {
  it('uses natural user language instead of system instructions', () => {
    expect(DEFAULT_QUICK_PROMPTS.map(item => item.title)).toEqual([
      '查询图集',
      '分析当前项目',
      '匹配保温方案',
      '查询节能标准',
    ])
    expect(DEFAULT_QUICK_PROMPTS.map(item => item.content)).toEqual([
      '帮我查一下和当前问题相关的图集做法，并告诉我出处。',
      '结合当前项目，帮我看看这个问题需要注意什么。',
      '根据当前条件，帮我找几个可以参考的保温方案，并附上依据。',
      '帮我查一下和当前问题相关的节能标准，告诉我关键要求和出处。',
    ])
    for (const item of DEFAULT_QUICK_PROMPTS) {
      expect(isSystemWordingQuickPrompt(item.content)).toBe(false)
      expect(item.content.length).toBeLessThan(80)
    }
  })

  it('rejects system-instruction wording and keeps custom user questions', () => {
    expect(isSystemWordingQuickPrompt(LEGACY_QUICK_PROMPT_CONTENTS[0])).toBe(true)
    expect(isSystemWordingQuickPrompt('找不到可靠依据时请明确说明，不要编造标准号。')).toBe(true)
    expect(isSystemWordingQuickPrompt('必须调用知识库 Tool，只允许知识库。')).toBe(true)
    expect(isSystemWordingQuickPrompt('帮我查一下和当前问题相关的图集做法，并告诉我出处。')).toBe(false)
    expect(isSystemWordingQuickPrompt('外墙保温怎么做？')).toBe(false)
    expect(systemWordingQuickPromptMessage(LEGACY_QUICK_PROMPT_CONTENTS[3])).toContain('自然问题')
    expect(systemWordingQuickPromptMessage('外墙保温怎么做？')).toBeNull()
  })

  it('only marks preset titles with leftover system wording for stock update', () => {
    const items = collectLegacySystemWordingQuickPrompts([
      { title: '查询图集', content: LEGACY_QUICK_PROMPT_CONTENTS[0] },
      { title: '查询图集', content: '帮我查一下和当前问题相关的图集做法，并告诉我出处。' },
      { title: '自定义问题', content: LEGACY_QUICK_PROMPT_CONTENTS[0] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('查询图集')
    expect(findDefaultQuickPromptByTitle('匹配保温方案')?.content)
      .toBe('根据当前条件，帮我找几个可以参考的保温方案，并附上依据。')
  })

  it('keeps the admin list to prompt, status and actions, with drag-sort instead of sortOrder', () => {
    expect([...QUICK_PROMPT_LIST_COLUMN_KEYS]).toEqual(['prompt', 'enabled'])
    expect([...QUICK_PROMPT_REMOVED_LIST_COLUMN_KEYS]).toEqual(['position', 'sortOrder'])
    expect([...QUICK_PROMPT_EDITOR_FIELD_KEYS]).toEqual(['title', 'content', 'positions', 'enabled'])
    expect(nextQuickPromptSortOrder([])).toBe(10)
    expect(nextQuickPromptSortOrder([{ sortOrder: 10 }, { sortOrder: 20 }, { sortOrder: 30 }])).toBe(40)
  })

  it('reuses existing sortOrder values when rows are drag-sorted', () => {
    const previous = [
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 40 },
    ]
    const next = applyDragSortedOrders(previous, [previous[1]!, previous[0]!, previous[2]!])
    expect(next).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'c', sortOrder: 40 },
    ])
    expect(diffQuickPromptSortOrders(previous, next)).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
    ])
    expect(diffQuickPromptSortOrders(previous, applyDragSortedOrders(previous, previous))).toEqual([])
  })
})
