<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next'
import type { CompleteUploadResult } from '@/types/file'
import type { KnowledgePage } from '@/types/knowledge'
import { unzipSync } from 'fflate'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { batchUploadVersionPages, createVersionPage, deleteVersionPage, fetchKnowledgePageRecognition, fetchVersionPages, reorderVersionPages, updateVersionPage } from '@/api/modules/knowledge'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import KnowledgePageReferenceRows from '@/components/business/knowledge/KnowledgePageReferenceRows.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { completeFileUpload, createUploadIntent, uploadFileToPresignedUrl } from '@/api/modules/files'
import type { SupportedFileMimeType } from '@/types/file'
import { knowledgePageLabel } from '@/utils/knowledge-user'
import { pageRecognitionStatusMeta } from '@/utils/knowledge-recognition'

const props = withDefaults(defineProps<{
  versionId: string | null
  editable?: boolean
  /** 后端返回的版本可编辑状态；已发布版本不得再修改页面。 */
  versionEditable?: boolean
  /** 外部跳转到指定物理页（来源页 / 测试命中）。 */
  focusPhysicalPageNumber?: number | null
  /** 页面生成中时展示提示，不阻断已有页卡片。 */
  rendering?: boolean
}>(), {
  editable: false,
  versionEditable: true,
  focusPhysicalPageNumber: null,
  rendering: false,
})

const emit = defineEmits<{
  preview: [page: KnowledgePage]
  changed: []
  reviewPage: [physicalPageNumber: number]
}>()

const { canAccess } = usePermissionAccess()
const canEdit = computed(() => props.editable && props.versionEditable && canAccess({ permissions: ['system:knowledge:doc:edit'] }))
const canUploadPages = computed(() => props.versionEditable && canAccess({ permissions: ['system:knowledge:page:upload'] }))
const canReviewPages = computed(() => props.versionEditable && canAccess({ permissions: ['system:knowledge:page:review', 'system:knowledge:page:confirm', 'system:knowledge:page:recognize'] }))

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
const batchVisible = ref(false)
const batchFiles = ref<Array<{ file: File, pageLabel: string, pageTitle: string, physicalPageNumber: number, warning: string }>>([])
const batchUnsupported = ref<string[]>([])
const batchDuplicateNames = ref<string[]>([])
const batchUploading = ref(false)
const batchSourceName = ref('')
const batchMaxImageBytes = 15 * 1024 * 1024
const objectUrls = new Map<File, string>()

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
    const withRecognition: KnowledgePage[] = []
    for (let index = 0; index < items.length; index += 8) {
      const batch = await Promise.all(items.slice(index, index + 8).map(async (page) => {
        try {
          const recognition = await fetchKnowledgePageRecognition(page.id)
          return { ...page, recognitionStatus: recognition.recognitionStatus, recognitionWarnings: recognition.recognitionWarnings, lastRecognitionError: recognition.lastRecognitionError }
        }
        catch { return page }
      }))
      withRecognition.push(...batch)
    }
    pages.value = withRecognition.sort((a, b) => a.pageNumber - b.pageNumber || a.physicalPageNumber - b.physicalPageNumber)
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

function labelFromName(name: string): string {
  const base = name.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '') ?? name
  const match = /^page[-_\s]?0*(\d+)$/i.exec(base) ?? /(\d+)$/.exec(base)
  return match?.[1] ? String(Number.parseInt(match[1], 10)) : ''
}

function openBatchUpload(): void {
  batchFiles.value = []
  batchUnsupported.value = []
  batchDuplicateNames.value = []
  batchSourceName.value = ''
  batchVisible.value = true
}

