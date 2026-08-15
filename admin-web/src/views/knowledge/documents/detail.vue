<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData, UploadChangeContext, UploadFile } from 'tdesign-vue-next'
import { computed, h, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, CloudUploadIcon } from 'tdesign-icons-vue-next'
import { DialogPlugin, Link, MessagePlugin } from 'tdesign-vue-next'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import type { AppTableAction } from '@/types/crud'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  approveKnowledgeVersion,
  completeKnowledgeUpload,
  createKnowledgeUploadIntent,
  createKnowledgeVersion,
  deleteKnowledgeDocumentVersion,
  disableKnowledgeVersion,
  fetchChunkTerms,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeParsingJobs,
  fetchVersionChunks,
  fetchVersionPages,
  mergeKnowledgeChunk,
  publishKnowledgeVersion,
  rebuildKnowledgeChunks,
  restartKnowledgeParse,
  rollbackKnowledgeVersion,
  splitKnowledgeChunk,
  startKnowledgeParse,
  updateKnowledgeChunk,
} from '@/api/modules/knowledge'
import { api } from '@/api/http/client'
import {
  knowledgeChunkContentTypes,
  type KnowledgeChunk,
  type KnowledgeChunkContentType,
  type KnowledgeDocument,
  type KnowledgeDocumentVersion,
  type KnowledgePage,
  type KnowledgeParsingJob,
  type KnowledgeParsingJobStatus,
} from '@/types/knowledge'
import { knowledgeParseStatusMeta, knowledgeVersionStatusMeta } from '@/utils/professional-status'
import { formatDate } from '@/utils/day'

const route = useRoute()
const router = useRouter()
const documentId = String(route.params.id)

