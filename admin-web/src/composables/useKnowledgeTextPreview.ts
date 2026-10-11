import { ref, watch } from 'vue'

export function useKnowledgeTextPreview(input: () => { readonly: boolean, pageId?: string | null }) {
  const editing = ref(false)
  watch(input, () => { editing.value = false })
  function toggle(): void { if (!input().readonly) editing.value = !editing.value }
  return { editing, toggle }
}
