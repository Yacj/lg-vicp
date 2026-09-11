import { describe, expect, it } from 'vitest'
import {
  flattenChapterTree,
  isKnowledgeParsingStatus,
  isKnowledgeReadyStatus,
  knowledgeDocTypeLabel,
  knowledgeFailureMessage,
  knowledgeFileKind,
  knowledgePageLabel,
  knowledgeParsingStageLabel,
  knowledgeTocSourceLabel,
  knowledgeUserMessage,
  knowledgeUserStatusMetaFor,
} from './knowledge-user'

describe('knowledge-user labels', () => {
  it('maps document types to user-facing Chinese labels', () => {
    expect(knowledgeDocTypeLabel('DETAIL_ATLAS')).toBe('图集')
    expect(knowledgeDocTypeLabel('SPECIFICATION')).toBe('规范')
    expect(knowledgeDocTypeLabel('THERMAL_FORMULA')).toBe('热工资料')
    expect(knowledgeDocTypeLabel('UNKNOWN')).toBe('其他')
  })

  it('maps user statuses without exposing internal enums', () => {
    expect(knowledgeUserStatusMetaFor('READY')).toMatchObject({ label: '可使用', usageLabel: '可以使用', status: 'success' })
    expect(knowledgeUserStatusMetaFor('PARSING')).toMatchObject({ label: '解析中', usageLabel: '暂不可用' })
    expect(knowledgeUserStatusMetaFor('PARSE_FAILED')).toMatchObject({ label: '解析失败', usageLabel: '需要处理' })
    expect(knowledgeUserStatusMetaFor('SEARCHABLE_FILE_REQUIRED').label).toBe('需要补充可搜索文字')
    expect(knowledgeUserStatusMetaFor('DRAFT').label).toBe('待解析')
  })

  it('uses user language for parsing stages', () => {
    expect(knowledgeParsingStageLabel('PARSING')).toBe('正在处理页面内容')
    expect(knowledgeParsingStageLabel('CHUNKING')).toBe('正在整理章节和内容')
    expect(knowledgeParsingStageLabel(null)).toBe('正在识别文档章节和内容')
  })

  it('prefers atlas page labels over physical page numbers', () => {
    expect(knowledgePageLabel('A5', 103)).toBe('A5')
    expect(knowledgePageLabel(null, 12)).toBe('12')
    expect(knowledgePageLabel(null, null)).toBe('—')
  })
})

describe('knowledge-user helpers', () => {
  it('flattens chapter trees with depth', () => {
    const flat = flattenChapterTree([
      {
        id: 'a',
        children: [
          { id: 'a1' },
          { id: 'a2', children: [{ id: 'a21' }] },
        ],
      },
      { id: 'b' },
    ])
    expect(flat.map(item => `${item.depth}:${item.node.id}`)).toEqual(['0:a', '1:a1', '1:a2', '2:a21', '0:b'])
  })

  it('classifies parsing and ready statuses', () => {
    expect(isKnowledgeParsingStatus('PARSING')).toBe(true)
    expect(isKnowledgeParsingStatus('READY')).toBe(false)
    expect(isKnowledgeReadyStatus('READY_TO_VERIFY')).toBe(true)
    expect(isKnowledgeReadyStatus('PARSE_FAILED')).toBe(false)
  })

  it('prefers persisted user failure messages', () => {
    expect(knowledgeFailureMessage({
      id: 'job-1',
      status: 'FAILED',
      progress: 40,
      stage: 'FAILED',
      errorMessage: 'worker boom',
      userMessage: 'PDF 第 63 页内容无法正常解析，请检查文件后重试。',
      errorCode: 'PDF_PAGE_PARSE_FAILED',
      attempts: 1,
      startedAt: null,
      finishedAt: null,
    })).toBe('PDF 第 63 页内容无法正常解析，请检查文件后重试。')
  })

  it('detects PDF and Word kinds without exposing mime internals', () => {
    expect(knowledgeFileKind('application/pdf', 'atlas.pdf')).toBe('PDF')
    expect(knowledgeFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('Word')
  })

  it('turns backend technical messages into user language', () => {
    expect(knowledgeUserMessage('缺少 ORIGINAL 正式原文件，不能发布 AI 可引用版本')).toBe('还没有知识文件，不能发布给提问使用。')
    expect(knowledgeUserMessage('原文件没有文本层且不存在 SEARCH_SOURCE 文本源，不能进入 AI 检索')).toBe('当前文件读不出文字，请先补充可搜索文字版本。')
    expect(knowledgeTocSourceLabel('PDF_BOOKMARK')).toBe('文件目录')
    expect(knowledgeTocSourceLabel('MANUAL')).toBe('人工添加')
  })
})