const { canAccess } = usePermissionAccess()
const canUpload = computed(() => canAccess({ permissions: ['system:knowledge:doc:upload'] }))
const canParse = computed(() => canAccess({ permissions: ['system:knowledge:doc:parse'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:knowledge:doc:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:knowledge:doc:publish'] }))
const canEditChunk = computed(() => canAccess({ permissions: ['system:knowledge:chunk:edit'] }))
const canDeleteVersion = computed(() => canAccess({ permissions: ['system:knowledge:doc:remove'] }))
const canSplitChunk = computed(() => canAccess({ permissions: ['system:knowledge:chunk:split'] }))
const canMergeChunk = computed(() => canAccess({ permissions: ['system:knowledge:chunk:merge'] }))

const document = ref<KnowledgeDocument | null>(null)
const versions = ref<KnowledgeDocumentVersion[]>([])
const isLoading = ref(false)
const error = ref<unknown>(null)

// ===== 版本操作状态 =====
const runningAction = ref<string>('')

// ===== 解析任务进度与错误信息 =====
const parsingJob = ref<KnowledgeParsingJob | null>(null)
let parsePollTimer: ReturnType<typeof setInterval> | null = null

const parsingJobTerminalStates = new Set<KnowledgeParsingJobStatus>(['COMPLETED', 'FAILED', 'OCR_REQUIRED'])
const parsingJobActive = computed(() => parsingJob.value !== null && !parsingJobTerminalStates.has(parsingJob.value.status))

function parsingJobSummary(job: KnowledgeParsingJob): string {
  const result = job.result as { pageCount?: number; chunkCount?: number } | null
  return result?.pageCount != null ? `${result.pageCount} 页${result.chunkCount != null ? ` / ${result.chunkCount} 片段` : ''}` : ''
}

async function loadParsingJob(versionId: string): Promise<void> {
  if (!versionId) {
    parsingJob.value = null
    return
  }
  try {
    const result = await fetchKnowledgeParsingJobs({ page: 1, pageSize: 1, versionId })
    parsingJob.value = result.items[0] ?? null
  }
  catch {
    parsingJob.value = null
  }
}

function stopParsingPoll(): void {
  if (parsePollTimer !== null) {
    clearInterval(parsePollTimer)
    parsePollTimer = null
  }
}

function pollParsingJob(versionId: string): void {
  stopParsingPoll()
  void loadParsingJob(versionId)
  parsePollTimer = setInterval(() => {
    if (selectedVersionId.value !== versionId) {
      stopParsingPoll()
      return
    }
    void loadParsingJob(versionId).then(() => {
      const job = parsingJob.value
      if (job === null || !parsingJobTerminalStates.has(job.status)) {
        return
      }
      stopParsingPoll()
      if (job.status === 'COMPLETED') {
        const summary = parsingJobSummary(job)
        MessagePlugin.success(`识别完成${summary ? `（${summary}）` : ''}`)
      }
      else if (job.status === 'FAILED') {
        MessagePlugin.error(job.errorMessage ?? '识别失败，请检查文件后重试')
      }
      else {
        MessagePlugin.warning('该文件需要人工处理，系统无法直接识别文字')
      }
      return load()
    })
  }, 3000)
}

const activeTab = ref('versions')

const versionOptions = computed(() =>
  versions.value.map((item) => ({
    label: `v${item.version} · ${knowledgeVersionStatusMeta[item.status].label}`,
    value: item.id,
    disabled: !item.fileId,
  })),
)

// ===== 页面列表 =====
const pageQuery = reactive({ page: 1, pageSize: 20 })
const pages = ref<KnowledgePage[]>([])
const pageTotal = ref(0)
const pagesLoading = ref(false)
const pagesError = ref<unknown>(null)
const selectedVersionId = ref('')

// ===== 分块列表 =====
const chunkQuery = reactive({ page: 1, pageSize: 20 })
const chunks = ref<KnowledgeChunk[]>([])
const chunkTotal = ref(0)
const chunkContentType = ref<KnowledgeChunkContentType | undefined>(undefined)
const chunksLoading = ref(false)
const chunksError = ref<unknown>(null)

const docTypeLabel: Record<string, string> = {
  SPECIFICATION: '产品规范',
  DETAIL_ATLAS: '图集',
  STANDARD: '标准',
  APPLICATION_GUIDE: '应用指南',
  MATERIAL_COMPARISON: '材料对比',
  COMPANY_PROFILE: '企业资料',
  THERMAL_FORMULA: '热工公式',
  OTHER: '其他',
}

// ===== 数据加载 =====

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeDocumentDetail(documentId)
    document.value = result.document
    versions.value = result.versions
    // 版本按版本号降序返回：优先受控发布版本，其次最近一个已上传文件的版本（未传文件的新版本没有内容可看）
    const current =
      result.versions.find((item) => item.status === 'PUBLISHED') ??
      result.versions.find((item) => item.fileId) ??
      result.versions[0]
    if (current && selectedVersionId.value !== current.id) {
      selectedVersionId.value = current.id
    }
    void loadParsingJob(selectedVersionId.value)
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

async function loadPages(): Promise<void> {
  if (!selectedVersionId.value) {
    return
  }
  pagesLoading.value = true
  pagesError.value = null
  try {
    const result = await fetchVersionPages(selectedVersionId.value, pageQuery.page, pageQuery.pageSize)
    pages.value = result.items
    pageTotal.value = result.total
  }
  catch (cause) {
    pagesError.value = cause
  }
  finally {
    pagesLoading.value = false
  }
}

async function loadChunks(): Promise<void> {
  if (!selectedVersionId.value) {
    return
  }
  chunksLoading.value = true
  chunksError.value = null
  try {
    const result = await fetchVersionChunks(
      selectedVersionId.value,
      chunkQuery.page,
      chunkQuery.pageSize,
      chunkContentType.value,
    )
    chunks.value = result.items
    chunkTotal.value = result.total
  }
  catch (cause) {
    chunksError.value = cause
  }
  finally {
    chunksLoading.value = false
  }
}

function selectVersion(id: string): void {
  if (selectedVersionId.value === id) {
    return
  }
  selectedVersionId.value = id
  stopParsingPoll()
  pageQuery.page = 1
  chunkQuery.page = 1
  void loadParsingJob(id)
  void loadPages()
  void loadChunks()
}

function onPageChange(pageInfo: PageInfo): void {
  pageQuery.page = pageInfo.current
  if (pageInfo.pageSize) {
    pageQuery.pageSize = pageInfo.pageSize
  }
  void loadPages()
}

function onChunkPageChange(pageInfo: PageInfo): void {
  chunkQuery.page = pageInfo.current
  if (pageInfo.pageSize) {
    chunkQuery.pageSize = pageInfo.pageSize
  }
  void loadChunks()
}

function filterChunks(): void {
  chunkQuery.page = 1
  void loadChunks()
}

// ===== 版本操作 =====

function selectedVersion(): KnowledgeDocumentVersion | undefined {
  return versions.value.find((item) => item.id === selectedVersionId.value)
}

function runVersionAction(key: string, action: () => Promise<unknown>): void {
  if (runningAction.value) {
    MessagePlugin.warning('已有操作进行中，请稍候')
    return
  }
  runningAction.value = key
  action()
    .then((payload) => {
      if (key === 'parse') {
        const versionId = (payload as { versionId?: string } | null)?.versionId
        if (versionId) {
          pollParsingJob(versionId)
        }
      }
      MessagePlugin.success('操作成功')
      return load()
    })
    .catch((cause: unknown) => {
      MessagePlugin.error(normalizeFeedbackError(cause).message)
    })
    .finally(() => {
      runningAction.value = ''
    })
}

const createVersionAction = useConfirmedCrudAction<void, unknown>({
  action: async () => {
    await createKnowledgeVersion(documentId, {})
  },
  confirm: () => ({
    title: '新建版本',
    content: '将基于当前文档创建一个新版本，随后可上传文件并识别内容。',
  }),
  successMessage: '新版本已创建',
  onSuccess: () => load(),
})

const approveAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await approveKnowledgeVersion(row.id)
  },
  confirm: (row) => ({ title: '审核通过', content: `确定审核通过 v${row.version}？通过后即可发布为当前使用版本。` }),
  successMessage: '已审核通过',
  onSuccess: () => load(),
})

const publishAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await publishKnowledgeVersion(row.id)
  },
  confirm: (row) => ({ title: '发布版本', content: `确定将 v${row.version} 发布为当前使用版本？本文档其他已发布版本将自动停用。`, danger: true }),
  successMessage: '已发布',
  onSuccess: () => load(),
})

const disableAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await disableKnowledgeVersion(row.id)
  },
  confirm: (row) => ({ title: '停用版本', content: `确定停用 v${row.version}？停用后该文档将不再参与检索。`, danger: true }),
  successMessage: '已停用',
  onSuccess: () => load(),
})

const rollbackAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await rollbackKnowledgeVersion(documentId, row.id)
  },
  confirm: (row) => ({
    title: '复制为新版本',
    content: `将基于 v${row.version} 复制一个新版本（沿用原文件），用于修改后重新审核发布。`,
  }),
  successMessage: '新版本已创建',
  onSuccess: () => load(),
})

const deleteVersionAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await deleteKnowledgeDocumentVersion(row.id)
  },
  confirm: (row) => ({
    title: '删除版本',
    content: `确定删除草稿 v${row.version}？该版本的内容、识别记录与上传文件将一并删除，且无法恢复。`,
    danger: true,
  }),
  successMessage: '版本已删除',
  onSuccess: () => load(),
})

// ===== 文件上传 =====

const uploadVisible = ref(false)
const uploadFile = ref<File | null>(null)
const uploadFileMeta = ref<UploadFile[]>([])
const uploading = ref(false)

function openUploadDialog(version: KnowledgeDocumentVersion): void {
  uploadFile.value = null
  uploadFileMeta.value = []
  selectedVersionId.value = version.id
  uploadVisible.value = true
}

function onUploadChange(value: UploadFile[], context: UploadChangeContext): void {
  console.log('[upload:change]', {
    trigger: context.trigger,
    valueLen: value?.length ?? 0,
    file: context.file?.name,
    hasRaw: Boolean(context.file?.raw),
  })
  uploadFile.value = context.trigger === 'remove' || context.trigger === 'abort' ? null : (context.file?.raw ?? null)
  console.log('[upload:file]', uploadFile.value?.name ?? null)
}

