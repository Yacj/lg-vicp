<script setup lang="ts">
import type { KnowledgePage, KnowledgeZipImportResult } from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { uploadFileToPresignedUrl } from '@/api/modules/files'
import {
  batchUploadVersionPages,
  completeKnowledgeUpload,
  createKnowledgeUploadIntent,
  createVersionPage,
  deleteVersionPage,
  fetchVersionPages,
  importVersionPagesFromZip,
  recognizeKnowledgePage,
  reorderVersionPages,
  updateVersionPage,
} from '@/api/modules/knowledge'
import KnowledgePageReferenceRows from '@/components/business/knowledge/KnowledgePageReferenceRows.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { HttpRequestError } from '@/types/error'
import { businessUserError, businessUserMessage } from '@/utils/business-error'
import { uploadKnowledgePageImage } from '@/utils/knowledge-page-upload'
import { pageRecognitionStatusMeta } from '@/utils/knowledge-recognition'
import { knowledgePageLabel } from '@/utils/knowledge-user'

const props = withDefaults(defineProps<{
  versionId: string | null
  editable?: boolean
  /** 后端返回的版本可编辑状态；已发布版本不得再修改页面。 */
  versionEditable?: boolean
  /** 外部跳转到指定物理页（来源页 / 测试命中）。 */
  focusPhysicalPageNumber?: number | null
  /** 页面生成中时展示提示，不阻断已有页卡片。 */
  rendering?: boolean
  /** 页面级生命周期轮询心跳：变化时静默刷新页面列表。 */
  pollTick?: number
  /** 是否处于轮询窗口内。 */
  polling?: boolean
}>(), {
  editable: false,
  versionEditable: true,
  focusPhysicalPageNumber: null,
  rendering: false,
  pollTick: 0,
  polling: false,
})

const emit = defineEmits<{
  preview: [page: KnowledgePage]
  changed: []
  reviewPage: [physicalPageNumber: number]
}>()

const { canAccess } = usePermissionAccess()
const canEdit = computed(() => props.editable && props.versionEditable && canAccess({ permissions: ['system:knowledge:doc:edit'] }))
const canUploadPages = computed(() => props.versionEditable && canAccess({ permissions: ['system:knowledge:page:upload'] }))
const canRecognizePages = computed(() => props.versionEditable && canAccess({ permissions: ['system:knowledge:page:recognize'] }))
const canReviewPages = computed(() => props.versionEditable && canAccess({ permissions: ['system:knowledge:page:review', 'system:knowledge:page:confirm', 'system:knowledge:page:recognize'] }))
const selectable = computed(() => canEdit.value || canRecognizePages.value)

type StatusFilter = 'ALL' | 'CONFIRMED' | 'REVIEW_REQUIRED' | 'FAILED' | 'UNPROCESSED'

const pages = ref<KnowledgePage[]>([])
const failedPageImages = ref<Set<string>>(new Set())
function markPageImageUnavailable(id: string): void {
  failedPageImages.value = new Set([...failedPageImages.value, id])
}
const total = ref(0)
const loading = ref(false)
const error = ref<unknown>(null)
const keyword = ref('')
const statusFilter = ref<StatusFilter>('ALL')
const selectedIds = ref<string[]>([])
const listPage = ref(1)
const listPageSize = 24

const editorVisible = ref(false)
const editing = ref<KnowledgePage | null>(null)
const editor = ref({ pageNumber: 1, pageLabel: '', pageTitle: '', imageFileId: null as string | null })
const submitting = ref(false)
const editorImageFile = ref<File | null>(null)
const editorImageUrl = ref<string | null>(null)
const editorUploadProgress = ref(0)
let editorUploadController: AbortController | null = null
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
/** 单个 ZIP：交给后端 import-zip 解包，前端不再自行解压。 */
const batchZipFile = ref<File | null>(null)
/** 导入失败时复用已完成上传的 ZIP，避免重复上传同一 SHA 被后端拒绝。 */
const uploadedZipFileId = ref<string | null>(null)
const batchZipResult = ref<KnowledgeZipImportResult | null>(null)
const batchUnsupported = ref<string[]>([])
const batchDuplicateNames = ref<string[]>([])
const batchUploading = ref(false)
const batchError = ref('')
const batchResultUncertain = ref(false)
const batchSourceName = ref('')
const batchMaxImageBytes = 15 * 1024 * 1024
const batchProgress = ref(0)
const batchUploadedBytes = ref(0)
const objectUrls = new Map<File, string>()

const batchIsZip = computed(() => batchZipFile.value !== null)
const batchFileCount = computed(() => (batchZipFile.value ? 1 : batchFiles.value.length))
const batchTotalBytes = computed(() => batchZipFile.value
  ? batchZipFile.value.size
  : batchFiles.value.reduce((sum, item) => sum + item.file.size, 0))
const batchTotalSizeLabel = computed(() => `${(batchTotalBytes.value / 1024 / 1024).toFixed(1)} MB`)
const batchEstimatedPages = computed(() => batchFiles.value.length)
const batchCanSubmit = computed(() => !batchUploading.value && (batchIsZip.value || batchFiles.value.length > 0))
/** ZIP 导入结果中的逐页告警（后端 items[].warnings）。 */
const zipWarnings = computed(() => (batchZipResult.value?.items ?? [])
  .flatMap(item => item.warnings.map(warning => `${item.fileName}：${businessUserMessage(warning)}`)))

const orderVisible = ref(false)
const ordering = ref(false)
const orderDraft = ref<Array<{ id: string, physicalPageNumber: number, pageNumber: number, pageLabel: string | null }>>([])

const batchRecognizing = ref(false)
const retryingPageId = ref<string | null>(null)
const batchRemoving = ref(false)

const statusOptions = [
  { label: '全部状态', value: 'ALL' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '待核对', value: 'REVIEW_REQUIRED' },
  { label: '识别失败', value: 'FAILED' },
  { label: '未处理', value: 'UNPROCESSED' },
]

