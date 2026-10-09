<script setup lang="ts">
import type { KnowledgeDocument, KnowledgePage } from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import { fetchVersionPages } from '@/api/modules/knowledge'
import { businessUserError } from '@/utils/business-error'
import { knowledgePageLabel } from '@/utils/knowledge-user'

/**
 * 参考方案「来源页面」卡片选择器：
 * 选择知识资料 → 加载该资料工作版本的全部页面 → 卡片化选择（缩略图 + 页码 + 标题）。
 * 允许暂不关联页面（sourcePageId = null），选中后由父级保存
 * sourceDocumentId / sourcePageId / sourcePageLabel，不手填 pageImageObjectKey。
 */
const props = defineProps<{
  documents: KnowledgeDocument[]
  documentId: string | null
  pageId: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:documentId': [value: string | null]
  'update:pageId': [value: string | null]
  'selectPage': [page: KnowledgePage | null]
}>()

const pages = ref<KnowledgePage[]>([])
const failedImageIds = ref<Set<string>>(new Set())
function markImageUnavailable(id: string): void {
  failedImageIds.value = new Set([...failedImageIds.value, id])
}
const loadingPages = ref(false)

const documentOptions = computed(() => props.documents.map(item => ({ label: item.title, value: item.id })))
const selectedPage = computed(() => pages.value.find(item => item.id === props.pageId) ?? null)

async function loadPages(documentId: string): Promise<void> {
  pages.value = []
  failedImageIds.value = new Set()
  const document = props.documents.find(item => item.id === documentId)
  const versionId = document?.workingVersionId ?? document?.currentVersion?.id
  if (!versionId) {
    return
  }
  loadingPages.value = true
  try {
    const first = await fetchVersionPages(versionId, 1, 100)
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchVersionPages(versionId, page, 100)).items)
    }
    pages.value = items.sort((a, b) => a.pageNumber - b.pageNumber)
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    loadingPages.value = false
  }
}

watch(() => props.documentId, (value) => {
  if (value) {
    void loadPages(value)
  }
  else {
    pages.value = []
  }
}, { immediate: true })

function selectDocument(value: unknown): void {
  const documentId = String(value || '') || null
  emit('update:documentId', documentId)
  emit('update:pageId', null)
  emit('selectPage', null)
}

function togglePage(page: KnowledgePage): void {
  if (props.disabled) {
    return
  }
  if (props.pageId === page.id) {
    emit('update:pageId', null)
    emit('selectPage', null)
    return
  }
  emit('update:pageId', page.id)
  emit('selectPage', page)
}

function clearPage(): void {
  if (props.disabled) {
    return
  }
  emit('update:pageId', null)
  emit('selectPage', null)
}
</script>

<template>
  <div class="source-page-picker">
    <t-select
      :value="documentId ?? undefined"
      clearable
      filterable
      :disabled="disabled"
      :options="documentOptions"
      placeholder="选择知识资料（可留空）"
      @change="selectDocument"
    />
    <template v-if="documentId">
      <div class="source-page-picker__status">
        <t-tag v-if="selectedPage" theme="primary" variant="light">
          已选：文件第 {{ selectedPage.physicalPageNumber }} 页 · 资料页码 {{ knowledgePageLabel(selectedPage.pageLabel, selectedPage.physicalPageNumber) }}{{ selectedPage.pageTitle ? ` · ${selectedPage.pageTitle}` : '' }}
        </t-tag>
        <span v-else class="source-page-picker__unlinked">未关联原始页面</span>
        <t-button v-if="selectedPage && !disabled" size="small" variant="text" @click="clearPage">
          暂不关联页面
        </t-button>
      </div>
      <t-loading v-if="loadingPages" text="正在加载资料页面" />
      <div v-else-if="pages.length" class="source-page-picker__grid">
        <div
          v-for="page in pages"
          :key="page.id"
          class="source-page-card"
          :class="{ 'source-page-card--active': page.id === pageId, 'source-page-card--disabled': disabled }"
          role="button"
          tabindex="0"
          @click="togglePage(page)"
          @keydown.enter="togglePage(page)"
        >
          <div class="source-page-card__image">
            <img v-if="page.pageImageUrl && !failedImageIds.has(page.id)" :alt="knowledgePageLabel(page.pageLabel, page.physicalPageNumber)" :src="page.pageImageUrl" @error="markImageUnavailable(page.id)">
            <span v-else>原图暂不可用</span>
          </div>
          <div class="source-page-card__meta">
            <strong>文件第 {{ page.physicalPageNumber }} 页</strong>
            <span>资料页码 {{ knowledgePageLabel(page.pageLabel, page.physicalPageNumber) }}</span>
            <span v-if="page.pageTitle" :title="page.pageTitle">{{ page.pageTitle }}</span>
          </div>
        </div>
      </div>
      <p v-else class="source-page-picker__empty">
        这份资料还没有页面，请先到知识库的“资料页面”上传。
      </p>
    </template>
    <p v-else class="source-page-picker__hint">
      未选择知识资料，该参考方案将不关联原始页面
    </p>
  </div>
</template>

<style scoped>
.source-page-picker { display:flex; flex-direction:column; gap:10px; width:100%; }
.source-page-picker__status { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.source-page-picker__unlinked { color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
.source-page-picker__grid { display:grid; max-height:280px; padding:4px; border:1px solid var(--td-component-stroke); border-radius:var(--td-radius-medium); gap:10px; grid-template-columns:repeat(4, minmax(0, 1fr)); overflow-y:auto; }
.source-page-card { overflow:hidden; border:1px solid var(--td-component-stroke); border-radius:var(--td-radius-medium); background:var(--td-bg-color-container); cursor:pointer; transition:border-color .2s; }
.source-page-card:hover { border-color:var(--td-brand-color-hover); }
.source-page-card--active { border-color:var(--td-brand-color); box-shadow:0 0 0 1px var(--td-brand-color); }
.source-page-card--disabled { cursor:not-allowed; opacity:.6; }
.source-page-card__image { display:grid; width:100%; aspect-ratio:.76; place-items:center; background:var(--td-bg-color-secondarycontainer); color:var(--td-text-color-placeholder); overflow:hidden; }
.source-page-card__image img { width:100%; height:100%; object-fit:contain; }
.source-page-card__meta { display:flex; min-width:0; flex-direction:column; gap:2px; padding:6px 8px; }
.source-page-card__meta strong { color:var(--td-text-color-primary); font-size:var(--td-font-size-body-small); }
.source-page-card__meta span { overflow:hidden; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); text-overflow:ellipsis; white-space:nowrap; }
.source-page-picker__empty, .source-page-picker__hint { margin:0; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
</style>
