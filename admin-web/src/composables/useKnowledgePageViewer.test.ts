import type { KnowledgePageRecognition, KnowledgePageWindow } from '@/types/knowledge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { fetchKnowledgePageRecognition, fetchVersionPageWindow } from '@/api/modules/knowledge'
import { useKnowledgePageViewer } from './useKnowledgePageViewer'
import { useKnowledgePageImage } from './useKnowledgePageImage'

vi.mock('@/api/modules/knowledge', () => ({ fetchKnowledgePageRecognition: vi.fn(), fetchVersionPageWindow: vi.fn() }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.resetAllMocks() })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function recognition(id: string): KnowledgePageRecognition {
  return {
    pageId: id, versionId: 'version', documentId: 'document', physicalPageNumber: 1,
    pageLabel: '22', pageTitle: null, parsedText: '正文', pageImageUrl: 'image-url', recognitionStatus: 'CONFIRMED',
    recognitionModel: null, recognitionConfidence: null, recognitionWarnings: [], structuredData: null,
    draftStructuredData: null, confirmedStructuredData: null, confirmedAt: null, confirmedById: null,
    lastRecognitionAt: null, lastRecognitionError: null, imageWarnings: [], versionStatus: 'DRAFT', versionEditable: true, thermalSetEditable: true,
  }
}
async function settle() { await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick() }

describe('知识页加载与原图交互', () => {
  it('关闭/切页后丢弃在途响应，不残留 loading 状态', async () => {
    const old = deferred<KnowledgePageRecognition>()
    const latest = deferred<KnowledgePageRecognition>()
    vi.mocked(fetchKnowledgePageRecognition).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const input = reactive({ visible: true, pageId: 'old', loadContent: true })
    const scope = effectScope(); scopes.push(scope)
    const viewer = scope.run(() => useKnowledgePageViewer(() => ({ ...input })))!
    input.pageId = 'new'
    await nextTick()
    latest.resolve(recognition('new')); await settle()
    expect(viewer.page.value && 'pageId' in viewer.page.value ? viewer.page.value.pageId : null).toBe('new')
    old.resolve(recognition('old')); await settle()
    expect(viewer.page.value && 'pageId' in viewer.page.value ? viewer.page.value.pageId : null).toBe('new')
    input.visible = false; await nextTick()
    expect(viewer.loading.value).toBe(false)
  })

  it('只读取已授权内容，内容加载失败仍可保留已传入原图', async () => {
    const input = reactive({ visible: true, pageId: 'page', loadContent: false, page: recognition('page') })
    const scope = effectScope(); scopes.push(scope)
    const viewer = scope.run(() => useKnowledgePageViewer(() => ({ ...input })))!
    expect(fetchKnowledgePageRecognition).not.toHaveBeenCalled()
    vi.mocked(fetchKnowledgePageRecognition).mockRejectedValue(new Error('unavailable'))
    input.loadContent = true; await settle()
    expect(viewer.error.value).toBeInstanceOf(Error)
    expect(viewer.page.value?.pageImageUrl).toBe('image-url')
    expect(viewer.loading.value).toBe(false)
  })

  it('页面窗口和识别响应合并，窗口缺失或失败时识别响应仍可展示', async () => {
    vi.mocked(fetchKnowledgePageRecognition).mockResolvedValue(recognition('page'))
    const window: KnowledgePageWindow = {
      current: 1, total: 1, items: [],
      page: { id: 'page', pageNumber: 1, physicalPageNumber: 1, pageLabel: '22', pageLabelSource: 'MANUAL', pageLabelConfidence: null, pageLabelVerified: true, pageTitle: null, renderModel: { constructions: [] }, fullText: '全文', extractedText: '全文', blocks: [], pageImageUrl: null },
    }
    vi.mocked(fetchVersionPageWindow).mockResolvedValue(window)
    const scope = effectScope(); scopes.push(scope)
    const viewer = scope.run(() => useKnowledgePageViewer(() => ({ visible: true, pageId: 'page', versionId: 'version', physicalPageNumber: 1, loadContent: true })))!
    await settle()
    expect(viewer.page.value?.renderModel).toEqual({ constructions: [] })
    expect(viewer.error.value).toBeNull()
    vi.mocked(fetchVersionPageWindow).mockRejectedValue(new Error('window unavailable'))
    await viewer.load()
    expect(viewer.page.value && 'pageId' in viewer.page.value ? viewer.page.value.pageId : null).toBe('page')
    expect(viewer.error.value).toBeNull()
  })

  it('图像缩放有边界，拖拽按位移投影，换图自动复位', async () => {
    const source = reactive({ url: 'image-1' })
    const scope = effectScope(); scopes.push(scope)
    const image = scope.run(() => useKnowledgePageImage(() => source.url))!
    image.zoom(100); expect(image.scale.value).toBe(5)
    image.zoom(-100); expect(image.scale.value).toBe(0.5)
    const target = document.createElement('div')
    image.start({ button: 0, pointerId: 1, clientX: 10, clientY: 20, currentTarget: target } as unknown as PointerEvent)
    image.move({ clientX: 30, clientY: 40 } as PointerEvent)
    expect(image.imageStyle.value.transform).toContain('translate(20px, 20px)')
    image.stop(); expect(image.dragging.value).toBe(false)
    image.failed.value = true
    source.url = 'image-2'; await nextTick()
    expect(image.scale.value).toBe(1)
    expect(image.failed.value).toBe(false)
    expect(image.imageStyle.value.transform).toContain('translate(0px, 0px)')
  })
})