function matchStatus(page: KnowledgePage): boolean {
  const filter = statusFilter.value
  if (filter === 'ALL') {
    return true
  }
  if (filter === 'UNPROCESSED') {
    return !page.recognitionStatus || page.recognitionStatus === 'PENDING' || page.recognitionStatus === 'PROCESSING'
  }
  return page.recognitionStatus === filter
}

const filteredPages = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return pages.value.filter((page) => {
    if (!matchStatus(page)) {
      return false
    }
    if (!text) {
      return true
    }
    return [
      page.pageTitle ?? '',
      page.pageLabel ?? '',
      String(page.pageNumber),
      String(page.physicalPageNumber),
    ].some(value => value.toLowerCase().includes(text))
  })
})

const pagedPages = computed(() => {
  const start = (listPage.value - 1) * listPageSize
  return filteredPages.value.slice(start, start + listPageSize)
})

const selectedPages = computed(() => pages.value.filter(page => selectedIds.value.includes(page.id)))
const selectedCount = computed(() => selectedPages.value.length)
const allSelected = computed(() => pagedPages.value.length > 0
  && pagedPages.value.every(page => selectedIds.value.includes(page.id)))

const previewIndex = computed(() => {
  if (!previewPage.value) {
    return -1
  }
  return filteredPages.value.findIndex(item => item.id === previewPage.value?.id)
})

watch(keyword, () => {
  listPage.value = 1
})
watch(statusFilter, () => {
  listPage.value = 1
})

async function load(silent = false): Promise<void> {
  if (!silent) {
    failedPageImages.value = new Set()
  }
  if (!props.versionId) {
    pages.value = []
    total.value = 0
    return
  }
  if (!silent) {
    loading.value = true
    error.value = null
  }
  try {
    // 页面列表已直接返回 recognitionStatus / recognitionWarnings / lastRecognitionError，
    // 无需逐页再请求 GET /pages/:pageId/recognition（旧实现会产生 N+1 请求风暴）。
    const first = await fetchVersionPages(props.versionId, 1, 100)
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchVersionPages(props.versionId, page, 100)).items)
    }
    pages.value = items.sort((a, b) => a.pageNumber - b.pageNumber || a.physicalPageNumber - b.physicalPageNumber)
    total.value = first.total
    selectedIds.value = selectedIds.value.filter(id => pages.value.some(page => page.id === id))
  }
  catch (cause) {
    if (!silent) {
      error.value = cause
    }
  }
  finally {
    if (!silent) {
      loading.value = false
    }
  }
}

watch(() => props.versionId, () => {
  listPage.value = 1
  selectedIds.value = []
  void load()
})

/** 复用页面级唯一定时器：轮询窗口内静默刷新，不再自起 setInterval。 */
watch(() => props.pollTick, () => {
  if (props.polling) {
    void load(true)
  }
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
  // 目标页可能被当前筛选/搜索隐藏，先回到全量再定位。
  statusFilter.value = 'ALL'
  keyword.value = ''
  const index = filteredPages.value.findIndex(item => item.id === target.id)
  listPage.value = Math.floor(index / listPageSize) + 1
  openPreview(target)
})

function isSelected(page: KnowledgePage): boolean {
  return selectedIds.value.includes(page.id)
}

function toggleSelect(page: KnowledgePage): void {
  selectedIds.value = isSelected(page)
    ? selectedIds.value.filter(id => id !== page.id)
    : [...selectedIds.value, page.id]
}

function toggleSelectAll(): void {
  if (allSelected.value) {
    const pageIds = new Set(pagedPages.value.map(page => page.id))
    selectedIds.value = selectedIds.value.filter(id => !pageIds.has(id))
    return
  }
  const merged = new Set(selectedIds.value)
  pagedPages.value.forEach(page => merged.add(page.id))
  selectedIds.value = [...merged]
}

function clearSelection(): void {
  selectedIds.value = []
}

function resetFilters(): void {
  keyword.value = ''
  statusFilter.value = 'ALL'
}

function resetEditorImage(): void {
  editorUploadController?.abort()
  editorUploadController = null
  if (editorImageUrl.value) URL.revokeObjectURL(editorImageUrl.value)
  editorImageFile.value = null
  editorImageUrl.value = null
  editorUploadProgress.value = 0
}

function openCreate(): void {
  resetEditorImage()
  editing.value = null
  editor.value = {
    pageNumber: (pages.value.at(-1)?.pageNumber ?? pages.value.length) + 1,
    pageLabel: '',
    pageTitle: '',
    imageFileId: null,
  }
  editorVisible.value = true
}

function openEdit(page: KnowledgePage): void {
  resetEditorImage()
  editing.value = page
  editor.value = {
    pageNumber: page.pageNumber,
    pageLabel: page.pageLabel ?? '',
    pageTitle: page.pageTitle ?? '',
    imageFileId: null,
  }
  editorVisible.value = true
}

watch(editorVisible, (visible) => {
  if (!visible) resetEditorImage()
})

function onEditorImageChange(selectedFiles: File[]): void {
  const file = selectedFiles[0]
  if (!file) return
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 15 * 1024 * 1024) {
    MessagePlugin.warning('请选择不超过 15 MB 的 PNG / JPG 页面图片')
    return
  }
  resetEditorImage()
  editorImageFile.value = file
  editorImageUrl.value = URL.createObjectURL(file)
  editor.value.imageFileId = null
}

function removeEditorImage(): void {
  resetEditorImage()
  editor.value.imageFileId = null
}

