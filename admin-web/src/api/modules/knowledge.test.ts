import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, getHttpAccessToken } from '@/api/http/client'
import {
  approveKnowledgeVersion,
  completeKnowledgeUpload,
  createKnowledgeCategory,
  createKnowledgeEvaluation,
  createKnowledgeUploadIntent,
  createKnowledgeVersion,
  disableKnowledgeVersion,
  fetchChunkTerms,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  fetchKnowledgeEvaluations,
  fetchVersionPages,
  fetchVersionAssets,
  fetchVersionToc,
  fetchVersionPageMappings,
  fetchPublicLibraryDocumentToc,
  fetchPublicLibraryDocumentPage,
  fetchPublicLibraryDocumentPageByLabel,
  replaceVersionToc,
  updateKnowledgeTocItem,
  reorderVersionToc,
  verifyVersionPageMappings,
  updateVersionUsageMode,
  fetchVersionSections,
  judgeKnowledgeEvaluation,
  mergeKnowledgeChunk,
  postKnowledgeQa,
  publishKnowledgeVersion,
  rebuildKnowledgeChunks,
  restartKnowledgeParse,
  rollbackKnowledgeVersion,
  searchKnowledge,
  splitKnowledgeChunk,
  startKnowledgeParse,
  updateKnowledgeChunk,
} from './knowledge'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  getHttpAccessToken: vi.fn(),
  httpBaseURL: 'https://api.example.test',
}))

const mockedApi = vi.mocked(api)
const mockedGetHttpAccessToken = vi.mocked(getHttpAccessToken)

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetHttpAccessToken.mockReturnValue('token-1')
})

describe('knowledge document contracts', () => {
  it('fetches document list with backend pagination and filter fields', async () => {
    const signal = new AbortController().signal
    await fetchKnowledgeDocuments({
      page: 1,
      pageSize: 10,
      keyword: '保温',
      status: 'ACTIVE',
      docType: 'STANDARD',
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/documents', {
      params: {
        page: 1,
        pageSize: 10,
        keyword: '保温',
        status: 'ACTIVE',
        docType: 'STANDARD',
      },
      signal,
    })
  })

  it('fetches document detail by id with abort signal', async () => {
    const signal = new AbortController().signal
    await fetchKnowledgeDocumentDetail('document-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/documents/document-1', { signal })
  })

  it('creates a category', async () => {
    await createKnowledgeCategory({ name: '产品规范', code: 'SPEC' })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/categories', {
      name: '产品规范',
      code: 'SPEC',
    })
  })
})

describe('knowledge version workflow contracts', () => {
  it('creates a version under the document', async () => {
    await createKnowledgeVersion('document-1', { changeNote: '更新图集', evidenceLevel: 'A' })

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/knowledge/documents/document-1/versions',
      { changeNote: '更新图集', evidenceLevel: 'A' },
    )
  })

  it('creates upload intent and completes upload with the returned file id', async () => {
    await createKnowledgeUploadIntent('version-1', {
      fileName: '图集.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      sha256: 'b'.repeat(64),
    })

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/knowledge/versions/version-1/upload-intent',
      {
        fileName: '图集.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256: 'b'.repeat(64),
      },
    )

    await completeKnowledgeUpload('version-1', 'file-9')

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/knowledge/versions/version-1/upload-complete',
      { fileId: 'file-9' },
    )
  })

  it('starts / restarts parse and rebuilds chunks', async () => {
    await startKnowledgeParse('version-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/parse')

    await restartKnowledgeParse('version-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/reparse')

    await rebuildKnowledgeChunks('version-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/chunks/rebuild')
  })

  it('approves, publishes, disables and rolls back versions', async () => {
    await approveKnowledgeVersion('version-1', '内容无误')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/approve', {
      approvalNote: '内容无误',
    })

    await publishKnowledgeVersion('version-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/publish')

    await disableKnowledgeVersion('version-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/disable')

    await rollbackKnowledgeVersion('document-1', 'version-1')
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/knowledge/documents/document-1/rollback-to/version-1',
    )
  })
})

describe('knowledge pages / chunks contracts', () => {
  it('fetches version pages with pagination', async () => {
    const signal = new AbortController().signal
    await fetchVersionPages('version-1', 2, 20, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/pages', {
      params: { page: 2, pageSize: 20 },
      signal,
    })
  })

  it('supports version assets, TOC and mapping contracts', async () => {
    await fetchVersionAssets('version-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/version-1/assets', { signal: undefined })

    await createKnowledgeUploadIntent('version-1', { fileName: 'search.pdf', mimeType: 'application/pdf', sizeBytes: 10, },)
    expect(mockedApi.post).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/versions/version-1/upload-intent', { fileName: 'search.pdf', mimeType: 'application/pdf', sizeBytes: 10 })

    await fetchVersionToc('version-1')
    await replaceVersionToc('version-1', [{ title: '总说明', pageLabel: '4', physicalPageNumber: 4 }], true)
    expect(mockedApi.post).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/versions/version-1/toc', { confirm: true, items: [{ title: '总说明', pageLabel: '4', physicalPageNumber: 4 }] })
    await updateKnowledgeTocItem('toc-1', { title: '基本构造', status: 'CONFIRMED' })
    await reorderVersionToc('version-1', [{ id: 'toc-1', sortOrder: 0, parentId: null, level: 1 }])
    await fetchVersionPageMappings('version-1')
    await verifyVersionPageMappings('version-1', [{ searchPhysicalPageNumber: 23, originalPhysicalPageNumber: 26, pageLabel: '21' }])
    await updateVersionUsageMode('version-1', 'BROWSE_ONLY')
    expect(mockedApi.patch).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/versions/version-1/usage-mode', { usageMode: 'BROWSE_ONLY' })
  })

  it('uses platform routes for public original TOC and pages', async () => {
    await fetchPublicLibraryDocumentToc('document-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/public/documents/document-1/toc', { signal: undefined })
    await fetchPublicLibraryDocumentPage('document-1', 26)
    expect(mockedApi.get).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/public/documents/document-1/pages/26', { signal: undefined })
    await fetchPublicLibraryDocumentPageByLabel('document-1', 'A5')
    expect(mockedApi.get).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/public/documents/document-1/pages/by-label/A5', { signal: undefined })
  })


  it('fetches chunk terms', async () => {
    const signal = new AbortController().signal
    await fetchChunkTerms('chunk-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/chunks/chunk-1/terms', { signal })
  })

  it('updates chunk metadata', async () => {
    await updateKnowledgeChunk('chunk-1', { keywords: ['保温层'], invalid: false })

    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/knowledge/chunks/chunk-1', {
      keywords: ['保温层'],
      invalid: false,
    })
  })

  it('splits chunk at character offset with optional heading', async () => {
    await splitKnowledgeChunk('chunk-1', 120, '5.2 保温层构造')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/chunks/chunk-1/split', {
      at: 120,
      heading: '5.2 保温层构造',
    })
  })

  it('merges chunk into target chunk', async () => {
    await mergeKnowledgeChunk('chunk-1', 'chunk-2')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/chunks/chunk-1/merge', {
      intoChunkId: 'chunk-2',
    })
  })
})