async function selectBatchFiles(selectedFiles: File[]): Promise<void> {
  if (!selectedFiles.length) return
  batchFiles.value = []
  batchUnsupported.value = []
  batchDuplicateNames.value = []
  const zip = selectedFiles.length === 1 && selectedFiles[0]!.name.toLowerCase().endsWith('.zip')
  batchSourceName.value = zip ? selectedFiles[0]!.name : `${selectedFiles.length} 张图片`
  const candidates: Array<{ file: File, pageLabel: string, pageTitle: string, physicalPageNumber?: number }> = []
  if (zip) {
    try {
      const entries = unzipSync(new Uint8Array(await selectedFiles[0]!.arrayBuffer()))
      let manifest: Array<{ file: string, pageLabel?: string, pageTitle?: string, physicalPageNumber?: number }> = []
      const images: Array<{ name: string, bytes: Uint8Array }> = []
      for (const [name, bytes] of Object.entries(entries)) {
        const base = name.split('/').at(-1) ?? name
        if (base.toLowerCase() === 'manifest.json') {
          try {
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
            if (Array.isArray(parsed)) manifest = parsed as typeof manifest
            else batchUnsupported.value.push('manifest.json：格式需为文件条目数组')
          }
          catch { batchUnsupported.value.push('manifest.json：JSON 格式错误') }
        }
        else if (/\.(png|jpe?g)$/i.test(base)) images.push({ name, bytes })
        else if (base && !name.endsWith('/')) batchUnsupported.value.push(`${base}：不支持的格式`)
      }
      const imageByName = new Map(images.map(image => [image.name, image]))
      const ordered = manifest.length ? manifest.map(item => ({ image: imageByName.get(item.file) ?? imageByName.get(item.file.split('/').at(-1) ?? item.file), item })) : [...images].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(image => ({ image, item: undefined }))
      let order = 1
      for (const entry of ordered) {
        if (!entry.image) { batchUnsupported.value.push(`${entry.item?.file ?? 'manifest 条目'}：文件不存在`); continue }
        const ext = entry.image.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        const file = new File([entry.image.bytes.slice().buffer as ArrayBuffer], entry.image.name.split('/').at(-1) ?? entry.image.name, { type: ext })
        candidates.push({ file, pageLabel: entry.item?.pageLabel ?? labelFromName(file.name), pageTitle: entry.item?.pageTitle ?? '', ...(entry.item?.physicalPageNumber ? { physicalPageNumber: entry.item.physicalPageNumber } : {}) })
        order += 1
      }
    }
    catch { batchUnsupported.value.push('ZIP 无法读取，请检查压缩包是否损坏') }
  }
  else {
    for (const file of selectedFiles) {
      if (!/\.(png|jpe?g)$/i.test(file.name) || !['image/png', 'image/jpeg'].includes(file.type)) {
        batchUnsupported.value.push(`${file.name}：仅支持 PNG / JPG`)
      }
      else candidates.push({ file, pageLabel: labelFromName(file.name), pageTitle: '' })
    }
  }
  const nameCounts = new Map<string, number>()
  candidates.forEach(({ file }) => nameCounts.set(file.name.toLowerCase(), (nameCounts.get(file.name.toLowerCase()) ?? 0) + 1))
  batchDuplicateNames.value = [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)
  candidates.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
  if (candidates.length > 200) batchUnsupported.value.push('页面数量超过单次上传上限 200 张')
  const baseOrder = pages.value.reduce((max, page) => Math.max(max, page.physicalPageNumber), 0) + 1
  batchFiles.value = candidates.map((item, index) => ({
    ...item,
    physicalPageNumber: item.physicalPageNumber ?? baseOrder + index,
    warning: item.file.size > batchMaxImageBytes ? '文件超过 15 MB' : !item.pageLabel ? '文件名无法识别资料页码' : '',
  }))
}

async function sha256(file: File): Promise<string | undefined> {
  try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('') }
  catch { return undefined }
}

function previewUrl(file: File): string {
  let url = objectUrls.get(file)
  if (!url) { url = URL.createObjectURL(file); objectUrls.set(file, url) }
  return url
}

async function uploadBatch(): Promise<void> {
  if (!props.versionId || !batchFiles.value.length) return
  const blocked = batchFiles.value.filter(item => item.file.size > batchMaxImageBytes)
  if (blocked.length) { MessagePlugin.warning('请先移除超过 15 MB 的图片'); return }
  if (batchDuplicateNames.value.length) { MessagePlugin.warning('请先处理重复文件名'); return }
  if (batchFiles.value.length > 200 || batchUnsupported.value.some(item => item.includes('页面数量超过'))) { MessagePlugin.warning('单次最多上传 200 张页面图片'); return }
  const physicalNumbers = batchFiles.value.map(item => item.physicalPageNumber)
  if (new Set(physicalNumbers).size !== physicalNumbers.length || physicalNumbers.some(number => pages.value.some(page => page.physicalPageNumber === number))) {
    MessagePlugin.warning('文件页序不能重复，请修正预览中的页面顺序'); return
  }
  batchUploading.value = true
  try {
    const uploaded: Array<{ fileId: string, physicalPageNumber: number, pageLabel: string | null, pageTitle: string | null }> = []
    for (let index = 0; index < batchFiles.value.length; index += 5) {
      const chunk = await Promise.all(batchFiles.value.slice(index, index + 5).map(async (item) => {
        const mimeType = item.file.type as SupportedFileMimeType
        const intent = await createUploadIntent({ fileName: item.file.name, mimeType, sizeBytes: item.file.size, sha256: await sha256(item.file) })
        if (intent.mode !== 'REUSE' && intent.uploadUrl) {
          await uploadFileToPresignedUrl(intent.uploadUrl, item.file, { signal: new AbortController().signal, onProgress: () => undefined })
          await completeFileUpload(intent.fileId)
        }
        return { fileId: intent.fileId, physicalPageNumber: item.physicalPageNumber, pageLabel: item.pageLabel || null, pageTitle: item.pageTitle || null }
      }))
      uploaded.push(...chunk)
    }
    await batchUploadVersionPages(props.versionId, uploaded, false)
    MessagePlugin.success(`已上传并保存 ${uploaded.length} 页页面图片`)
    batchVisible.value = false
    await load()
    emit('changed')
  }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
  finally { batchUploading.value = false }
}

