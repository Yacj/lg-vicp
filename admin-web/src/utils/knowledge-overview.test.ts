import type { KnowledgePageRecognitionSummary, KnowledgeVersionIndex } from '@/types/knowledge'
import { describe, expect, it } from 'vitest'
import { buildOverviewFacts, getOverviewNextStep, remainingOverviewBlockers } from './knowledge-overview'

const readyIndex: KnowledgeVersionIndex = {
  versionId: 'version-1',
  indexStatus: 'INDEX_READY',
  indexDirty: false,
  indexBuiltAt: '2026-10-09T00:00:00Z',
  indexRevision: 1,
  contentRevision: 1,
}
const emptyRecognition: KnowledgePageRecognitionSummary = {
  total: 0,
  pending: 0,
  processing: 0,
  reviewRequired: 0,
  confirmed: 0,
  failed: 0,
  missingImage: 0,
}
const base = {
  published: false,
  canAskAi: false,
  canPublish: false,
  pageCount: 1,
  isPageDriven: true,
  recognitionSummary: emptyRecognition,
  parseStatus: null,
  index: readyIndex,
  canTest: true,
  canUploadPages: true,
  canHandleRecognition: true,
  canRebuildIndex: true,
  canOpenPublish: true,
}

describe('知识库概览信息取舍', () => {
  it('空资料不显示零值指标，而是给出上传入口', () => {
    expect(buildOverviewFacts(0, emptyRecognition, true)).toEqual([])
    expect(getOverviewNextStep({ ...base, pageCount: 0 })).toMatchObject({ action: '上传页面', reason: 'upload' })
  })

  it('单页已确认只显示页数和已确认，不显示待核对零值', () => {
    const rec = { ...emptyRecognition, total: 1, confirmed: 1 }
    expect(buildOverviewFacts(1, rec, true).map(fact => fact.key)).toEqual(['pages', 'confirmed'])
    expect(getOverviewNextStep({ ...base, recognitionSummary: rec, canPublish: true })).toMatchObject({ reason: 'publish', action: '打开发布设置' })
  })

  it('失败优先于待核对，且无权限时不提供无法执行的更新操作', () => {
    const rec = { ...emptyRecognition, total: 3, failed: 1, reviewRequired: 1, confirmed: 1 }
    expect(getOverviewNextStep({ ...base, pageCount: 3, recognitionSummary: rec })).toMatchObject({ reason: 'failed', action: '处理失败页面' })
    expect(buildOverviewFacts(3, rec, true).map(fact => fact.key)).toEqual(['pages', 'review', 'confirmed'])
    expect(getOverviewNextStep({ ...base, index: null, canRebuildIndex: false })).toMatchObject({ reason: 'index', action: '' })
  })

  it('问答内容已准备好不代表已可问答', () => {
    expect(getOverviewNextStep({ ...base, canPublish: false })).toMatchObject({ reason: 'other' })
    expect(getOverviewNextStep({ ...base, published: true, canAskAi: false })).toMatchObject({ reason: 'other', action: '' })
    expect(getOverviewNextStep({ ...base, published: true, canAskAi: true })).toMatchObject({ reason: 'published', action: '测试问答' })
    expect(getOverviewNextStep({ ...base, published: true, canAskAi: true, canTest: false })).toMatchObject({ text: '资料已发布，可以用于问答。', action: '' })
    expect(getOverviewNextStep({ ...base, recognitionSummary: { ...emptyRecognition, total: 1, missingImage: 1 }, canUploadPages: false }).text).toContain('联系有上传权限的管理员')
  })

  it('展开区不重复下一步已经说明的原因，也不重复相同阻断文案', () => {
    expect(remainingOverviewBlockers([
      '问答内容尚未准备好，请更新问答内容。',
      '问答内容尚未准备好，请更新问答内容。',
      '章节目录还没有确认。',
    ], 'index')).toEqual(['章节目录还没有确认。'])
  })
})
