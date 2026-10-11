import type { KnowledgePage, KnowledgePageRecognition } from '@/types/knowledge'
import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import { computed, ref, watch } from 'vue'
import { fetchKnowledgePageRecognition, fetchVersionPageWindow } from '@/api/modules/knowledge'

export function useKnowledgePageViewer(input: () => { visible: boolean, pageId?: string | null, versionId?: string | null, physicalPageNumber?: number | null, page?: KnowledgePage | KnowledgePageRecognition | null, loadContent: boolean }) {
  const page = ref<KnowledgePage | KnowledgePageRecognition | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  let sequence = 0
  async function load(): Promise<void> {
    const current = ++sequence
    const value = input()
    page.value = value.page ?? null
    error.value = null
    loading.value = false
    if (!value.visible || !value.loadContent) return
    if (!value.pageId && !(value.versionId && value.physicalPageNumber != null)) return
    loading.value = true
    try {
      const [recognition, window] = await Promise.allSettled([
        value.pageId ? fetchKnowledgePageRecognition(value.pageId) : Promise.resolve(null),
        value.versionId && value.physicalPageNumber != null ? fetchVersionPageWindow(value.versionId, value.physicalPageNumber, 0, 0) : Promise.resolve(null),
      ])
      if (sequence !== current) return
      const recognized = recognition.status === 'fulfilled' ? recognition.value : null
      const windowPage = window.status === 'fulfilled' ? window.value?.page : null
      // 不把页码窗口中的其他页面混入当前 pageId。
      const rendered = windowPage && (!value.pageId || windowPage.id === value.pageId) ? windowPage : null
      if (!recognized && !rendered) {
        if (recognition.status === 'rejected') throw recognition.reason
        if (window.status === 'rejected') throw window.reason
        return
      }
      if (recognized) {
        page.value = {
          ...recognized,
          renderModel: rendered?.renderModel ?? recognized.renderModel ?? value.page?.renderModel,
          parsedText: recognized.parsedText ?? rendered?.fullText ?? value.page?.parsedText ?? null,
          pageImageUrl: recognized.pageImageUrl ?? rendered?.pageImageUrl ?? null,
          matches: recognized.matches ?? rendered?.matches,
          referenceHighlight: recognized.referenceHighlight ?? rendered?.referenceHighlight,
        }
      }
      else if (rendered) {
        page.value = { ...rendered, documentId: value.page?.documentId ?? '', versionId: value.versionId!, parsedText: rendered.fullText, pageImageObjectKey: null, sectionPath: null, hasTables: false, hasImages: false, parseStatus: '', createdAt: '' }
      }
    }
    catch (cause) { if (sequence === current) error.value = cause }
    finally { if (sequence === current) loading.value = false }
  }
  watch(input, () => { void load() }, { immediate: true })
  return { page, loading, error, load }
}

export function useKnowledgePageTab(input: () => { pageId?: string | null, initialTab: string }) {
  const tab = ref('structured')
  watch(input, value => { tab.value = value.initialTab }, { immediate: true })
  return tab
}

export function useKnowledgePageWarnings(model: () => KnowledgePageRenderModel | null | undefined, warnings: () => string[]) {
  return computed(() => [...new Set([...warnings(), ...(model()?.warnings ?? []), ...(model()?.constructions ?? []).flatMap(section => [...(section.warnings ?? []), ...section.options.flatMap(option => option.warnings ?? [])])])])
}

export function pageReferenceMatches(page: { referenceHighlight?: ReferenceHighlight | null, matches?: ReferenceHighlight[] } | null | undefined): ReferenceHighlight[] {
  return [...(page?.matches ?? []), ...(page?.referenceHighlight ? [page.referenceHighlight] : [])]
}