async function computeSha256(file: File): Promise<string | undefined> {
  try {
    if (!crypto?.subtle) {
      return undefined
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  catch {
    return undefined
  }
}

async function submitUpload(): Promise<void> {
  const version = selectedVersion()
  const file = uploadFile.value
  console.log('[upload:submit]', { versionId: version?.id ?? null, file: file?.name ?? null, uploading: uploading.value })
  if (!version) {
    MessagePlugin.warning('请先选择要上传的版本')
    return
  }
  if (!file) {
    MessagePlugin.warning('请选择要上传的文件')
    return
  }
  if (uploading.value) {
    return
  }
  uploading.value = true
  try {
    const sha256 = await computeSha256(file)
    console.log('[upload:sha256]', sha256?.slice(0, 12) ?? 'unsupported')
    const intent = await createKnowledgeUploadIntent(version.id, {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      ...(sha256 ? { sha256 } : {}),
    })
    console.log('[upload:intent]', { fileId: intent.fileId, uploadUrl: intent.uploadUrl, headers: intent.headers ?? null })
    const response = await fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: intent.headers ?? undefined,
      body: file,
    })
    console.log('[upload:put]', response.status, response.statusText)
    if (!response.ok) {
      throw new Error(`对象存储上传失败（HTTP ${response.status}）`)
    }
    const completed = await completeKnowledgeUpload(version.id, intent.fileId)
    console.log('[upload:complete]', completed)
    MessagePlugin.success('文件上传完成，可开始识别')
    uploadVisible.value = false
    await load()
  }
  catch (cause) {
    console.error('[upload:error]', cause)
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
  finally {
    uploading.value = false
  }
}

// ===== 预览 =====

async function previewVersion(version: KnowledgeDocumentVersion): Promise<void> {
  if (!version.fileId) {
    MessagePlugin.warning('该版本还没有上传文件')
    return
  }
  try {
    const result = await api.get<{ url: string }>(`/api/v1/files/${encodeURIComponent(version.fileId)}/download-url`)
    window.open(result.url, '_blank', 'noopener')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

// ===== 分块干预 =====

const editChunkVisible = ref(false)
const editingChunk = ref<KnowledgeChunk | null>(null)
const editForm = reactive({
  keywords: [] as string[],
  heading: '',
  headingLevel: 0,
  citationAnchor: '',
  annotation: '',
  invalid: false,
  invalidReason: '',
})
const chunkSubmitting = ref(false)

function openChunkEditor(chunk: KnowledgeChunk): void {
  editingChunk.value = chunk
  editForm.keywords = chunk.keywords ?? []
  editForm.heading = chunk.sourceSection ?? ''
  editForm.headingLevel = chunk.headingLevel ?? 0
  editForm.citationAnchor = chunk.citationAnchor ?? ''
  editForm.annotation = chunk.annotation ?? ''
  editForm.invalid = chunk.invalid ?? false
  editForm.invalidReason = chunk.invalidReason ?? ''
  editChunkVisible.value = true
}

async function submitChunkEditor(): Promise<void> {
  const chunk = editingChunk.value
  if (!chunk || chunkSubmitting.value) {
    return
  }
  chunkSubmitting.value = true
  try {
    await updateKnowledgeChunk(chunk.id, {
      keywords: editForm.keywords,
      heading: editForm.heading.trim() || null,
      headingLevel: editForm.headingLevel,
      citationAnchor: editForm.citationAnchor.trim() || null,
      annotation: editForm.annotation.trim() || null,
      invalid: editForm.invalid,
      invalidReason: editForm.invalid ? (editForm.invalidReason.trim() || null) : null,
    })
    MessagePlugin.success('片段已更新')
    editChunkVisible.value = false
    await loadChunks()
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
  finally {
    chunkSubmitting.value = false
  }
}

const splitVisible = ref(false)
const splitChunkTarget = ref<KnowledgeChunk | null>(null)
const splitAt = ref(1)
const splitHeading = ref('')

function openSplitDialog(chunk: KnowledgeChunk): void {
  splitChunkTarget.value = chunk
  splitAt.value = Math.floor(chunk.content.length / 2)
  splitHeading.value = ''
  splitVisible.value = true
}

async function submitSplit(): Promise<void> {
  const chunk = splitChunkTarget.value
  if (!chunk) {
    return
  }
  const at = Math.floor(splitAt.value)
  if (at < 1 || at >= chunk.content.length) {
    MessagePlugin.warning(`拆分位置需在 1 ~ ${chunk.content.length - 1} 之间`)
    return
  }
  try {
    await splitKnowledgeChunk(chunk.id, at, splitHeading.value.trim() || undefined)
    MessagePlugin.success('片段已拆分')
    splitVisible.value = false
    await loadChunks()
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

const mergeTargetId = ref('')

function openMergeDialog(chunk: KnowledgeChunk): void {
  mergeTargetId.value = ''
  DialogPlugin.confirm({
    header: `合并片段 #${chunk.chunkIndex + 1}`,
    body: () => h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
      h('span', { style: 'color:var(--td-text-color-secondary);font-size:12px' }, '将当前片段合并到所选片段中（内容按顺序拼接，当前片段会被移除）'),
      h(
        'select',
        {
          value: mergeTargetId.value,
          onInput: (event: Event) => { mergeTargetId.value = (event.target as HTMLSelectElement).value },
          style: 'width:100%;padding:6px 8px;border:1px solid var(--td-component-border);border-radius:6px',
        },
        chunks.value
          .filter((item) => item.id !== chunk.id)
          .map((item) => h('option', { value: item.id }, `#${item.chunkIndex + 1} ${item.sourceSection ?? item.contentType}（第 ${item.sourcePage ?? '?'} 页）`)),
      ),
    ]),
    confirmBtn: { content: '合并', theme: 'primary' },
    onConfirm: async () => {
      if (!mergeTargetId.value) {
        MessagePlugin.warning('请选择要合并到的片段')
        return false
      }
      try {
        await mergeKnowledgeChunk(chunk.id, mergeTargetId.value)
        MessagePlugin.success('片段已合并')
        await loadChunks()
        return true
      }
      catch (cause) {
        MessagePlugin.error(normalizeFeedbackError(cause).message)
        return false
      }
    },
  })
}

async function showChunkTerms(chunk: KnowledgeChunk): Promise<void> {
  try {
    const result = await fetchChunkTerms(chunk.id)
    const lines = result.items.map((item) => `${item.term}（${item.termType}）`).join('、')
    MessagePlugin.info(lines ? `命中术语：${lines}` : '该片段暂无术语标注')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

// ===== 内容详情预览 =====

const pagePreviewVisible = ref(false)
const pagePreviewTarget = ref<KnowledgePage | null>(null)
const chunkPreviewVisible = ref(false)
const chunkPreviewTarget = ref<KnowledgeChunk | null>(null)

function openPagePreview(page: KnowledgePage): void {
  pagePreviewTarget.value = page
  pagePreviewVisible.value = true
}

function openChunkPreview(chunk: KnowledgeChunk): void {
  chunkPreviewTarget.value = chunk
  chunkPreviewVisible.value = true
}

// ===== 表格列 =====

const versionColumns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => `v${row.version}`, colKey: 'version', minWidth: 70, title: '版本' },
  { cell: (_, { row }) => row.title, colKey: 'title', minWidth: 220, title: '标题' },
  {
    cell: (_, { row }) => {
      const meta = knowledgeVersionStatusMeta[row.status as keyof typeof knowledgeVersionStatusMeta]
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'status',
    minWidth: 90,
    title: '状态',
  },
  {
    cell: (_, { row }) => {
      const meta = knowledgeParseStatusMeta[row.parseStatus as keyof typeof knowledgeParseStatusMeta]
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'parseStatus',
    minWidth: 110,
    title: '识别状态',
  },
  { cell: (_, { row }) => (row.pageCount != null ? `${row.pageCount} 页` : '—'), colKey: 'pageCount', minWidth: 80, title: '页数' },
  {
    cell: (_, { row }) => (row.publishedAt ? formatDate(new Date(row.publishedAt), 'YYYY-MM-DD HH:mm') : row.updatedAt ? formatDate(new Date(row.updatedAt), 'YYYY-MM-DD HH:mm') : '—'),
    colKey: 'publishedAt',
    minWidth: 150,
    title: '发布时间',
  },
]

const pageColumns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => `第 ${row.pageNumber} 页`, colKey: 'pageNumber', minWidth: 90, title: '页码' },
  { cell: (_, { row }) => row.sectionPath || '—', colKey: 'sectionPath', minWidth: 180, title: '所在章节' },
  { cell: (_, { row }) => (row.hasTables ? '是' : '否'), colKey: 'hasTables', minWidth: 70, title: '含表格' },
  { cell: (_, { row }) => (row.hasImages ? '是' : '否'), colKey: 'hasImages', minWidth: 70, title: '含图片' },
  {
    cell: (_, { row }) => {
      const page = row as KnowledgePage
      return page.parsedText
        ? h(Link, { theme: 'primary', hover: 'color', onClick: () => openPagePreview(page) }, () => '查看详情')
        : '—'
    },
    colKey: 'parsedText',
    minWidth: 120,
    title: '识别出的文字',
  },
]

const chunkTypeLabel: Record<string, string> = {
  PARAGRAPH: '段落',
  TITLE: '标题',
  SECTION: '章节',
  CLAUSE: '条款',
  TABLE: '表格',
  NOTE: '注释',
  FORMULA: '公式',
  IMAGE_CAPTION: '图注',
}

const chunkColumns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => `#${row.chunkIndex + 1}`, colKey: 'chunkIndex', minWidth: 60, title: '序号' },
  { cell: (_, { row }) => chunkTypeLabel[row.contentType as string] ?? row.contentType, colKey: 'contentType', minWidth: 70, title: '类型' },
  { cell: (_, { row }) => (row.sourcePage != null ? `第 ${row.sourcePage} 页` : '—'), colKey: 'sourcePage', minWidth: 90, title: '页码' },
  { cell: (_, { row }) => row.sourceSection || '—', colKey: 'sourceSection', minWidth: 150, title: '章节' },
  {
    cell: (_, { row }) => h(Link, { theme: 'primary', hover: 'color', onClick: () => openChunkPreview(row as KnowledgeChunk) }, () => '查看详情'),
    colKey: 'content',
    minWidth: 120,
    title: '内容与标注',
  },
]

function getVersionActions(row: TableRowData): AppTableAction[] {
  const version = row as KnowledgeDocumentVersion
  const actions: AppTableAction[] = []
  if (canUpload.value && version.status === 'DRAFT') {
    actions.push({ key: 'upload', label: '上传文件', handler: () => openUploadDialog(version) })
  }
  if (canParse.value && version.fileId && version.status !== 'PUBLISHED' && version.status !== 'DISABLED') {
    actions.push({
      key: 'parse',
      label: version.parseStatus === 'FAILED' ? '重新识别' : '开始识别',
      loading: runningAction.value === 'parse',
      handler: () => runVersionAction('parse', async () => {
        const result = version.parseStatus === 'FAILED' ? await restartKnowledgeParse(version.id) : await startKnowledgeParse(version.id)
        return { versionId: version.id, jobId: result.jobId }
      }),
    })
  }
  if (canParse.value && version.fileId && version.status !== 'PUBLISHED' && version.status !== 'DISABLED' && version.parseStatus === 'PARSED') {
    actions.push({
      key: 'rebuild',
      label: '重新整理内容',
      loading: runningAction.value === 'rebuild',
      handler: () => runVersionAction('rebuild', () => rebuildKnowledgeChunks(version.id)),
    })
  }
  if (canApprove.value && version.status === 'DRAFT' && version.parseStatus === 'PARSED') {
    actions.push({ key: 'approve', label: '审核通过', loading: approveAction.running.value, handler: () => approveAction.run(version) })
  }
  if (canPublish.value && version.status === 'APPROVED') {
    actions.push({ key: 'publish', label: '发布', loading: publishAction.running.value, handler: () => publishAction.run(version) })
  }
  if (canPublish.value && version.status === 'PUBLISHED') {
    actions.push({ key: 'disable', label: '停用', theme: 'danger', loading: disableAction.running.value, handler: () => disableAction.run(version) })
  }
  if (canPublish.value && (version.status === 'PUBLISHED' || version.status === 'DISABLED')) {
    actions.push({ key: 'rollback', label: '复制为新版本', loading: rollbackAction.running.value, handler: () => rollbackAction.run(version) })
  }
  if (canDeleteVersion.value && version.status === 'DRAFT') {
    actions.push({ key: 'delete', label: '删除', theme: 'danger', loading: deleteVersionAction.running.value, handler: () => deleteVersionAction.run(version) })
  }
  if (version.fileId && (version.status === 'PUBLISHED' || version.status === 'DRAFT')) {
    actions.push({ key: 'preview', label: '查看原文件', handler: () => previewVersion(version) })
  }
  return actions
}

function getChunkActions(row: TableRowData): AppTableAction[] {
  const chunk = row as KnowledgeChunk
  const version = selectedVersion()
  const editable = version?.status === 'DRAFT' || version?.status === 'APPROVED'
  if (!editable) {
    return [{ key: 'terms', label: '查看术语', handler: () => showChunkTerms(chunk) }]
  }
  const actions: AppTableAction[] = [{ key: 'terms', label: '查看术语', handler: () => showChunkTerms(chunk) }]
  if (canEditChunk.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => openChunkEditor(chunk) })
  }
  if (canSplitChunk.value && chunk.contentType !== 'TABLE') {
    actions.push({ key: 'split', label: '拆分', handler: () => openSplitDialog(chunk) })
  }
  if (canMergeChunk.value && chunk.contentType !== 'TABLE') {
    actions.push({ key: 'merge', label: '合并', handler: () => openMergeDialog(chunk) })
  }
  return actions
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  stopParsingPoll()
})
</script>

