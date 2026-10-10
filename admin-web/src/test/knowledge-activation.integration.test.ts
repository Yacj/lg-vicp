import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import { configureHttpSession, httpClient } from '@/api/http/client'
import { disableKnowledgeVersion, enableKnowledgeVersion, fetchKnowledgeDocumentDetail, fetchVersionPages } from '@/api/modules/knowledge'
import { useKnowledgeLifecycle } from '@/composables/useKnowledgeLifecycle'

// 由后端 scripts/verify-knowledge-activation.ts 提供真实隔离 PostgreSQL、JWT 与 HTTP API。
const statePath = process.env.KNOWLEDGE_ACTIVATION_TEST_STATE
const originalAdapter = httpClient.defaults.adapter
const originalBaseUrl = httpClient.defaults.baseURL
let app: ReturnType<typeof createApp> | undefined
afterEach(() => {
  app?.unmount()
  httpClient.defaults.adapter = originalAdapter
  httpClient.defaults.baseURL = originalBaseUrl
  configureHttpSession({ getAccessToken: () => '', getRefreshToken: () => '', onSessionExpired: () => {}, replaceSession: () => {} })
})

describe.skipIf(!statePath)('真实 PostgreSQL 知识版本前后端 HTTP 联调', () => {
  it('停用保留原文，重新进入可浏览，启用恢复同一版本及发布状态', async () => {
    const state = JSON.parse(await readFile(statePath!, 'utf8')) as { baseUrl: string, token: string, documentId: string, versionId: string }
    httpClient.defaults.adapter = 'fetch'
    httpClient.defaults.baseURL = state.baseUrl
    configureHttpSession({ getAccessToken: () => state.token, getRefreshToken: () => '', onSessionExpired: () => {}, replaceSession: () => {} })
    let lifecycle!: ReturnType<typeof useKnowledgeLifecycle>
    app = createApp({ setup() {
      lifecycle = useKnowledgeLifecycle({ documentId: state.documentId, immediate: false })
      return () => h('div')
    } })
    app.mount(document.createElement('div'))
    const original = await fetchVersionPages(state.versionId, 1, 100)
    await lifecycle.refresh()
    expect(lifecycle.workspace.value?.currentVersion?.status).toBe('PUBLISHED')
    await disableKnowledgeVersion(state.versionId)
    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value?.id).toBe(state.versionId)
    expect(lifecycle.versionId.value).toBe(state.versionId)
    expect(lifecycle.recognitionSummary.value?.total).toBe(1)
    app.unmount()
    app = createApp({ setup() {
      lifecycle = useKnowledgeLifecycle({ documentId: state.documentId, immediate: false })
      return () => h('div')
    } })
    app.mount(document.createElement('div'))
    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value?.status).toBe('DISABLED')
    const result = await enableKnowledgeVersion(lifecycle.versionId.value!)
    expect(result.version.id).toBe(state.versionId)
    expect(result.version.version).toBe(1)
    await lifecycle.refresh()
    expect(lifecycle.retainedVersion.value).toBeNull()
    expect(lifecycle.workspace.value?.currentVersion?.status).toBe('PUBLISHED')
    expect(lifecycle.workspace.value?.document.publishedVersionId).toBe(state.versionId)
    const pages = await fetchVersionPages(state.versionId, 1, 100)
    expect(pages.items.map(page => page.id)).toEqual(original.items.map(page => page.id))
    expect(pages.items[0]?.pageLabel).toBe('A1')
    const detail = await fetchKnowledgeDocumentDetail(state.documentId)
    expect(detail.versions).toHaveLength(1)
  }, 30_000)
})