onUnmounted(() => objectUrls.forEach(url => URL.revokeObjectURL(url)))

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

function recognitionStatus(page: KnowledgePage): { label: string, status: 'default' | 'disabled' | 'processing' | 'warning' | 'success' | 'error' } {
  const meta = pageRecognitionStatusMeta(page.recognitionStatus)
  return { label: meta.label, status: meta.status === 'info' ? 'default' : meta.status }
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
          共 {{ total }} 页。展示全部页面视觉；自动生成优先，人工上传仅作异常补录。
        </p>
      </div>
      <t-space>
        <t-button v-if="canUploadPages" theme="primary" @click="openBatchUpload">批量上传页面</t-button>
        <t-button v-if="canEdit" theme="default" variant="outline" @click="openCreate">补录页面</t-button>
      </t-space>
    </header>

    <t-alert
      v-if="!versionEditable"
      class="knowledge-gallery__banner"
      theme="warning"
      message="当前知识版本已发布，如需修改，请创建新版本。"
    />

    <t-alert
      v-if="rendering"
      theme="info"
      message="等待页面图片；可上传本地完整页 PNG/JPG 或 ZIP"
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
              <strong>文件第 {{ page.physicalPageNumber }} 页</strong>
              <span>资料页码 {{ knowledgePageLabel(page.pageLabel, page.physicalPageNumber) }}</span>
              <span>{{ page.pageTitle || '未设置页面标题' }}</span>
            </div>
            <AppStatusTag :label="recognitionStatus(page).label" :status="recognitionStatus(page).status" />
            <t-alert v-if="page.lastRecognitionError" theme="error" :message="page.lastRecognitionError" />
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
            <t-button v-if="canReviewPages" size="small" theme="primary" variant="text" @click="emit('reviewPage', page.physicalPageNumber)">
              识别校验
            </t-button>
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
      {{ rendering ? '等待页面图片' : '还没有页面图片，请上传本地完整页 PNG/JPG 或 ZIP。' }}
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
        <t-form-item label="资料页码">
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

    <t-dialog v-model:visible="batchVisible" header="批量上传页面图片" width="min(900px, 94vw)" :confirm-btn="{ content: '上传页面', loading: batchUploading, disabled: !batchFiles.length || batchUploading }" @confirm="uploadBatch">
      <div class="knowledge-gallery__batch-head"><span>支持多张 PNG/JPG 或单个 ZIP（可含 manifest.json）。每页图片上限 15 MB。</span><t-upload accept=".png,.jpg,.jpeg,.zip" :auto-upload="false" :multiple="true" :max="200" :show-upload-progress="false" :on-select-change="selectBatchFiles"><t-button variant="outline">选择文件</t-button></t-upload></div>
      <div v-if="batchFiles.length" class="knowledge-gallery__batch-summary">{{ batchSourceName }} · {{ batchFiles.length }} 张页面图 · 页次 {{ batchFiles[0]?.pageLabel || '—' }} 至 {{ batchFiles.at(-1)?.pageLabel || '—' }}</div>
      <t-alert v-if="batchDuplicateNames.length" theme="warning" :message="`重复文件：${batchDuplicateNames.join('、')}`" />
      <t-alert v-for="(warning, index) in batchUnsupported" :key="index" theme="warning" :message="warning" />
      <div class="knowledge-gallery__batch-list">
        <div v-for="(item, index) in batchFiles" :key="`${item.file.name}-${index}`" class="knowledge-gallery__batch-row">
          <img :src="previewUrl(item.file)" :alt="item.file.name">
          <strong :title="item.file.name">{{ item.file.name }}</strong>
          <t-input-number v-model="item.physicalPageNumber" :min="1" label="文件页序" />
          <t-input v-model="item.pageLabel" placeholder="资料页码" />
          <t-input v-model="item.pageTitle" placeholder="页面标题" />
          <span :class="item.warning ? 'is-warning' : ''">{{ item.warning || `${(item.file.size / 1024 / 1024).toFixed(1)} MB` }}</span>
        </div>
      </div>
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
            文件第 {{ previewPage?.physicalPageNumber ?? '—' }} 页 · 资料页码
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
.knowledge-gallery__batch-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;color:var(--td-text-color-secondary)}.knowledge-gallery__batch-summary{padding:10px 12px;margin-bottom:10px;background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-primary)}.knowledge-gallery__batch-list{display:grid;gap:8px;max-height:48vh;overflow:auto;margin-top:12px}.knowledge-gallery__batch-row{display:grid;grid-template-columns:42px minmax(100px,1fr) 105px 105px minmax(110px,1fr) 120px;align-items:center;gap:8px}.knowledge-gallery__batch-row img{width:42px;height:56px;object-fit:contain;background:var(--td-bg-color-secondarycontainer)}.knowledge-gallery__batch-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-gallery__batch-row .is-warning{color:var(--td-warning-color)}

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