async function save(): Promise<void> {
  if (!props.versionId || submitting.value) {
    return
  }
  if (!editing.value && !editorImageFile.value && !editor.value.imageFileId) {
    MessagePlugin.warning('请先选择页面图片')
    return
  }
  submitting.value = true
  try {
    if (editorImageFile.value && !editor.value.imageFileId) {
      const controller = new AbortController()
      editorUploadController = controller
      const uploaded = await uploadKnowledgePageImage(editorImageFile.value, {
        sha256: await sha256(editorImageFile.value),
        onProgress: progress => { editorUploadProgress.value = progress.percent },
        signal: controller.signal,
      })
      editor.value.imageFileId = uploaded.fileId
      editorUploadController = null
    }
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
      await createVersionPage(props.versionId, input)
    }
    MessagePlugin.success(editing.value ? '页面已更新' : '页面已新增')
    editorVisible.value = false
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
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
    MessagePlugin.error(businessUserError(cause))
  }
}

/** 批量删除选中页面：逐页串行，任一失败立即停止并保留剩余选择。 */
async function removeSelected(): Promise<void> {
  const versionId = props.versionId
  const targets = selectedPages.value
  if (!versionId || !targets.length || batchRemoving.value) {
    return
  }
  batchRemoving.value = true
  let removed = 0
  try {
    for (const page of targets) {
      await deleteVersionPage(versionId, page.physicalPageNumber)
      removed += 1
    }
    MessagePlugin.success(`已删除 ${removed} 页`)
    selectedIds.value = []
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(`已删除 ${removed} 页后中断：${businessUserError(cause)}`)
    await load()
    emit('changed')
  }
  finally {
    batchRemoving.value = false
  }
}

/** 批量识别选中页面：仅针对未确认页，4 并发提交，后端异步入队。 */
async function recognizeSelected(): Promise<void> {
  const targets = selectedPages.value.filter(page => page.recognitionStatus !== 'CONFIRMED')
  if (!targets.length) {
    MessagePlugin.info('选中的页面都已确认，无需重新识别')
    return
  }
  batchRecognizing.value = true
  let succeeded = 0
  try {
    for (let index = 0; index < targets.length; index += 4) {
      const results = await Promise.allSettled(targets.slice(index, index + 4).map(page => recognizeKnowledgePage(page.id)))
      succeeded += results.filter(result => result.status === 'fulfilled').length
    }
    const failed = targets.length - succeeded
    if (failed > 0) {
      MessagePlugin.warning(`已提交 ${succeeded} 页识别，${failed} 页提交失败`)
    }
    else {
      MessagePlugin.success(`已提交 ${succeeded} 页识别`)
    }
    await load()
    emit('changed')
  }
  finally {
    batchRecognizing.value = false
  }
}

async function retryRecognition(page: KnowledgePage): Promise<void> {
  if (!canRecognizePages.value || retryingPageId.value) {
    return
  }
  retryingPageId.value = page.id
  try {
    await recognizeKnowledgePage(page.id)
    MessagePlugin.success(`文件第 ${page.physicalPageNumber} 页已重新提交识别`)
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    retryingPageId.value = null
  }
}

function openOrderDrawer(): void {
  orderDraft.value = pages.value.map(page => ({
    id: page.id,
    physicalPageNumber: page.physicalPageNumber,
    pageNumber: page.pageNumber,
    pageLabel: page.pageLabel,
  }))
  orderVisible.value = true
}

function moveOrder(index: number, offset: number): void {
  const target = index + offset
  if (index < 0 || target < 0 || target >= orderDraft.value.length) {
    return
  }
  const next = [...orderDraft.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item!)
  orderDraft.value = next
}

async function saveOrder(): Promise<void> {
  const versionId = props.versionId
  if (!versionId || ordering.value) {
    return
  }
  ordering.value = true
  try {
    await reorderVersionPages(versionId, orderDraft.value.map((entry, sort) => ({
      physicalPageNumber: entry.physicalPageNumber,
      pageNumber: sort + 1,
    })))
    MessagePlugin.success('页序已更新')
    orderVisible.value = false
    await load()
    emit('changed')
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    ordering.value = false
  }
}

function labelFromName(name: string): string {
  const base = name.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '') ?? name
  // 优先识别 page-001 / page_12 形式，其次取文件名末尾数字；
  // 前导 0 由 parseInt 统一去除，无需在正则里匹配 0*（避免回溯风险）。
  const digits = base.replace(/^page[-_\s]?/i, '').match(/^\d+$/) ?? base.match(/\d+$/)
  return digits ? String(Number.parseInt(digits[0], 10)) : ''
}

function openBatchUpload(): void {
  batchFiles.value = []
  batchZipFile.value = null
  uploadedZipFileId.value = null
  batchZipResult.value = null
  batchUnsupported.value = []
  batchDuplicateNames.value = []
  batchError.value = ''
  batchResultUncertain.value = false
  batchSourceName.value = ''
  batchVisible.value = true
}

function selectBatchFiles(selectedFiles: File[]): void {
  if (!selectedFiles.length) {
    return
  }
  batchFiles.value = []
  batchZipFile.value = null
  uploadedZipFileId.value = null
  batchZipResult.value = null
  batchUnsupported.value = []
  batchDuplicateNames.value = []
  batchError.value = ''
  batchResultUncertain.value = false
  const zip = selectedFiles.length === 1 && selectedFiles[0]!.name.toLowerCase().endsWith('.zip')
  if (zip) {
    // ZIP 交由后端 import-zip 解包：zip bomb / 路径穿越 / manifest / 自然排序均由后端负责，前端不重复实现。
    batchZipFile.value = selectedFiles[0]!
    batchSourceName.value = selectedFiles[0]!.name
    return
  }
  batchSourceName.value = `${selectedFiles.length} 张图片`
  const candidates: Array<{ file: File, pageLabel: string, pageTitle: string }> = []
  for (const file of selectedFiles) {
    if (!/\.(?:png|jpe?g)$/i.test(file.name) || !['image/png', 'image/jpeg'].includes(file.type)) {
      batchUnsupported.value.push(`${file.name}：仅支持 PNG / JPG`)
    }
    else {
      candidates.push({ file, pageLabel: labelFromName(file.name), pageTitle: '' })
    }
  }
  const nameCounts = new Map<string, number>()
  candidates.forEach(({ file }) => nameCounts.set(file.name.toLowerCase(), (nameCounts.get(file.name.toLowerCase()) ?? 0) + 1))
  batchDuplicateNames.value = [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)
  candidates.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
  if (candidates.length > 200) {
    batchUnsupported.value.push('页面数量超过单次上传上限 200 张')
  }
  const baseOrder = pages.value.reduce((max, page) => Math.max(max, page.physicalPageNumber), 0) + 1
  batchFiles.value = candidates.map((item, index) => ({
    ...item,
    physicalPageNumber: baseOrder + index,
    warning: item.file.size > batchMaxImageBytes ? '文件超过 15 MB' : !item.pageLabel ? '文件名无法识别资料页码' : '',
  }))
}

