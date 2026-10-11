import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/api/reference-page'
import { computed, nextTick, ref, watch } from 'vue'
import { resolvePageHighlights } from '../utils/referencePage'

export function useReferencePageHighlight(input: () => { model?: KnowledgePageRenderModel | null, pageId: string, matches: ReferenceHighlight[], preferred?: ReferenceHighlight, anchorPrefix?: string, initialView?: '原始页面' | '页面内容' }, locate: (id: string) => void) {
  const tab = ref(input().initialView || '页面内容')
  const enabled = ref(true)
  const index = ref(0)
  const matches = computed(() => {
    const current = input()
    return resolvePageHighlights(current.model, current.matches, current.pageId)
  })
  const active = computed(() => enabled.value ? matches.value[index.value] : undefined)
  let lastTarget = ''
  let revision = 0
  const anchor = (constructionIndex: number, optionIndex?: number) => `${input().anchorPrefix || 'reference'}-construction-${constructionIndex}${optionIndex == null ? '' : `-option-${optionIndex}`}`
  watch(() => input().pageId, () => {
    enabled.value = true
    lastTarget = ''
    tab.value = input().model ? input().initialView || '页面内容' : '原始页面'
  })
  watch(matches, () => {
    const preferred = input().preferred
    const position = preferred ? matches.value.findIndex(match => match.constructionId === preferred.constructionId && match.optionId === preferred.optionId) : -1
    index.value = position >= 0 ? position : 0
  }, { immediate: true })
  watch([active, tab], async () => {
    const currentRevision = ++revision
    await nextTick()
    if (currentRevision !== revision || tab.value !== '页面内容' || !active.value)
      return
    const current = input()
    const constructionIndex = current.model?.constructions.findIndex(item => item.constructionId === active.value!.constructionId) ?? -1
    if (constructionIndex < 0)
      return
    const optionIndex = active.value.optionId ? current.model!.constructions[constructionIndex]!.options.findIndex(option => option.optionId === active.value!.optionId) : undefined
    if (optionIndex != null && optionIndex < 0)
      return
    const target = anchor(constructionIndex, optionIndex)
    if (target !== lastTarget) {
      lastTarget = target
      locate(target)
    }
  }, { immediate: true, flush: 'post' })
  function navigate(offset: number): void {
    if (!matches.value.length)
      return
    enabled.value = true
    index.value = (index.value + offset + matches.value.length) % matches.value.length
    tab.value = '页面内容'
  }
  function toggle(): void {
    enabled.value = !enabled.value
    if (enabled.value)
      lastTarget = ''
  }
  return { tab, enabled, index, matches, active, anchor, navigate, toggle }
}
