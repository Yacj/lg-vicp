import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import { computed, nextTick, ref, watch } from 'vue'
import { resolveReferenceHighlights } from '@/utils/knowledge-page-render'

export function useReferenceHighlight(input: () => { model?: KnowledgePageRenderModel | null, matches: ReferenceHighlight[], pageId?: string | null }, container: () => HTMLElement | null, structuredVisible: () => boolean, autoLocate = true) {
  const enabled = ref(true)
  const index = ref(0)
  const matches = computed(() => {
    const value = input()
    return resolveReferenceHighlights(value.model, value.matches, value.pageId)
  })
  const active = computed(() => enabled.value ? matches.value[index.value] : undefined)
  let lastTarget: HTMLElement | undefined
  let scrollSequence = 0

  async function locate(): Promise<void> {
    const sequence = ++scrollSequence
    await nextTick()
    if (sequence !== scrollSequence || !structuredVisible() || !active.value) return
    const match = active.value
    const target = [...(container()?.querySelectorAll<HTMLElement>('[data-construction-id]') ?? [])]
      .find(element => element.dataset.constructionId === match.constructionId
        && (match.optionId ? element.dataset.optionId === match.optionId : !element.dataset.optionId))
    if (!target || target === lastTarget) return
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    lastTarget = target
  }

  watch(matches, () => { index.value = 0; enabled.value = true; lastTarget = undefined }, { immediate: true })
  watch([active, structuredVisible], () => { if (autoLocate) void locate() }, { immediate: true, flush: 'post' })

  function navigate(offset: number): void {
    if (!matches.value.length) return
    enabled.value = true
    index.value = (index.value + offset + matches.value.length) % matches.value.length
    if (!autoLocate) void locate()
  }
  function toggle(): void {
    enabled.value = !enabled.value
    if (enabled.value) lastTarget = undefined
  }
  return { enabled, index, matches, active, navigate, toggle, locate }
}
