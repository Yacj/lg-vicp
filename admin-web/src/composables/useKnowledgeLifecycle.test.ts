import type { App } from 'vue'
import type { KnowledgeDocumentDetail, KnowledgeDocumentVersion, KnowledgeWorkspace } from '@/types/knowledge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { fetchKnowledgeDocumentDetail, fetchKnowledgeWorkspace, fetchVersionIndex, fetchVersionPages } from '@/api/modules/knowledge'
import { isKnowledgeFileParsingInProgress, isKnowledgePageDrivenWorkspace, isKnowledgePageRenderingInProgress } from '@/utils/knowledge-user'
import { useKnowledgeLifecycle } from './useKnowledgeLifecycle'

vi.mock('@/api/modules/knowledge', () => ({
  fetchKnowledgeDocumentDetail: vi.fn(),
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

function disabledVersion(version = 1): KnowledgeDocumentVersion {
  return {
    id: `version-${version}`, documentId: 'document-1', version, title: '协议测试资料',
    status: 'DISABLED', pipelineStatus: 'PUBLISHED', parseStatus: 'PENDING', usageMode: 'AI_ENABLED',
    fileId: null, pageCount: null, parser: null, evidenceLevel: null, changeNote: null,
    effectiveDate: null, expiryDate: null, createdById: null, approvedById: null, approvedAt: null,
    approvalNote: null, publishedById: null, publishedAt: null, updatedById: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

function documentDetail(versions: KnowledgeDocumentVersion[]): KnowledgeDocumentDetail {
  return {
    document: {
      id: 'document-1', title: '协议测试资料', docNumber: null, docType: 'DETAIL_ATLAS', sourceOrg: null,
      issueDate: null, effectiveDate: null, evidenceLevel: null, allowedPurposes: [], categoryId: null,
      status: 'ACTIVE', currentVersionId: null, currentVersion: null, healthStatus: 'NEEDS_ACTION',
      aiAvailabilityStatus: 'UNAVAILABLE', healthBlockers: [], healthWarnings: [],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
    versions,
  }
}

function mountLifecycle(documentId = ref('document-1')): ReturnType<typeof useKnowledgeLifecycle> {
  let lifecycle!: ReturnType<typeof useKnowledgeLifecycle>
  app = createApp({
    setup() {
      lifecycle = useKnowledgeLifecycle({ documentId, immediate: false })
      return () => h('div')
    },
  })
  app.mount(document.createElement('div'))
  return lifecycle
}

function mockEmptyWorkspace(): void {
  const workspace = pageWorkspace()
  workspace.currentVersion = null
  workspace.document.currentVersionId = null
  workspace.summary.pageCount = 0
  vi.mocked(fetchKnowledgeWorkspace).mockResolvedValue(workspace)
  vi.mocked(fetchVersionPages).mockResolvedValue({
    items: [], total: 3, page: 1, pageSize: 1,
    pageRecognitionSummary: { total: 3, pending: 0, processing: 0, reviewRequired: 0, confirmed: 3, failed: 0, missingImage: 0 },
  })
  vi.mocked(fetchVersionIndex).mockResolvedValue({
    versionId: 'version-1', indexStatus: 'INDEX_READY', indexDirty: false,
    indexBuiltAt: null, indexRevision: 1, contentRevision: 1,
  })
}

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('page-driven knowledge workspace', () => {
  it('continues reading original pages after stopping publication', async () => {
    mockEmptyWorkspace()
    const published = pageWorkspace()
    if (published.currentVersion) {
      published.currentVersion.status = 'PUBLISHED'
      published.currentVersion.userStatus = 'READY'
    }
    published.document.publishedVersionId = 'version-1'
    vi.mocked(fetchKnowledgeWorkspace).mockResolvedValueOnce(published)
    vi.mocked(fetchKnowledgeDocumentDetail).mockResolvedValue(documentDetail([disabledVersion()]))
    const lifecycle = mountLifecycle()
    await lifecycle.refresh()
    expect(lifecycle.versionId.value).toBe('version-1')
    expect(fetchKnowledgeDocumentDetail).not.toHaveBeenCalled()

    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value?.status).toBe('DISABLED')
    expect(lifecycle.versionId.value).toBe('version-1')
    expect(fetchVersionPages).toHaveBeenLastCalledWith('version-1', 1, 1)
    expect(lifecycle.recognitionSummary.value?.total).toBe(3)
    expect(lifecycle.workspace.value?.summary.canPublish).toBe(false)
    expect(lifecycle.workspace.value?.summary.canAskAi).toBe(false)
  })

  it('restores the latest retained version after reopening and prefers a new working version', async () => {
    mockEmptyWorkspace()
    vi.mocked(fetchKnowledgeDocumentDetail).mockResolvedValue(documentDetail([
      disabledVersion(1), disabledVersion(3), disabledVersion(2),
    ]))
    const lifecycle = mountLifecycle()
    await lifecycle.refresh()
    expect(lifecycle.versionId.value).toBe('version-3')
    expect(fetchVersionPages).toHaveBeenLastCalledWith('version-3', 1, 1)

    vi.mocked(fetchKnowledgeWorkspace).mockResolvedValue(pageWorkspace())
    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value).toBeNull()
    expect(lifecycle.versionId.value).toBe('version-1')
    expect(fetchKnowledgeDocumentDetail).toHaveBeenCalledTimes(1)
  })

  it('keeps a genuinely empty document empty', async () => {
    mockEmptyWorkspace()
    vi.mocked(fetchKnowledgeDocumentDetail).mockResolvedValue(documentDetail([]))
    const lifecycle = mountLifecycle()
    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value).toBeNull()
    expect(lifecycle.versionId.value).toBeNull()
    expect(fetchVersionPages).not.toHaveBeenCalled()
    expect(fetchVersionIndex).not.toHaveBeenCalled()
  })

  it('reports a version lookup failure instead of presenting an empty document', async () => {
    mockEmptyWorkspace()
    const failure = new Error('version lookup failed')
    vi.mocked(fetchKnowledgeDocumentDetail).mockRejectedValue(failure)
    const lifecycle = mountLifecycle()
    await lifecycle.refresh()
    expect(lifecycle.error.value).toBe(failure)
    expect(lifecycle.workspace.value).toBeNull()
    expect(fetchVersionPages).not.toHaveBeenCalled()
  })

  it('ignores retained versions arriving after navigation to another document', async () => {
    mockEmptyWorkspace()
    let resolveDetail!: (value: KnowledgeDocumentDetail) => void
    vi.mocked(fetchKnowledgeDocumentDetail).mockReturnValue(new Promise(resolve => { resolveDetail = resolve }))
    const documentId = ref('document-1')
    const lifecycle = mountLifecycle(documentId)
    const pending = lifecycle.refresh()
    await Promise.resolve()
    const nextWorkspace = pageWorkspace()
    nextWorkspace.document.id = 'document-2'
    nextWorkspace.document.currentVersionId = 'version-4'
    if (nextWorkspace.currentVersion) nextWorkspace.currentVersion.id = 'version-4'
    vi.mocked(fetchKnowledgeWorkspace).mockResolvedValue(nextWorkspace)
    documentId.value = 'document-2'
    await nextTick()
    resolveDetail(documentDetail([disabledVersion(3)]))
    await pending
    await lifecycle.refresh()
    expect(lifecycle.workspace.value?.document.id).toBe('document-2')
    expect(lifecycle.retainedVersion.value).toBeNull()
    expect(lifecycle.versionId.value).toBe('version-4')
  })

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
