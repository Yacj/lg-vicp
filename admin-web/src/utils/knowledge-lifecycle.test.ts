import type { KnowledgeVersionIndex, KnowledgeWorkspace } from '@/types/knowledge'
import { describe, expect, it } from 'vitest'
import { buildKnowledgeFlowSteps, isKnowledgeIndexReady, knowledgeIndexMeta } from './knowledge-lifecycle'

describe('knowledge index customer status', () => {
  it('requires a current index before reporting the answer content as ready', () => {
    const index: KnowledgeVersionIndex = {
      versionId: 'version-1',
      indexStatus: 'INDEX_READY',
      indexDirty: true,
      indexBuiltAt: '2026-10-09T00:00:00.000Z',
      indexRevision: 2,
      contentRevision: 3,
    }

    expect(isKnowledgeIndexReady(index)).toBe(false)
    expect(knowledgeIndexMeta(index)).toMatchObject({
      label: '需要更新',
      hint: '资料内容已变化，请更新问答内容。',
    })
  })
})

describe('knowledge overview progress semantics', () => {
  it('shows a recognition failure without labeling the separate review step as failed', () => {
    const workspace = {
      summary: { pageCount: 2, contentSource: 'PAGE_IMAGES', canPublish: false },
      currentVersion: { status: 'DRAFT' },
    } as unknown as KnowledgeWorkspace
    const steps = buildKnowledgeFlowSteps({
      workspace,
      index: null,
      recognitionSummary: { total: 2, pending: 0, processing: 0, reviewRequired: 0, confirmed: 1, failed: 1, missingImage: 0 },
    })
    expect(steps.find(step => step.label === 'AI 识别')?.state).toBe('error')
    expect(steps.find(step => step.label === '核对内容')?.state).toBe('todo')
  })
})
