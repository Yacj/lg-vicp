import type { App } from 'vue'
import type { KnowledgeWorkspace } from '@/types/knowledge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { fetchKnowledgeWorkspace, fetchVersionIndex, fetchVersionPages } from '@/api/modules/knowledge'
import { isKnowledgeFileParsingInProgress, isKnowledgePageDrivenWorkspace, isKnowledgePageRenderingInProgress } from '@/utils/knowledge-user'
import { useKnowledgeLifecycle } from './useKnowledgeLifecycle'

vi.mock('@/api/modules/knowledge', () => ({
  fetchKnowledgeWorkspace: vi.fn(),
  fetchVersionIndex: vi.fn(),
  fetchVersionPages: vi.fn(),
}))

function pageWorkspace(): KnowledgeWorkspace {
  return {
    document: { id: 'document-1', title: '协议测试资料', docType: 'DETAIL_ATLAS', currentVersionId: 'version-1', publishedVersionId: null },
    currentVersion: { id: 'version-1', versionNo: 1, userStatus: 'PENDING_PARSE', parseStatus: 'PENDING', status: 'DRAFT', pipelineStatus: 'UPLOAD_PENDING' },
    primaryFile: null,
    parsing: { lastJob: null, textParsing: null, pageRendering: null, pageRenderingComplete: null },
    summary: {
      pageCount: 1, tocCount: 0, sectionCount: 0, canAskAi: false, canPublish: false, canRetry: false,
      contentSource: 'NOT_READY', publishBlockerCodes: ['KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED', 'KNOWLEDGE_INDEX_NOT_READY'],
    },
    actions: { canRetry: false, canReplaceFile: true, canBindSearchSource: false, canRetryPageRender: false },
  }
}

let app: App | undefined

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('page-driven knowledge workspace', () => {
  it('keeps failed offline pages accessible without showing file parsing or rendering', () => {
    const workspace = pageWorkspace()
    expect(isKnowledgePageDrivenWorkspace(workspace)).toBe(true)
    expect(isKnowledgeFileParsingInProgress(workspace)).toBe(false)
    expect(isKnowledgePageRenderingInProgress(workspace)).toBe(false)
  })

  it('keeps empty workspaces in the page upload flow', () => {
    const workspace = pageWorkspace()
    workspace.summary.pageCount = 0
    expect(isKnowledgePageDrivenWorkspace(workspace)).toBe(true)
    expect(isKnowledgeFileParsingInProgress(workspace)).toBe(false)
  })

  it('preserves pending file parsing when an original file is present', () => {
    const workspace = pageWorkspace()
    workspace.primaryFile = { id: 'file-1', name: 'document.pdf', mimeType: 'application/pdf' }
    expect(isKnowledgePageDrivenWorkspace(workspace)).toBe(false)
    expect(isKnowledgeFileParsingInProgress(workspace)).toBe(true)
    expect(isKnowledgePageRenderingInProgress(workspace)).toBe(true)
    workspace.summary.contentSource = 'PAGE_DRIVEN'
    expect(isKnowledgePageDrivenWorkspace(workspace)).toBe(true)
    expect(isKnowledgeFileParsingInProgress(workspace)).toBe(false)
  })

  it('honors an explicit original-file source and handles missing workspace', () => {
    const workspace = pageWorkspace()
    workspace.summary.contentSource = 'ORIGINAL_FILE'
    expect(isKnowledgePageDrivenWorkspace(workspace)).toBe(false)
    expect(isKnowledgePageDrivenWorkspace(null)).toBe(false)
    expect(isKnowledgeFileParsingInProgress(null)).toBe(false)
  })

  it('polls page recognition while active and stops after failure despite PENDING_PARSE', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchKnowledgeWorkspace).mockResolvedValue(pageWorkspace())
    vi.mocked(fetchVersionIndex).mockResolvedValue({
      versionId: 'version-1', indexStatus: 'INDEX_PENDING', indexDirty: true,
      indexBuiltAt: null, indexRevision: 0, contentRevision: 1,
    })
    const recognition = { total: 1, pending: 0, processing: 1, reviewRequired: 0, confirmed: 0, failed: 0, missingImage: 0 }
    vi.mocked(fetchVersionPages).mockResolvedValue({
      items: [], total: 1, page: 1, pageSize: 1, pageRecognitionSummary: recognition,
    })
    let lifecycle!: ReturnType<typeof useKnowledgeLifecycle>
    app = createApp({
      setup() {
        lifecycle = useKnowledgeLifecycle({ documentId: 'document-1', immediate: false })
        return () => h('div')
      },
    })
    app.mount(document.createElement('div'))
    await lifecycle.refresh()
    expect(lifecycle.isBusy.value).toBe(true)
    expect(lifecycle.isPolling.value).toBe(true)

    vi.mocked(fetchVersionPages).mockResolvedValue({
      items: [], total: 1, page: 1, pageSize: 1,
      pageRecognitionSummary: { ...recognition, processing: 0, failed: 1 },
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(lifecycle.recognitionSummary.value?.failed).toBe(1)
    expect(lifecycle.isBusy.value).toBe(false)
    expect(lifecycle.isPolling.value).toBe(false)
    const calls = vi.mocked(fetchKnowledgeWorkspace).mock.calls.length
    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchKnowledgeWorkspace).toHaveBeenCalledTimes(calls)
  })
})
