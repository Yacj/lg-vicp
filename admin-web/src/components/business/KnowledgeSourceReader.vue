<script setup lang="ts">
import type { AiSourceDetail, AiSourceLocatorQuery } from '@/types/ai-source'
import { computed, ref, watch } from 'vue'
import { api } from '@/api/http/client'
import { fetchAiSourceDetail, fetchSourcePageIdIndex } from '@/api/modules/ai-source'
import KnowledgePageView from './KnowledgePageView.vue'

/**
 * Wiki 原文阅读器（AI 来源溯源 / 知识详情 / 公开文库共用同一阅读核心）：
 * - 顶部展示 文档 → 章节 → 页码 定位路径，正文永远回到完整页内容；
 * - 命中区域高亮；高亮定位失败不隐藏完整页；
 * - 上一页/下一页依赖平台页码索引（懒加载），索引不可用时自动隐藏翻页按钮；
 * - fileId 由宿主按需传入（公开文库/文档详情有原文件，会话来源没有）。
 */

const props = defineProps<{
  locator: AiSourceLocatorQuery
  fileId?: string | null
}>()

const detail = ref<AiSourceDetail | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorMessage = ref('')
let requestSequence = 0

const activeLocator = ref<AiSourceLocatorQuery>(props.locator)
watch(() => props.locator, (value) => {
  activeLocator.value = value
})

async function load(): Promise<void> {
  const sequence = ++requestSequence
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const result = await fetchAiSourceDetail(activeLocator.value)
    if (sequence !== requestSequence) {
      return
    }
    detail.value = result
    status.value = 'ready'
  }
  catch (cause) {
    if (sequence !== requestSequence) {
      return
    }
    errorMessage.value = cause instanceof Error ? cause.message : '原文加载失败，请稍后重试'
    status.value = 'error'
  }
}

watch(activeLocator, () => {
  void load()
}, { immediate: true })

// ===== 翻页（懒加载页码索引） =====

const pageIndex = ref<Array<{ id: string, pageNumber: number }>>([])
const pageIndexFailed = ref(false)
let pageIndexLoading = false

async function ensurePageIndex(): Promise<boolean> {
  if (pageIndex.value.length > 0) {
    return true
  }
  if (pageIndexFailed.value || pageIndexLoading) {
    return false
  }
  const versionId = detail.value?.document.versionId
  if (!versionId) {
    return false
  }
  pageIndexLoading = true
  try {
    pageIndex.value = await fetchSourcePageIdIndex(versionId)
    return pageIndex.value.length > 0
  }
  catch {
    pageIndexFailed.value = true
    return false
  }
  finally {
    pageIndexLoading = false
  }
}

const pageNumber = computed(() => detail.value?.page?.pageNumber ?? detail.value?.location.pageNumber ?? null)

async function goToAdjacentPage(offset: -1 | 1): Promise<void> {
  if (pageNumber.value === null) {
    return
  }
  const ok = await ensurePageIndex()
  if (!ok) {
    return
  }
  const ordered = pageIndex.value
  const currentIndex = ordered.findIndex(item => item.pageNumber === pageNumber.value)
  if (currentIndex < 0) {
    return
  }
  const target = ordered[currentIndex + offset]
  if (!target) {
    return
  }
  activeLocator.value = { pageId: target.id }
}

const canNavigate = computed(() => detail.value?.page != null && !pageIndexFailed.value)
const hasPrev = computed(() => canNavigate.value && pageNumber.value !== null && pageIndex.value.some(item => item.pageNumber < pageNumber.value!))
const hasNext = computed(() => canNavigate.value && pageNumber.value !== null && pageIndex.value.some(item => item.pageNumber > pageNumber.value!))

// ===== 查看原文件 =====

const openingFile = ref(false)

async function openSourceFile(): Promise<void> {
  if (openingFile.value) {
    return
  }
  if (detail.value?.original.previewUrl) {
    window.open(detail.value.original.previewUrl, '_blank', 'noopener')
    return
  }
  if (!props.fileId) {
    return
  }
  openingFile.value = true
  try {
    const result = await api.get<{ url: string }>(`/api/v1/files/${encodeURIComponent(props.fileId)}/download-url`)
    window.open(result.url, '_blank', 'noopener')
  }
  finally {
    openingFile.value = false
  }
}