function removeBatchFile(index: number): void {
  if (batchUploading.value) {
    return
  }
  const removed = batchFiles.value[index]
  if (!removed) {
    return
  }
  const url = objectUrls.get(removed.file)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrls.delete(removed.file)
  }
  const baseOrder = pages.value.reduce((max, page) => Math.max(max, page.physicalPageNumber), 0) + 1
  batchFiles.value = batchFiles.value
    .filter((_, itemIndex) => itemIndex !== index)
    .map((item, itemIndex) => ({ ...item, physicalPageNumber: baseOrder + itemIndex }))
  batchSourceName.value = `${batchFiles.value.length} 张图片`
  const nameCounts = new Map<string, number>()
  batchFiles.value.forEach(({ file }) => nameCounts.set(file.name.toLowerCase(), (nameCounts.get(file.name.toLowerCase()) ?? 0) + 1))
  batchDuplicateNames.value = [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)
  if (batchFiles.value.length <= 200) {
    batchUnsupported.value = batchUnsupported.value.filter(message => !message.includes('页面数量超过单次上传上限'))
  }
}

function removeBatchZip(): void {
  if (batchUploading.value) {
    return
  }
  batchZipFile.value = null
  uploadedZipFileId.value = null
  batchSourceName.value = ''
  batchError.value = ''
  batchResultUncertain.value = false
}

async function sha256(file: File): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  catch {
    return undefined
  }
}

function previewUrl(file: File): string {
  let url = objectUrls.get(file)
  if (!url) {
    url = URL.createObjectURL(file)
    objectUrls.set(file, url)
  }
  return url
}

async function uploadBatch(): Promise<void> {
  if (!props.versionId || !batchCanSubmit.value) {
    return
  }
  batchUploading.value = true
  batchProgress.value = 0
  batchUploadedBytes.value = 0
  batchZipResult.value = null
  batchError.value = ''
  batchResultUncertain.value = false
  try {
    const success = batchZipFile.value ? await uploadZipBatch(batchZipFile.value) : await uploadImageBatch()
    if (!success) {
      return
    }
    await load()
    emit('changed')
  }
  catch (cause) {
    batchError.value = businessUserError(cause)
    batchResultUncertain.value = cause instanceof HttpRequestError
    MessagePlugin.error(batchError.value)
  }
  finally { batchUploading.value = false }
}

/**
 * ZIP 导入：先上传 ZIP 取得 fileId，再交由后端 import-zip 解包入库（识别异步入队）。
 * 后端未提供 ZIP 直传通道（files/upload-intents 的 mimeType 白名单不含 zip，files/:id/complete
 * 亦按 supportedMimeTypes 校验），故经版本 upload-intent 申请直传凭证，并以 PREVIEW 角色确认
 * ——仅登记资产行，不改版本主文件与解析状态，只为取得 READY 的 zipFileId。
 */
async function uploadZipBatch(file: File): Promise<boolean> {
  const versionId = props.versionId
  if (!versionId) {
    return false
  }
  if (!uploadedZipFileId.value) {
    const digest = await sha256(file)
    const intent = await createKnowledgeUploadIntent(versionId, {
      fileName: file.name,
      mimeType: 'application/zip',
      sizeBytes: file.size,
      assetRole: 'PREVIEW',
      ...(digest ? { sha256: digest } : {}),
    })
    if (intent.mode !== 'REUSE' && intent.uploadUrl) {
      await uploadFileToPresignedUrl(intent.uploadUrl, file, {
        signal: new AbortController().signal,
        onProgress: (event) => {
          batchProgress.value = event.total && event.total > 0
            ? Math.min(100, Math.round((event.loaded / event.total) * 100))
            : 0
        },
      })
      await completeKnowledgeUpload(versionId, intent.fileId, 'PREVIEW')
    }
    uploadedZipFileId.value = intent.fileId
  }
  batchProgress.value = 100
  const result = await importVersionPagesFromZip(versionId, { zipFileId: uploadedZipFileId.value, enqueueRecognition: true })
  batchZipResult.value = result
  batchVisible.value = false
  if (result.imported > 0) {
    MessagePlugin.success(`已导入 ${result.imported} 页${result.enqueued ? `，${result.enqueued} 页已进入识别队列` : ''}`)
  }
  else {
    MessagePlugin.warning('ZIP 内没有可导入的页面图片')
  }
  if (result.enqueueFailed.length > 0) {
    MessagePlugin.warning(`${result.enqueueFailed.length} 页未能开始识别，请到“核对识别结果”重试。`)
  }
  return true
}