describe('knowledge search & evaluation contracts', () => {
  it('searches knowledge with explainable-ranking filters', async () => {
    const signal = new AbortController().signal
    await searchKnowledge({ query: '岩棉', limit: 5, docType: 'STANDARD', region: '山东' }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/search', {
      params: { query: '岩棉', limit: 5, docType: 'STANDARD', region: '山东' },
      signal,
    })
  })

  it('creates an evaluation with expected document', async () => {
    await createKnowledgeEvaluation({ query: '岩棉', expectedDocumentId: 'document-1', expectedPage: 12 })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/evaluations', {
      query: '岩棉',
      expectedDocumentId: 'document-1',
      expectedPage: 12,
    })
  })

  it('fetches evaluations with judgement filter', async () => {
    await fetchKnowledgeEvaluations({ page: 1, pageSize: 20, judgement: 'PENDING' })

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/evaluations', {
      params: { page: 1, pageSize: 20, judgement: 'PENDING' },
    })
  })

  it('judges an evaluation', async () => {
    await judgeKnowledgeEvaluation('evaluation-1', { judgement: 'APPROVED', note: '命中准确' })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/knowledge/evaluations/evaluation-1/judge', {
      judgement: 'APPROVED',
      note: '命中准确',
    })
  })
})

describe('postKnowledgeQa (SSE)', () => {
  function sseResponse(frames: string[], init?: ResponseInit): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame))
        }
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init })
  }

  it('posts to /api/v1/ai/knowledge-qa with auth headers and parses SSE events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'event: message\ndata: {"messageId":"message-1","conversationId":"conversation-1","requestId":"request-1"}\n\n',
      'event: progress\ndata: {"stage":"checking","message":"正在核对检索资料和计算结果..."}\n\n',
      'event: delta\ndata: {"text":"依据"}\n\n',
      'event: done\ndata: {"messageId":"message-1","conversationId":"conversation-1","finishReason":"COMPLETED",'
      + '"model":{"id":"deepseek-r1"},"promptVersion":{"id":"prompt-1","version":3},'
      + '"sources":[{"chunkId":"chunk-1","documentId":"document-1","title":"GB 50176","page":12,'
      + '"section":"5.2","score":0.93,"evidenceLevel":"A"}],"latencyMs":1500}\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const events: Array<{ type: string }> = []
    await postKnowledgeQa({ query: '保温层厚度要求' }, {
      onEvent: (event) => {
        events.push(event)
      },
    })
    vi.unstubAllGlobals()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/ai/knowledge-qa',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'X-Client-Type': 'B_ADMIN',
          'Authorization': 'Bearer token-1',
        }),
        body: JSON.stringify({ query: '保温层厚度要求' }),
      }),
    )
    expect(events.map(event => event.type)).toEqual(['message', 'progress', 'delta', 'done'])
  })

  it('stops reading after a terminal error event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'event: error\ndata: {"code":"RATE_LIMITED","message":"请求过于频繁","requestId":"request-1","retryable":true}\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const events: Array<{ type: string }> = []
    await postKnowledgeQa({ query: '问题' }, {
      onEvent: (event) => {
        events.push(event)
      },
    })
    vi.unstubAllGlobals()

    expect(events.map(event => event.type)).toEqual(['error'])
  })

  it('throws HttpRequestError with backend error message on non-200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: '请先配置知识问答场景的模型绑定' } }),
      { status: 400 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(postKnowledgeQa({ query: '问题' }, { onEvent: vi.fn() }))
      .rejects
      .toMatchObject({
        message: '请先配置知识问答场景的模型绑定',
        status: 400,
      })
    vi.unstubAllGlobals()
  })
})

describe('version wiki sections contract', () => {
  it('requests the platform section tree by version id', async () => {
    mockedApi.get.mockResolvedValueOnce({
      sections: [
        { id: 'ch1', parentId: null, title: '第1章 总则', level: 1, sectionPath: ['第1章 总则'], startPage: 1, endPage: 4, sortOrder: 0 },
      ],
    })
    const signal = new AbortController().signal
    const result = await fetchVersionSections('ver-1', signal)
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/versions/ver-1/sections', { signal })
    expect(result.sections[0]).toMatchObject({ id: 'ch1', startPage: 1 })
  })
})