// ===== 展示辅助 =====

const locationPath = computed(() => {
  if (!detail.value) {
    return ''
  }
  const path = detail.value.location.sectionPath
  if (path && path.length > 0) {
    return path.join(' / ')
  }
  return [detail.value.location.chapter, detail.value.location.section]
    .filter((item): item is string => Boolean(item))
    .join(' / ')
})

const readerHighlights = computed(() =>
  (detail.value?.highlights ?? []).map(highlight => ({
    blockId: highlight.blockId,
    charStart: highlight.charStart,
    charEnd: highlight.charEnd,
    text: highlight.text,
  })),
)

defineExpose({ reload: load })
</script>

<template>
  <div class="ks-reader">
    <div v-if="status === 'loading' && !detail" class="ks-reader__loading">
      <t-loading text="正在加载原文..." />
    </div>

    <div v-else-if="status === 'error' && !detail" class="ks-reader__error">
      <t-alert theme="error" :message="errorMessage" />
      <t-button class="ks-reader__retry" theme="primary" variant="outline" @click="load">
        重新加载
      </t-button>
    </div>

    <template v-else-if="detail">
      <header class="ks-reader__header">
        <h3 class="ks-reader__doc-title">
          {{ detail.document.title }}
        </h3>
        <p v-if="locationPath" class="ks-reader__location">
          {{ locationPath }}
        </p>
        <div class="ks-reader__meta">
          <t-tag v-if="detail.document.docNumber" size="small" variant="outline">
            {{ detail.document.docNumber }}
          </t-tag>
          <t-tag size="small" variant="light" theme="primary">
            v{{ detail.document.version }}
          </t-tag>
          <span v-if="detail.location.pageLabel" class="ks-reader__page">页码 {{ detail.location.pageLabel }}</span>
          <span v-else-if="pageNumber !== null" class="ks-reader__page">第 {{ detail.location.physicalPageNumber ?? pageNumber }} 页</span>
          <span v-if="detail.location.citationAnchor" class="ks-reader__anchor">{{ detail.location.citationAnchor }}</span>
          <t-button
            v-if="fileId || detail.original.previewUrl"
            size="small"
            theme="default"
            variant="text"
            :loading="openingFile"
            @click="openSourceFile"
          >
            查看原文件
          </t-button>
        </div>
      </header>

      <div v-if="status === 'loading'" class="ks-reader__refreshing">
        <t-loading size="small" text="翻页中..." />
      </div>

      <KnowledgePageView
        v-else-if="detail.page"
        :full-text="detail.page.fullText"
        :highlights="readerHighlights"
        :page-image-url="detail.page.pageImageUrl"
        :page-number="detail.page.pageNumber"
        :blocks="detail.page.blocks"
      />
      <p v-else class="ks-reader__empty">
        该资料还没有可阅读的页面内容
      </p>

      <footer v-if="canNavigate" class="ks-reader__pager">
        <t-button size="small" variant="outline" :disabled="!hasPrev" @click="goToAdjacentPage(-1)">
          上一页
        </t-button>
        <span class="ks-reader__pager-label">{{ pageNumber === null ? '—' : `第 ${pageNumber} 页` }}</span>
        <t-button size="small" variant="outline" :disabled="!hasNext" @click="goToAdjacentPage(1)">
          下一页
        </t-button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.ks-reader {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.ks-reader__loading,
.ks-reader__error {
  display: grid;
  min-height: 160px;
  place-content: center;
  justify-items: center;
  gap: var(--td-size-4);
}

.ks-reader__header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
  padding-bottom: var(--td-size-3);
  border-bottom: 1px solid var(--td-component-stroke);
}

.ks-reader__doc-title {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-medium);
  font-weight: var(--td-font-weight-medium);
  line-height: 1.4;
}

.ks-reader__location {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ks-reader__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  margin-top: var(--td-size-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ks-reader__refreshing {
  display: flex;
  justify-content: center;
  padding: var(--td-size-4) 0;
}

.ks-reader__empty {
  margin: 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  text-align: center;
}

.ks-reader__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--td-size-4);
  padding-top: var(--td-size-3);
  border-top: 1px solid var(--td-component-stroke);
}

.ks-reader__pager-label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
