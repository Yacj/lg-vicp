<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchPublicLibraryDocumentDetail, fetchPublicLibraryDocumentPage, fetchPublicLibraryDocumentPageByLabel, fetchPublicLibraryDocumentToc } from '@/api/modules/knowledge'
import type { KnowledgeTocItem, PublicLibraryDocumentDetail, PublicLibraryPageDetail } from '@/types/knowledge'
import KnowledgePageView from './KnowledgePageView.vue'

const props = defineProps<{ documentId: string }>()
const detail = ref<PublicLibraryDocumentDetail | null>(null)
const toc = ref<KnowledgeTocItem[]>([])
const page = ref<PublicLibraryPageDetail | null>(null)
const loading = ref(true)
const error = ref('')
const selectedPage = ref<number | null>(null)
const currentToc = computed(() => {
  const physicalPageNumber = page.value?.physicalPageNumber ?? selectedPage.value
  return toc.value.find(item => item.physicalPageNumber === physicalPageNumber || (item.pageLabel && item.pageLabel === page.value?.pageLabel)) ?? null
})

async function openPage(locator: number | string): Promise<void> {
  selectedPage.value = typeof locator === 'number' ? locator : null
  try {
    page.value = typeof locator === 'number'
      ? (await fetchPublicLibraryDocumentPage(props.documentId, locator)).page
      : (await fetchPublicLibraryDocumentPageByLabel(props.documentId, locator)).page
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '页面加载失败'
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    detail.value = await fetchPublicLibraryDocumentDetail(props.documentId)
    toc.value = (await fetchPublicLibraryDocumentToc(props.documentId)).items
    const first = toc.value.find(item => item.physicalPageNumber != null || item.pageLabel)
    if (first?.pageLabel) {
      await openPage(first.pageLabel)
    }
    else {
      await openPage(first?.physicalPageNumber ?? 1)
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '公开原文加载失败' }
  finally { loading.value = false }
}

onMounted(() => { void load() })
</script>

<template>
  <div class="knowledge-public-reader">
    <t-loading :loading="loading">
      <t-alert v-if="error" theme="error" :message="error" />
      <div v-if="detail" class="knowledge-public-reader__layout">
        <aside class="knowledge-public-reader__toc">
          <strong>{{ detail.document.title }}</strong>
          <div v-for="item in toc" :key="item.id" class="knowledge-public-reader__toc-item" :class="{ 'is-current': currentToc?.id === item.id }" :style="{ paddingLeft: `${8 + (item.level - 1) * 14}px` }" @click="item.pageLabel ? openPage(item.pageLabel) : item.physicalPageNumber != null && openPage(item.physicalPageNumber)">
            <span>{{ item.title }}</span><small>{{ item.pageLabel || item.physicalPageNumber || '—' }}</small>
          </div>
        </aside>
        <main class="knowledge-public-reader__page">
          <div class="knowledge-public-reader__meta">页码 {{ page?.pageLabel || currentToc?.pageLabel || page?.physicalPageNumber || selectedPage || '—' }}</div>
          <KnowledgePageView v-if="page" :blocks="[]" :full-text="page.fullText" :page-image-url="page.pageImageUrl" :page-number="page.physicalPageNumber" />
          <AppEmptyState v-else title="暂无页面" description="该资料尚未提供可浏览页面" size="small" />
        </main>
      </div>
    </t-loading>
  </div>
</template>

<style scoped>
.knowledge-public-reader__layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }
.knowledge-public-reader__toc { display: flex; max-height: 70vh; flex-direction: column; gap: 8px; overflow: auto; padding: 12px; border-right: 1px solid var(--td-component-border); }
.knowledge-public-reader__toc-item { display: flex; justify-content: space-between; gap: 8px; padding: 8px; color: var(--td-text-color-secondary); cursor: pointer; font-size: var(--td-font-size-body-small); }
.knowledge-public-reader__toc-item:hover, .knowledge-public-reader__toc-item.is-current { background: var(--td-brand-color-1); color: var(--td-text-color-primary); }
.knowledge-public-reader__toc-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knowledge-public-reader__toc-item small { flex: 0 0 auto; }
.knowledge-public-reader__page { min-width: 0; padding: 12px 0; }
.knowledge-public-reader__meta { margin-bottom: 12px; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
@media (max-width: 760px) { .knowledge-public-reader__layout { grid-template-columns: 1fr; } .knowledge-public-reader__toc { max-height: 30vh; border-right: 0; border-bottom: 1px solid var(--td-component-border); } }
</style>