<template>
  <AppPage :title="document?.title ?? '文档详情'" :description="document ? `${docTypeLabel[document.docType] ?? document.docType}${document.docNumber ? ` · ${document.docNumber}` : ''}${document.sourceOrg ? ` · ${document.sourceOrg}` : ''}` : '加载中...'">
    <template #navigation>
      <t-button variant="text" @click="router.back">
        <template #icon><ArrowLeftIcon /></template>
        返回
      </t-button>
    </template>

    <template #actions>
      <t-tag v-if="document" variant="outline">{{ document.status === 'ACTIVE' ? '启用' : '停用' }}</t-tag>
      <t-tag v-if="document?.currentVersion" variant="light" theme="primary">当前使用版本 v{{ document.currentVersion.version }}</t-tag>
    </template>

    <t-tabs v-model="activeTab" @change="(value) => { if (value === 'pages') { pageQuery.page = 1; void loadPages() } if (value === 'chunks') { chunkQuery.page = 1; void loadChunks() } }">
      <t-tab-panel value="versions" label="版本与发布">
        <t-space direction="vertical" size="16" style="width: 100%">
          <div v-if="parsingJobActive" class="vicp-parse-panel">
            <t-progress
              :percentage="parsingJob?.progress ?? 5"
              :label="`识别中 ${parsingJob?.progress ?? 5}%`"
              status="active"
              theme="plump"
            />
            <span class="vicp-parse-hint">识别进行中，完成后自动刷新</span>
          </div>
          <AppDataTable
            :columns="versionColumns"
            :data="versions"
            description="上传文件、识别内容、审核并发布；发布后的版本会成为系统检索使用的内容"
            empty-description="暂无版本，点击右上角「新建版本」开始"
            empty-title="暂无版本"
            :error-description="error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'"
            :operations-width="360"
            row-key="id"
            :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
            @refresh="load"
            @retry="load"
          >
            <template #toolbar>
              <t-button v-if="canUpload" theme="primary" :loading="createVersionAction.running.value" @click="() => void createVersionAction.run()">
                <template #icon><CloudUploadIcon /></template>
                新建版本
              </t-button>
            </template>
            <template #operations="{ row }">
              <AppTableActions :actions="getVersionActions(row)" />
            </template>
          </AppDataTable>
        </t-space>
      </t-tab-panel>

      <t-tab-panel value="pages" label="内容预览">
        <AppDataTable
          :columns="pageColumns"
          :data="pages"
          description="文档识别出的文字内容，按页展示，便于核对识别结果"
          empty-description="该版本还没有识别内容，请先上传文件并识别"
          empty-title="暂无内容"
          :error-description="pagesError ? normalizeFeedbackError(pagesError).message : '请检查网络连接后重试'"
          row-key="id"
          :status="pagesLoading ? 'loading' : pagesError ? 'error' : 'ready'"
          :total="pageTotal"
          @page-change="onPageChange"
          @refresh="loadPages"
          @retry="loadPages"
        >
          <template #toolbar>
            <t-select v-model="selectedVersionId" :options="versionOptions" placeholder="选择版本" style="width: 220px" @change="(value) => selectVersion(String(value))" />
          </template>
        </AppDataTable>
      </t-tab-panel>

      <t-tab-panel value="chunks" label="知识片段">
        <AppDataTable
          :columns="chunkColumns"
          :data="chunks"
          description="系统检索回答时引用的正文片段，可编辑、拆分或合并"
          empty-description="该版本还没有生成内容片段"
          empty-title="暂无片段"
          :error-description="chunksError ? normalizeFeedbackError(chunksError).message : '请检查网络连接后重试'"
          :operations-width="220"
          row-key="id"
          :status="chunksLoading ? 'loading' : chunksError ? 'error' : 'ready'"
          :total="chunkTotal"
          @page-change="onChunkPageChange"
          @refresh="loadChunks"
          @retry="loadChunks"
        >
          <template #toolbar>
            <t-space>
              <t-select v-model="selectedVersionId" :options="versionOptions" placeholder="选择版本" style="width: 220px" @change="(value) => selectVersion(String(value))" />
              <t-select
                v-model="chunkContentType"
                :options="knowledgeChunkContentTypes.map((value) => ({ label: chunkTypeLabel[value], value }))"
                clearable
                placeholder="全部类型"
                style="width: 160px"
                @change="filterChunks"
              />
            </t-space>
          </template>
          <template #operations="{ row }">
            <AppTableActions :actions="getChunkActions(row)" />
          </template>
        </AppDataTable>
      </t-tab-panel>
    </t-tabs>

    <!-- 文件上传 -->
    <t-dialog v-model:visible="uploadVisible" header="上传文件" :confirm-btn="{ content: '上传', theme: 'primary', loading: uploading }" :on-confirm="submitUpload" :on-cancel="() => (uploadVisible = false)">
      <t-upload
        v-model="uploadFileMeta"
        :auto-upload="false"
        accept=".pdf,.doc,.docx,.xls,.xlsx"
        :max="1"
        theme="file"
        placeholder="支持 PDF / DOCX / XLSX，最大 1GB"
        @change="onUploadChange"
      />
      <t-alert theme="warning" message="上传后需手动点击「开始识别」；已发布版本不能更换文件，请先复制为新版本。" style="margin-top: 12px" />
    </t-dialog>

    <!-- 分块元数据编辑 -->
    <t-dialog v-model:visible="editChunkVisible" header="编辑片段信息" :confirm-btn="{ content: '保存', theme: 'primary', loading: chunkSubmitting }" :on-confirm="submitChunkEditor" :on-cancel="() => (editChunkVisible = false)" width="min(560px, 92vw)">
      <t-form label-align="top">
        <t-form-item label="章节标题">
          <t-input v-model="editForm.heading" maxlength="255" placeholder="如：4.2.1 保温层设计" />
        </t-form-item>
        <t-form-item label="标题层级">
          <t-input-number v-model="editForm.headingLevel" :min="0" :max="6" />
        </t-form-item>
        <t-form-item label="引用位置">
          <t-input v-model="editForm.citationAnchor" maxlength="255" placeholder="如：第4.2.1条" />
        </t-form-item>
        <t-form-item label="关键词">
          <t-select v-model="editForm.keywords" multiple filterable creatable placeholder="输入后回车添加" />
        </t-form-item>
        <t-form-item label="备注">
          <t-textarea v-model="editForm.annotation" :maxlength="1000" placeholder="审核备注或内容说明" />
        </t-form-item>
        <t-form-item label="标记为无效">
          <t-switch v-model="editForm.invalid" />
        </t-form-item>
        <t-form-item v-if="editForm.invalid" label="无效原因">
          <t-input v-model="editForm.invalidReason" maxlength="500" placeholder="如：内容乱码，无法使用" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 分块拆分 -->
    <t-dialog v-model:visible="splitVisible" header="拆分片段" :confirm-btn="{ content: '拆分', theme: 'primary' }" :on-confirm="submitSplit" :on-cancel="() => (splitVisible = false)">
      <t-form label-align="top">
        <t-form-item label="拆分位置（从第几个字符处拆分）">
          <t-input-number v-model="splitAt" :min="1" :max="(splitChunkTarget?.content.length ?? 2) - 1" />
        </t-form-item>
        <t-form-item label="后半段标题（可选）">
          <t-input v-model="splitHeading" maxlength="255" placeholder="拆分后第二段的标题" />
        </t-form-item>
      </t-form>
      <t-alert theme="info" message="拆分后内容会分成两段：前一段保留原序号，后一段成为新的片段。表格内容不能拆分。" style="margin-top: 12px" />
    </t-dialog>

    <!-- 识别文字预览 -->
    <t-dialog v-model:visible="pagePreviewVisible" header="识别出的文字" :footer="false" width="min(680px, 92vw)" :on-close="() => (pagePreviewVisible = false)">
      <template v-if="pagePreviewTarget">
        <div class="vicp-preview-meta">
          第 {{ pagePreviewTarget.pageNumber }} 页
          <template v-if="pagePreviewTarget.sectionPath"> · {{ pagePreviewTarget.sectionPath }}</template>
        </div>
        <div class="vicp-preview-body">{{ pagePreviewTarget.parsedText || '（无文本）' }}</div>
      </template>
    </t-dialog>

    <!-- 片段内容预览 -->
    <t-dialog v-model:visible="chunkPreviewVisible" header="内容与标注" :footer="false" width="min(680px, 92vw)" :on-close="() => (chunkPreviewVisible = false)">
      <template v-if="chunkPreviewTarget">
        <div class="vicp-preview-meta">
          #{{ chunkPreviewTarget.chunkIndex + 1 }} · {{ chunkTypeLabel[chunkPreviewTarget.contentType] ?? chunkPreviewTarget.contentType }}
          <template v-if="chunkPreviewTarget.sourcePage != null"> · 第 {{ chunkPreviewTarget.sourcePage }} 页</template>
          <template v-if="chunkPreviewTarget.sourceSection"> · {{ chunkPreviewTarget.sourceSection }}</template>
        </div>
        <div class="vicp-preview-body">{{ chunkPreviewTarget.content }}</div>
        <div
          v-if="chunkPreviewTarget.keywords?.length || chunkPreviewTarget.aliasTerms?.length || chunkPreviewTarget.citationAnchor || chunkPreviewTarget.invalid"
          class="vicp-preview-meta-list"
        >
          <div v-if="chunkPreviewTarget.keywords?.length" class="vicp-preview-meta-item"><span>关键词</span>{{ chunkPreviewTarget.keywords.join('、') }}</div>
          <div v-if="chunkPreviewTarget.aliasTerms?.length" class="vicp-preview-meta-item"><span>别名</span>{{ chunkPreviewTarget.aliasTerms.join('、') }}</div>
          <div v-if="chunkPreviewTarget.citationAnchor" class="vicp-preview-meta-item"><span>引用位置</span>{{ chunkPreviewTarget.citationAnchor }}</div>
          <div v-if="chunkPreviewTarget.invalid" class="vicp-preview-meta-item is-invalid"><span>无效标记</span>{{ chunkPreviewTarget.invalidReason ?? '未填写原因' }}</div>
        </div>
      </template>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.vicp-parse-panel {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vicp-parse-hint {
  color: var(--td-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.vicp-preview-meta {
  margin-bottom: 12px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-preview-body {
  max-height: 60vh;
  overflow: auto;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.vicp-preview-meta-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--td-component-stroke);
}
.vicp-preview-meta-item {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
}
.vicp-preview-meta-item span {
  display: inline-block;
  min-width: 56px;
  margin-right: 8px;
  color: var(--td-text-color-secondary);
}
.vicp-preview-meta-item.is-invalid {
  color: var(--td-error-color);
}
</style>