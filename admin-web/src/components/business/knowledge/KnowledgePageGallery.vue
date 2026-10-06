<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next'
import type { CompleteUploadResult } from '@/types/file'
import type { KnowledgePage } from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { createVersionPage, deleteVersionPage, fetchVersionPages, reorderVersionPages, updateVersionPage } from '@/api/modules/knowledge'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import KnowledgePageReferenceRows from '@/components/business/knowledge/KnowledgePageReferenceRows.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { knowledgePageLabel } from '@/utils/knowledge-user'

const props = withDefaults(defineProps<{
  versionId: string | null
  editable?: boolean
  /** 外部跳转到指定物理页（来源页 / 测试命中）。 */
  focusPhysicalPageNumber?: number | null
  /** 页面生成中时展示提示，不阻断已有页卡片。 */
  rendering?: boolean
}>(), {
  editable: false,
  focusPhysicalPageNumber: null,
  rendering: false,
})

const emit = defineEmits<{
  preview: [page: KnowledgePage]
  changed: []
}>()

const { canAccess } = usePermissionAccess()
const canEdit = computed(() => props.editable && canAccess({ permissions: ['system:knowledge:doc:edit'] }))

const pages = ref<KnowledgePage[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<unknown>(null)
const listPage = ref(1)
const listPageSize = 24
const editorVisible = ref(false)
const editing = ref<KnowledgePage | null>(null)
const editor = ref({ pageNumber: 1, pageLabel: '', pageTitle: '', imageFileId: null as string | null })
const uploadFiles = ref<UploadFile[]>([])
const submitting = ref(false)
const previewPage = ref<KnowledgePage | null>(null)
const previewVisible = ref(false)
const removeTarget = ref<KnowledgePage | null>(null)
const removeConfirmVisible = ref(false)
const previewScale = ref(1)
const previewOffset = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragOrigin = ref({ x: 0, y: 0, ox: 0, oy: 0 })

const pagedPages = computed(() => {
  const start = (listPage.value - 1) * listPageSize
  return pages.value.slice(start, start + listPageSize)
})

const previewIndex = computed(() => {
  if (!previewPage.value) {
    return -1
  }
  return pages.value.findIndex(item => item.id === previewPage.value?.id)
})

async function load(): Promise<void> {
  if (!props.versionId) {
    pages.value = []
    total.value = 0
    return
  }
  loading.value = true
  error.value = null
  try {
    const first = await fetchVersionPages(props.versionId, 1, 100)
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchVersionPages(props.versionId, page, 100)).items)
    }
    pages.value = items.sort((a, b) => a.pageNumber - b.pageNumber || a.physicalPageNumber - b.physicalPageNumber)
    total.value = first.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    loading.value = false
  }
}

watch(() => props.versionId, () => {
  listPage.value = 1
  void load()
})
onMounted(() => void load())

watch(() => props.focusPhysicalPageNumber, (value) => {
  if (value == null || !pages.value.length) {
    return
  }
  const target = pages.value.find(item => item.physicalPageNumber === value)
  if (!target) {
    return
  }
  const index = pages.value.findIndex(item => item.id === target.id)
  listPage.value = Math.floor(index / listPageSize) + 1
  openPreview(target)
})

function openCreate(): void {
  editing.value = null
  editor.value = {
    pageNumber: (pages.value.at(-1)?.pageNumber ?? pages.value.length) + 1,
    pageLabel: '',
    pageTitle: '',
    imageFileId: null,
  }
  uploadFiles.value = []
  editorVisible.value = true
}

function openEdit(page: KnowledgePage): void {
  editing.value = page
  editor.value = {
    pageNumber: page.pageNumber,
    pageLabel: page.pageLabel ?? '',
    pageTitle: page.pageTitle ?? '',
    imageFileId: null,
  }
  uploadFiles.value = []
  editorVisible.value = true
}

function onUploadSuccess(_file: File, result: CompleteUploadResult): void {
  editor.value.imageFileId = result.fileId
}