async function uploadImageBatch(): Promise<boolean> {
  const versionId = props.versionId
  if (!versionId) {
    return false
  }
  const blocked = batchFiles.value.filter(item => item.file.size > batchMaxImageBytes)
  if (blocked.length) {
    MessagePlugin.warning('请先移除超过 15 MB 的图片')
    return false
  }
  if (batchDuplicateNames.value.length) {
    MessagePlugin.warning('请先处理重复文件名')
    return false
  }
  if (batchFiles.value.length > 200 || batchUnsupported.value.some(item => item.includes('页面数量超过'))) {
    MessagePlugin.warning('单次最多上传 200 张页面图片')
    return false
  }
  const physicalNumbers = batchFiles.value.map(item => item.physicalPageNumber)
  if (new Set(physicalNumbers).size !== physicalNumbers.length || physicalNumbers.some(number => pages.value.some(page => page.physicalPageNumber === number))) {
    MessagePlugin.warning('文件页序不能重复，请修正预览中的页面顺序')
    return false
  }
  const totalBytes = batchTotalBytes.value
  const progressByFile = new Map<File, number>()
  const trackProgress = (file: File) => (event: { loaded: number, total?: number, percent: number }): void => {
    const previous = progressByFile.get(file) ?? 0
    batchUploadedBytes.value += Math.max(0, event.loaded - previous)
    progressByFile.set(file, event.loaded)
    batchProgress.value = totalBytes > 0
      ? Math.min(100, Math.round((batchUploadedBytes.value / totalBytes) * 100))
      : 0
  }
  const uploaded: Array<{ fileId: string, physicalPageNumber: number, pageLabel: string | null, pageTitle: string | null }> = []
  let reusedCount = 0
  for (let index = 0; index < batchFiles.value.length; index += 5) {
    const chunk = await Promise.all(batchFiles.value.slice(index, index + 5).map(async (item) => {
      const file = await uploadKnowledgePageImage(item.file, {
        sha256: await sha256(item.file),
        signal: new AbortController().signal,
        onProgress: trackProgress(item.file),
      })
      trackProgress(item.file)({ loaded: item.file.size, total: item.file.size, percent: 100 })
      return { fileId: file.fileId, reused: file.reused, physicalPageNumber: item.physicalPageNumber, pageLabel: item.pageLabel || null, pageTitle: item.pageTitle || null }
    }))
    reusedCount += chunk.filter(item => item.reused).length
    uploaded.push(...chunk.map(({ reused: _reused, ...item }) => item))
  }
  batchProgress.value = 100
  // 上传成功后由后端自动入识别队列，普通用户无需再手动点击「批量识别未识别页面」。
  // 服务端同步复制图片、逐页写库并入队。按小批提交，单个请求不会因整册页数触发网关超时。
  const commitBatchSize = 10
  let committed = 0
  let enqueued = 0
  let enqueueFailed = 0
  try {
    for (let index = 0; index < uploaded.length; index += commitBatchSize) {
      const result = await batchUploadVersionPages(versionId, uploaded.slice(index, index + commitBatchSize))
      committed += result.items.length
      enqueued += result.enqueued
      enqueueFailed += result.enqueueFailed.length
    }
  }
  catch (cause) {
    // 已收到成功响应的批次无需再提交；当前请求若断线，结果仍需查看页面列表确认。
    if (committed > 0) {
      batchFiles.value = batchFiles.value.slice(committed)
      batchSourceName.value = `${batchFiles.value.length} 张图片`
      await load()
      emit('changed')
    }
    throw cause
  }
  MessagePlugin.success(`已保存 ${committed} 页页面图片${reusedCount ? `，其中 ${reusedCount} 张复用已有文件` : ''}${enqueued ? `，${enqueued} 页已进入识别队列` : ''}`)
  if (enqueueFailed > 0) {
    MessagePlugin.warning(`${enqueueFailed} 页未能开始识别，请到“核对识别结果”重试。`)
  }
  batchVisible.value = false
  return true
}