function onUploadRejected(): void {
  MessagePlugin.warning('仅支持 PNG / JPG 页面图片')
}

async function save(): Promise<void> {
  if (!props.versionId) {
    return
  }
  submitting.value = true
  try {
    const input = {
      pageNumber: Number(editor.value.pageNumber),
      pageLabel: editor.value.pageLabel.trim() || null,
      pageTitle: editor.value.pageTitle.trim() || null,
      ...(editor.value.imageFileId ? { imageFileId: editor.value.imageFileId } : {}),
    }
    if (editing.value) {
      await updateVersionPage(props.versionId, editing.value.physicalPageNumber, input)
    }
    else {
      if (!editor.value.imageFileId) {
        MessagePlugin.warning('请上传页面图片')
        return
      }
      await createVersionPage(props.versionId, input)
    }
    MessagePlugin.success(editing.value ? '页面已更新' : '页面已新增')
    editorVisible.value = false
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
  finally {
    submitting.value = false
  }
}

function requestRemove(page: KnowledgePage): void {
  removeTarget.value = page
  removeConfirmVisible.value = true
}

async function remove(): Promise<void> {
  if (!props.versionId || !removeTarget.value) {
    return
  }
  try {
    await deleteVersionPage(props.versionId, removeTarget.value.physicalPageNumber)
    MessagePlugin.success('页面已删除')
    removeConfirmVisible.value = false
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

async function move(page: KnowledgePage, offset: number): Promise<void> {
  if (!props.versionId) {
    return
  }
  const index = pages.value.findIndex(item => item.id === page.id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= pages.value.length) {
    return
  }
  const next = [...pages.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item!)
  try {
    await reorderVersionPages(props.versionId, next.map((entry, sort) => ({
      physicalPageNumber: entry.physicalPageNumber,
      pageNumber: sort + 1,
    })))
    pages.value = next.map((entry, sort) => ({ ...entry, pageNumber: sort + 1 }))
    MessagePlugin.success('页面顺序已更新')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

function resetPreviewTransform(): void {
  previewScale.value = 1
  previewOffset.value = { x: 0, y: 0 }
}

function openPreview(page: KnowledgePage): void {
  previewPage.value = page
  resetPreviewTransform()
  previewVisible.value = true
  emit('preview', page)
}

function goPreview(offset: number): void {
  const nextIndex = previewIndex.value + offset
  const next = pages.value[nextIndex]
  if (!next) {
    return
  }
  previewPage.value = next
  resetPreviewTransform()
}

function pageImage(page: KnowledgePage): string | null {
  return page.pageImageUrl ?? null
}

function onPreviewWheel(event: WheelEvent): void {
  event.preventDefault()
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  previewScale.value = Math.min(3, Math.max(0.5, Number((previewScale.value + delta).toFixed(2))))
}

function onDragStart(event: MouseEvent): void {
  if (previewScale.value <= 1) {
    return
  }
  dragging.value = true
  dragOrigin.value = {
    x: event.clientX,
    y: event.clientY,
    ox: previewOffset.value.x,
    oy: previewOffset.value.y,
  }
}

function onDragMove(event: MouseEvent): void {
  if (!dragging.value) {
    return
  }
  previewOffset.value = {
    x: dragOrigin.value.ox + (event.clientX - dragOrigin.value.x),
    y: dragOrigin.value.oy + (event.clientY - dragOrigin.value.y),
  }
}

function onDragEnd(): void {
  dragging.value = false
}

defineExpose({ reload: load, openPhysicalPage: (physicalPageNumber: number) => {
  const target = pages.value.find(item => item.physicalPageNumber === physicalPageNumber)
  if (target) {
    openPreview(target)
  }
} })
</script>

<template>
  <section class="knowledge-gallery">
    <header class="knowledge-gallery__header">
      <div>
        <h2>页面图库</h2>
        <p>
          共 {{ total }} 页。展示全部 knowledge_pages 页面视觉；自动生成优先，人工上传仅作异常补录。
        </p>
      </div>
      <t-button v-if="canEdit" theme="default" variant="outline" @click="openCreate">
        补录页面
      </t-button>
    </header>

    <t-alert
      v-if="rendering"
      theme="info"
      message="正在生成页面..."
      class="knowledge-gallery__banner"
    />

    <t-loading v-if="loading" class="knowledge-gallery__loading" loading text="正在加载页面图库" />
    <t-alert
      v-else-if="error"
      theme="error"
      :message="normalizeFeedbackError(error).message"
      closeable
      @close="load"
    />
    <div v-else-if="pages.length" class="knowledge-gallery__body">
      <div class="knowledge-gallery__grid">
        <article v-for="(page, index) in pagedPages" :key="page.id" class="knowledge-page-card">
          <div
            class="knowledge-page-card__image"
            role="button"
            tabindex="0"
            @click="openPreview(page)"
            @keydown.enter="openPreview(page)"
          >
            <img
              v-if="pageImage(page)"
              :alt="`${knowledgePageLabel(page.pageLabel, page.physicalPageNumber)}页面`"
              :src="pageImage(page)!"
              loading="lazy"
            >
            <span v-else>暂无页面图片</span>
          </div>
          <div class="knowledge-page-card__body">
            <div class="knowledge-page-card__title">
              <strong>物理第 {{ page.physicalPageNumber }} 页</strong>
              <span>图集页次 {{ knowledgePageLabel(page.pageLabel, page.physicalPageNumber) }}</span>
              <span>{{ page.pageTitle || '未设置页面标题' }}</span>
            </div>
            <AppStatusTag
              :label="page.parseStatus === 'PARSED' ? '已整理' : '待整理'"
              :status="page.parseStatus === 'PARSED' ? 'success' : 'warning'"
            />
            <div v-if="canEdit" class="knowledge-page-card__actions">
              <t-button size="small" variant="text" :disabled="(listPage - 1) * listPageSize + index === 0" @click="move(page, -1)">
                上移
              </t-button>
              <t-button size="small" variant="text" :disabled="(listPage - 1) * listPageSize + index === pages.length - 1" @click="move(page, 1)">
                下移
              </t-button>
              <t-button size="small" variant="text" @click="openEdit(page)">
                编辑
              </t-button>
              <t-button size="small" theme="danger" variant="text" @click="requestRemove(page)">
                删除
              </t-button>
            </div>
          </div>
        </article>
      </div>
      <div v-if="total > listPageSize" class="knowledge-gallery__pagination">
        <t-pagination
          v-model="listPage"
          :page-size="listPageSize"
          :total="total"
          size="small"
        />
      </div>
    </div>
    <div v-else class="knowledge-gallery__empty">
      {{ rendering ? '正在生成页面...' : '还没有页面图片。正常 DOCX 由系统自动生成；异常时可人工补录。' }}
    </div>

    <t-dialog
      v-model:visible="editorVisible"
      :confirm-btn="{ content: '保存', loading: submitting }"
      destroy-on-close
      header="页面补录 / 维护"
      @confirm="save"
    >
      <t-form :data="editor" label-align="top">
        <t-form-item label="页码" required-mark>
          <t-input-number v-model="editor.pageNumber" :min="1" />
        </t-form-item>
        <t-form-item label="图集页次">
          <t-input v-model="editor.pageLabel" maxlength="32" placeholder="如 A1、21" />
        </t-form-item>
        <t-form-item label="页面标题">
          <t-input v-model="editor.pageTitle" maxlength="255" placeholder="请输入页面标题" />
        </t-form-item>
        <t-form-item label="页面图片" :help="editing ? '不重新上传则保留原图片' : '仅支持 PNG / JPG 页面图片'">
          <AppFileUploader
            v-model="uploadFiles"
            accept=".png,.jpg,.jpeg"
            :allowed-mime-types="['image/png', 'image/jpeg']"
            :max="1"
            :multiple="false"
            placeholder="上传页面图片"
            tips="仅支持 PNG / JPG 页面图片"
            unsupported-type-message="仅支持 PNG / JPG 页面图片"
            @rejected="onUploadRejected"
            @success="onUploadSuccess"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog
      v-model:visible="removeConfirmVisible"
      header="删除页面"
      :confirm-btn="{ content: '确认删除', theme: 'danger' }"
      @confirm="remove"
    >
      确认删除第 {{ removeTarget ? knowledgePageLabel(removeTarget.pageLabel, removeTarget.physicalPageNumber) : '' }} 页吗？删除后不可恢复。
    </t-dialog>

    <t-dialog
      v-model:visible="previewVisible"
      header="完整页预览"
      width="min(1080px, 94vw)"
      destroy-on-close
      :footer="false"
    >
      <div class="knowledge-page-preview">
        <div class="knowledge-page-preview__toolbar">
          <span>
            物理第 {{ previewPage?.physicalPageNumber ?? '—' }} 页 · 图集页次
            {{ previewPage ? knowledgePageLabel(previewPage.pageLabel, previewPage.physicalPageNumber) : '' }}
            · {{ previewPage?.pageTitle || '未设置标题' }}
          </span>
          <t-space>
            <t-button size="small" :disabled="previewIndex <= 0" @click="goPreview(-1)">
              上一页
            </t-button>
            <t-button size="small" :disabled="previewIndex < 0 || previewIndex >= pages.length - 1" @click="goPreview(1)">
              下一页
            </t-button>
            <t-button size="small" @click="previewScale = Math.max(0.5, Number((previewScale - 0.1).toFixed(2)))">
              缩小
            </t-button>
            <t-button size="small" @click="previewScale = Math.min(3, Number((previewScale + 0.1).toFixed(2)))">
              放大
            </t-button>
            <t-button size="small" variant="outline" @click="resetPreviewTransform">
              复位
            </t-button>
          </t-space>
        </div>
        <div
          class="knowledge-page-preview__scroll"
          @wheel="onPreviewWheel"
          @mousedown="onDragStart"
          @mousemove="onDragMove"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <img
            v-if="previewPage && pageImage(previewPage)"
            :src="pageImage(previewPage)!"
            :style="{
              transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewScale})`,
              cursor: previewScale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
            }"
            alt="完整页面预览"
            draggable="false"
          >
        </div>
        <KnowledgePageReferenceRows
          :version-id="props.versionId"
          :physical-page-number="previewPage?.physicalPageNumber ?? null"
        />
      </div>
    </t-dialog>
  </section>
</template>

<style scoped>
.knowledge-gallery {
  padding: 20px;
}

.knowledge-gallery__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.knowledge-gallery h2 {
  margin: 0 0 6px;
  color: var(--td-text-color-primary);
  font-size: 18px;
}

.knowledge-gallery p {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-gallery__banner {
  margin-bottom: 14px;
}

.knowledge-gallery__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.knowledge-page-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.knowledge-page-card__image {
  display: grid;
  width: 100%;
  aspect-ratio: 0.76;
  place-items: center;
  padding: 0;
  border: 0;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-placeholder);
  cursor: pointer;
  overflow: hidden;
}

.knowledge-page-card__image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.knowledge-page-card__body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
}

.knowledge-page-card__title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.knowledge-page-card__title span {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space:nowrap;
}

.knowledge-page-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.knowledge-gallery__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.knowledge-gallery__empty,
.knowledge-gallery__loading {
  min-height: 280px;
  display: grid;
  place-items: center;
  color: var(--td-text-color-secondary);
}

.knowledge-page-preview__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--td-text-color-secondary);
}

.knowledge-page-preview__scroll {
  max-height: 70vh;
  overflow: hidden;
  background: var(--td-bg-color-secondarycontainer);
  text-align: center;
  user-select: none;
}

.knowledge-page-preview__scroll img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.08s linear;
}

@media (max-width: 1100px) {
  .knowledge-gallery__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .knowledge-gallery__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