onUnmounted(() => {
  resetEditorImage()
  objectUrls.forEach(url => URL.revokeObjectURL(url))
})

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
  const next = filteredPages.value[nextIndex]
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
        <h2>资料页面</h2>
        <p>查看每页原图和识别状态；页面缺失时可补充上传。</p>
      </div>
      <t-space>
        <t-button v-if="canUploadPages" theme="primary" @click="openBatchUpload">
          批量上传页面
        </t-button>
        <t-button v-if="canEdit" theme="default" variant="outline" @click="openCreate">
          补录页面
        </t-button>
        <t-button v-if="canEdit" theme="default" variant="outline" @click="openOrderDrawer">
          调整页面顺序
        </t-button>
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
      message="正在生成页面图片。若长时间未完成，可上传完整页面图片或 ZIP 文件。"
      class="knowledge-gallery__banner"
    />

    <t-alert
      v-if="batchZipResult"
      class="knowledge-gallery__banner"
      theme="info"
      title="ZIP 导入结果"
      :close="true"
      @close="batchZipResult = null"
    >
      <p>已导入 {{ batchZipResult.imported }} 页（当前共 {{ batchZipResult.pageCount }} 页）{{ batchZipResult.hasManifest ? '，已按文件中的页面顺序排列' : '' }}。</p>
      <p v-if="batchZipResult.enqueued > 0">
        已进入识别队列：{{ batchZipResult.enqueued }} 页。
      </p>
      <p v-if="batchZipResult.enqueueFailed.length > 0">
        {{ batchZipResult.enqueueFailed.length }} 页未能开始识别，可在“核对识别结果”中重试。
      </p>
      <ul v-if="zipWarnings.length" class="knowledge-gallery__zip-warnings">
        <li v-for="(warning, index) in zipWarnings" :key="index">
          {{ warning }}
        </li>
      </ul>
    </t-alert>

    <div class="knowledge-gallery__toolbar">
      <t-input v-model="keyword" clearable placeholder="搜索标题 / 资料页码 / 页序" />
      <t-select v-model="statusFilter" :options="statusOptions" />
      <label v-if="selectable" class="knowledge-gallery__select-all">
        <t-checkbox :checked="allSelected" @change="toggleSelectAll" />
        <span>全选本页</span>
      </label>
      <div v-if="selectedCount" class="knowledge-gallery__batch-actions">
        <span class="knowledge-gallery__selected">已选 {{ selectedCount }} 页</span>
        <t-button v-if="canRecognizePages" size="small" variant="outline" :loading="batchRecognizing" @click="recognizeSelected">
          批量识别
        </t-button>
        <t-button v-if="canEdit" size="small" theme="danger" variant="outline" :loading="batchRemoving" @click="removeSelected">
          批量删除
        </t-button>
        <t-button size="small" variant="text" @click="clearSelection">
          清除选择
        </t-button>
      </div>
    </div>

    <t-loading v-if="loading" class="knowledge-gallery__loading" loading text="正在加载资料页面" />
    <t-alert
      v-else-if="error"
      theme="error"
      :message="businessUserError(error)"
      closeable
      @close="load()"
    />
    <div v-else-if="pagedPages.length" class="knowledge-gallery__body">
      <div class="knowledge-gallery__grid">
        <article
          v-for="page in pagedPages"
          :key="page.id"
          class="knowledge-page-card"
          :class="{ 'is-selected': isSelected(page) }"
        >
          <div
            class="knowledge-page-card__image"
            role="button"
            tabindex="0"
            @click="openPreview(page)"
            @keydown.enter="openPreview(page)"
            @keydown.space.prevent="openPreview(page)"
          >
            <img
              v-if="pageImage(page) && !failedPageImages.has(page.id)"
              :alt="`${knowledgePageLabel(page.pageLabel, page.physicalPageNumber)}页面`"
              :src="pageImage(page)!"
              loading="lazy"
              @error="markPageImageUnavailable(page.id)"
            >
            <span v-else>页面图片暂不可用</span>
            <div v-if="selectable" class="knowledge-page-card__check" @click.stop>
              <t-checkbox :checked="isSelected(page)" @change="toggleSelect(page)" />
            </div>
          </div>
          <div class="knowledge-page-card__body">
            <div class="knowledge-page-card__title">
              <strong>文件第 {{ page.physicalPageNumber }} 页</strong>
              <span>印刷页码 {{ page.pageLabel || '—' }}</span>
              <span v-if="page.pageTitle">{{ page.pageTitle }}</span>
            </div>
            <AppStatusTag :label="recognitionStatus(page).label" :status="recognitionStatus(page).status" />
            <p v-if="page.recognitionStatus === 'FAILED' && page.lastRecognitionError" class="knowledge-page-card__warning is-error">
              识别失败（{{ page.lastRecognitionErrorCode || '旧任务未记录错误码' }}）。请到“核对识别结果”查看原因和任务编号。
            </p>
            <p v-else-if="page.recognitionWarnings?.length" class="knowledge-page-card__warning">
              有识别备注，可在“核对识别结果”查看原文。
            </p>
            <div class="knowledge-page-card__actions">
              <t-button v-if="canRecognizePages && page.recognitionStatus === 'FAILED'" size="small" variant="outline" :loading="retryingPageId === page.id" @click="retryRecognition(page)">
                重新识别
              </t-button>
              <t-button v-if="canEdit" size="small" variant="text" @click="openEdit(page)">
                编辑
              </t-button>
              <t-button v-if="canEdit" size="small" theme="danger" variant="text" @click="requestRemove(page)">
                删除
              </t-button>
              <t-button v-if="canReviewPages" size="small" theme="primary" variant="text" @click="emit('reviewPage', page.physicalPageNumber)">
                核对结果
              </t-button>
            </div>
          </div>
        </article>
      </div>
      <div v-if="filteredPages.length > listPageSize" class="knowledge-gallery__pagination">
        <t-pagination
          v-model="listPage"
          :page-size="listPageSize"
          :total="filteredPages.length"
          size="small"
        />
      </div>
    </div>
    <div v-else-if="pages.length" class="knowledge-gallery__empty">
      <p>没有符合条件的页面</p>
      <p>试试切换识别状态或清空搜索关键词。</p>
      <t-button variant="outline" @click="resetFilters">
        重置筛选
      </t-button>
    </div>
    <AppEmptyState
      v-else
      :description="canUploadPages ? (rendering ? '系统正在生成页面图片；也可上传完整页面图片或 ZIP 文件。' : '上传完整页面图片后，系统会自动识别内容。') : '请联系有上传权限的管理员添加资料页面。'"
      :title="rendering ? '页面图片生成中' : '还没有资料页面'"
    >
      <template v-if="canUploadPages" #action>
        <t-button theme="primary" @click="openBatchUpload">
          上传页面图片
        </t-button>
      </template>
    </AppEmptyState>

    <t-dialog
      v-model:visible="editorVisible"
      :confirm-btn="{ content: '保存', loading: submitting }"
      destroy-on-close
      :header="editing ? '编辑资料页面' : '补充资料页面'"
      @confirm="save"
    >
      <t-form :data="editor" label-align="top">
        <t-form-item label="文件中的页面顺序" required-mark>
          <t-input-number v-model="editor.pageNumber" :min="1" />
        </t-form-item>
        <t-form-item label="资料页码">
          <t-input v-model="editor.pageLabel" maxlength="32" placeholder="如 A1、21" />
        </t-form-item>
        <t-form-item label="页面标题">
          <t-input v-model="editor.pageTitle" maxlength="255" placeholder="请输入页面标题" />
        </t-form-item>
        <t-form-item label="页面图片" :required-mark="!editing">
          <div class="knowledge-gallery__edit-image">
            <div v-if="editing && pageImage(editing) && !failedPageImages.has(editing.id)" class="knowledge-gallery__edit-preview" role="button" tabindex="0" aria-label="查看当前页面图片" @click="openPreview(editing)" @keydown.enter="openPreview(editing)" @keydown.space.prevent="openPreview(editing)">
              <img :src="pageImage(editing)!" :alt="`文件第 ${editing.physicalPageNumber} 页原图`" @error="markPageImageUnavailable(editing.id)">
              <span>当前图片 · 点击查看原图</span>
            </div>
            <p v-else-if="editing">当前页面图片暂不可用</p>
            <div v-if="editorImageUrl" class="knowledge-gallery__selected-image">
              <img :src="editorImageUrl" :alt="editorImageFile?.name || '待保存页面图片'">
              <span>{{ editorImageFile?.name }} · {{ editing ? '待替换' : '待上传' }}</span>
              <t-button size="small" variant="text" :disabled="submitting" @click="removeEditorImage">移除</t-button>
            </div>
            <div class="knowledge-gallery__edit-replacement">
              <t-upload accept=".png,.jpg,.jpeg" :auto-upload="false" :allow-upload-duplicate-file="true" :disabled="submitting" :file-list-display="() => null" :files="[]" :multiple="false" :max="1" :show-upload-progress="false" :on-select-change="onEditorImageChange">
                <t-button variant="outline" :disabled="submitting">{{ editing ? '选择替换图片' : '选择页面图片' }}</t-button>
              </t-upload>
              <span>{{ editing ? '不更换则保留原图 · ' : '' }}支持 PNG / JPG，最大 15 MB</span>
            </div>
            <t-progress v-if="submitting && editorImageFile && editorUploadProgress > 0 && editorUploadProgress < 100" :percentage="editorUploadProgress" :label="false" />
          </div>
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="batchVisible" header="批量上传页面图片" width="min(900px, 94vw)" :confirm-btn="{ content: '上传页面', loading: batchUploading, disabled: !batchCanSubmit }" @confirm="uploadBatch">
      <div class="knowledge-gallery__batch-head">
        <p>支持多张 PNG/JPG 图片，或一个 ZIP 压缩包。每张图片不超过 15 MB。</p>
        <t-upload accept=".png,.jpg,.jpeg,.zip" :auto-upload="false" :allow-upload-duplicate-file="true" :file-list-display="() => null" :files="[]" :multiple="true" :max="200" :show-upload-progress="false" :on-select-change="selectBatchFiles">
          <t-button variant="outline">
            {{ batchFileCount ? '重新选择文件' : '选择文件' }}
          </t-button>
        </t-upload>
      </div>
      <div v-if="batchFileCount" class="knowledge-gallery__batch-summary">
        <template v-if="batchIsZip">
          {{ batchSourceName }} · {{ batchTotalSizeLabel }} · 页数以系统解包结果为准
        </template>
        <template v-else>
          待上传 {{ batchEstimatedPages }} 页 · 印刷页码 {{ batchFiles[0]?.pageLabel || '—' }} 至 {{ batchFiles.at(-1)?.pageLabel || '—' }} · 共 {{ batchTotalSizeLabel }}
        </template>
      </div>
      <t-progress
        v-if="batchUploading"
        class="knowledge-gallery__batch-progress"
        :percentage="batchProgress"
        :stroke-width="8"
        theme="line"
      />
      <t-alert v-if="batchDuplicateNames.length" theme="warning" :message="`重复文件：${batchDuplicateNames.join('、')}`" />
      <t-alert
        v-if="batchError" theme="error" :message="batchResultUncertain
          ? `导入结果未确认：${businessUserMessage(batchError)}。服务器可能仍在处理，请先刷新页图并核对缺失页，再重试。`
          : `导入未完成：${businessUserMessage(batchError)}。已保留未提交的文件和页码，可重试。`"
      />
      <t-alert v-for="(warning, index) in batchUnsupported" :key="index" theme="warning" :message="warning" />
      <p v-if="batchIsZip" class="knowledge-gallery__batch-hint">
        系统会解压并校验 ZIP（页序、页数上限、图片格式、重复页码），完成后自动开始识别。
      </p>
      <div v-if="batchZipFile" class="knowledge-gallery__batch-zip">
        <span :title="batchZipFile.name">{{ batchZipFile.name }}</span>
        <t-button size="small" variant="text" theme="danger" :disabled="batchUploading" @click="removeBatchZip">
          移除
        </t-button>
      </div>
      <div v-else-if="batchFiles.length" class="knowledge-gallery__batch-list" role="list" aria-label="待上传页面">
        <div v-for="(item, index) in batchFiles" :key="`${item.file.name}-${index}`" class="knowledge-gallery__batch-row" role="listitem">
          <img :src="previewUrl(item.file)" :alt="item.file.name" loading="lazy">
          <strong class="knowledge-gallery__batch-name" :title="item.file.name">{{ item.file.name }}</strong>
          <span class="knowledge-gallery__batch-page">文件第 {{ item.physicalPageNumber }} 页</span>
          <t-input v-model="item.pageLabel" class="knowledge-gallery__batch-label" :aria-label="`${item.file.name}的印刷页码`" placeholder="印刷页码" />
          <t-input v-model="item.pageTitle" class="knowledge-gallery__batch-title" :aria-label="`${item.file.name}的页面标题`" placeholder="页面标题" />
          <span class="knowledge-gallery__batch-size" :class="item.warning ? 'is-warning' : ''">{{ item.warning || `${(item.file.size / 1024 / 1024).toFixed(1)} MB` }}</span>
          <t-button class="knowledge-gallery__batch-remove" size="small" variant="text" theme="danger" :aria-label="`移除 ${item.file.name}`" :disabled="batchUploading" @click="removeBatchFile(index)">
            移除
          </t-button>
        </div>
      </div>
    </t-dialog>

    <t-drawer
      v-model:visible="orderVisible"
      :confirm-btn="{ content: '保存页序', loading: ordering }"
      header="高级页序调整"
      size="min(520px, 94vw)"
      @confirm="saveOrder"
    >
      <p class="knowledge-gallery__order-hint">
        按列表顺序重新编号「系统页序」；印刷页码与识别结果不受影响。常规情况下无需手动调整。
      </p>
      <div class="knowledge-gallery__order-list">
        <div v-for="(item, index) in orderDraft" :key="item.id" class="knowledge-gallery__order-row">
          <span class="knowledge-gallery__order-index">{{ index + 1 }}</span>
          <span class="knowledge-gallery__order-label">
            第 {{ item.pageNumber }} 页 · 印刷页码 {{ item.pageLabel || '—' }}
          </span>
          <t-space size="small">
            <t-button size="small" variant="text" :disabled="index === 0" @click="moveOrder(index, -1)">
              上移
            </t-button>
            <t-button size="small" variant="text" :disabled="index === orderDraft.length - 1" @click="moveOrder(index, 1)">
              下移
            </t-button>
          </t-space>
        </div>
      </div>
    </t-drawer>

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
            系统页序 第 {{ previewPage?.pageNumber ?? '—' }} 页 · 印刷页码
            {{ previewPage ? knowledgePageLabel(previewPage.pageLabel, previewPage.physicalPageNumber) : '' }}
            {{ previewPage?.pageTitle ? `· ${previewPage.pageTitle}` : '' }}
          </span>
          <t-space>
            <t-button size="small" :disabled="previewIndex <= 0" @click="goPreview(-1)">
              上一页
            </t-button>
            <t-button size="small" :disabled="previewIndex < 0 || previewIndex >= filteredPages.length - 1" @click="goPreview(1)">
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
            v-if="previewPage && pageImage(previewPage) && !failedPageImages.has(previewPage.id)"
            :src="pageImage(previewPage)!"
            :style="{
              transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewScale})`,
              cursor: previewScale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
            }"
            alt="完整页面预览"
            draggable="false"
            @error="previewPage && markPageImageUnavailable(previewPage.id)"
          >
          <p v-else>
            原始页面图片暂不可用，请检查资料页面的图片来源。
          </p>
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
.knowledge-gallery__edit-image {
  display: grid;
  width: 100%;
  gap: var(--td-size-3);
}

.knowledge-gallery__edit-preview {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  width: 100%;
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  text-align: left;
  cursor: pointer;
}

.knowledge-gallery__edit-preview img {
  width: 112px;
  height: 80px;
  object-fit: contain;
}

.knowledge-gallery__selected-image {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  min-width: 0;
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-gallery__selected-image img {
  width: 112px;
  height: 80px;
  flex: none;
  object-fit: contain;
}

.knowledge-gallery__selected-image span {
  flex: 1;
  overflow: hidden;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-gallery__edit-replacement {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-gallery {
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
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

.knowledge-gallery__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.knowledge-gallery__toolbar :deep(.t-input) {
  width: 240px;
}

.knowledge-gallery__toolbar :deep(.t-select) {
  width: 150px;
}

.knowledge-gallery__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  cursor: pointer;
}

.knowledge-gallery__batch-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.knowledge-gallery__selected {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 16px;
}

.knowledge-page-card {
  min-width: 0;
  max-width: 300px;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.knowledge-page-card.is-selected {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 1px var(--td-brand-color) inset;
}

.knowledge-page-card__image {
  position: relative;
  display: grid;
  width: 100%;
  height: 160px;
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

.knowledge-page-card__check {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-container);
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
  white-space: nowrap;
}

.knowledge-page-card__warning {
  margin: 0;
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}
.knowledge-page-card__warning.is-error { color: var(--td-error-color); }
.knowledge-page-card__image:focus-visible { outline: 2px solid var(--td-brand-color); outline-offset: -2px; }
.knowledge-page-card__diagnostic pre { white-space: pre-wrap; overflow-wrap: anywhere; }

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

.knowledge-gallery__loading {
  display: grid;
  min-height: 160px;
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

.knowledge-gallery__batch-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--td-size-3);
  margin-bottom: var(--td-size-3);
  padding: var(--td-size-3) var(--td-size-4);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
}
.knowledge-gallery__batch-head p { margin: 0; }

.knowledge-gallery__batch-summary {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
}

.knowledge-gallery__batch-list {
  display: grid;
  max-height: min(52vh, 520px);
  overflow: auto;
  min-width: 0;
  margin-top: var(--td-size-3);
  padding: 0 var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-gallery__batch-row {
  display: grid;
  grid-template-columns: 42px minmax(110px, 1.3fr) 90px 110px minmax(120px, 1fr) 100px auto;
  align-items: center;
  gap: var(--td-size-2);
  min-width: 0;
  padding: var(--td-size-2) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}
.knowledge-gallery__batch-row:last-child { border-bottom: 0; }

.knowledge-gallery__batch-row img {
  width: 42px;
  height: 56px;
  object-fit: contain;
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-gallery__batch-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-gallery__batch-row .is-warning {
  color: var(--td-warning-color);
}
.knowledge-gallery__batch-zip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  margin-top: var(--td-size-3);
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-secondarycontainer);
}
.knowledge-gallery__batch-zip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knowledge-gallery__batch-page,
.knowledge-gallery__batch-size { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }

.knowledge-gallery__batch-progress {
  margin: 8px 0;
}

.knowledge-gallery__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--td-text-color-secondary);
  text-align: center;
}

.knowledge-gallery__empty p {
  margin: 0;
}

.knowledge-gallery__batch-hint,
.knowledge-gallery__order-hint {
  margin: 12px 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-gallery__order-hint {
  margin: 0 0 12px;
}

.knowledge-gallery__zip-warnings {
  margin: 6px 0 0;
  padding-left: 18px;
}

.knowledge-gallery__order-list {
  display: grid;
  gap: 6px;
  max-height: 70vh;
  overflow: auto;
}

.knowledge-gallery__order-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-default);
}

.knowledge-gallery__order-index {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--td-radius-circle);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-gallery__order-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .knowledge-gallery__grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
}

@media (max-width: 720px) {
  .knowledge-gallery__grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
}
@media (max-width: 800px) {
  .knowledge-gallery__batch-row {
    grid-template-columns: 42px minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .knowledge-gallery__batch-row img { grid-row: span 3; }
  .knowledge-gallery__batch-name { grid-column: 2 / 4; }
  .knowledge-gallery__batch-remove { grid-column: 4; grid-row: 1; }
  .knowledge-gallery__batch-page { grid-column: 2; }
  .knowledge-gallery__batch-size { grid-column: 3 / 5; }
  .knowledge-gallery__batch-label { grid-column: 2; }
  .knowledge-gallery__batch-title { grid-column: 3 / 5; }
}
</style>
