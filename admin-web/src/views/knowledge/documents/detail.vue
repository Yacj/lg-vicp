<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData, UploadChangeContext, UploadFile } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeAssetRole, KnowledgeChunk, KnowledgeChunkContentType, KnowledgeDocument, KnowledgeDocumentAsset, KnowledgeDocumentVersion, KnowledgePage, KnowledgePageMapping, KnowledgePageWindowItem, KnowledgeParsingJob, KnowledgeParsingJobStatus, KnowledgeSearchHit, KnowledgeTocItem, KnowledgeVersionSection } from '@/types/knowledge'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import KnowledgeAssetPanel from '@/components/business/KnowledgeAssetPanel.vue'
import KnowledgeHitCard from '@/components/business/KnowledgeHitCard.vue'
import KnowledgePageMappingTable from '@/components/business/KnowledgePageMappingTable.vue'
import KnowledgePageView from '@/components/business/KnowledgePageView.vue'
import KnowledgeTocEditor from '@/components/business/KnowledgeTocEditor.vue'
import { ArrowLeftIcon, CloudUploadIcon } from 'tdesign-icons-vue-next'
import { DialogPlugin, Link, MessagePlugin } from 'tdesign-vue-next'
import { computed, h, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/http/client'
import { approveKnowledgeVersion, completeKnowledgeUpload, createKnowledgeUploadIntent, createKnowledgeVersion, deleteKnowledgeDocumentVersion, deleteKnowledgeTocItem, disableKnowledgeVersion, fetchChunkTerms, fetchKnowledgeDocumentDetail, fetchKnowledgeParsingJobs, fetchVersionAssets, fetchVersionChunks, fetchVersionPageMappings, fetchVersionPageWindow, fetchVersionSections, fetchVersionToc, mergeKnowledgeChunk, publishKnowledgeVersion, rebuildKnowledgeChunks, remapVersionToc, replaceVersionToc, restartKnowledgeParse, rollbackKnowledgeVersion, searchKnowledge, splitKnowledgeChunk, startKnowledgeParse, updateKnowledgeChunk, updateVersionUsageMode, verifyVersionPageMappings } from '@/api/modules/knowledge'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { aiSourceRefFromSearchHit } from '@/types/ai-source'
import {

  knowledgeChunkContentTypes,

} from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeParseStatusMetaFor, knowledgeVersionStatusMetaFor } from '@/utils/professional-status'
import { buildSectionTree, filterSectionTree, flattenSectionTree, pagesInSection } from '@/utils/wiki-sections'

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
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))

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
  const result = job.result as { pageCount?: number, chunkCount?: number } | null
  return result?.pageCount != null ? `${result.pageCount} 页${result.chunkCount != null ? ` / ${result.chunkCount} 片段` : ''}` : ''
}

// ===== 阅读视图（目录 + 完整页面） =====
const selectedVersionId = ref('')
const readingPages = ref<KnowledgePage[]>([])
const readingTotal = ref<number | null>(null)
const readingLoading = ref(false)
const readingError = ref<unknown>(null)
const currentPageNumber = ref<number | null>(null)
const currentPhysicalPageNumber = ref<number | null>(null)
const outlineKeyword = ref('')
const sectionNodes = ref<KnowledgeVersionSection[]>([])
const sectionsReady = ref(false)
const READING_CACHE_LIMIT = 8
const readingCache = new Map<number, KnowledgePage>()
const readingCacheAccess = new Map<number, number>()
let readingAccessSequence = 0
let readingRequest: AbortController | null = null
let readingRequestSequence = 0

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

const assets = ref<KnowledgeDocumentAsset[]>([])
const tocItems = ref<KnowledgeTocItem[]>([])
const mappings = ref<KnowledgePageMapping[]>([])
const originalPreviewFile = ref<{ id: string, originalName: string, mimeType: string } | null>(null)
const assetLoading = ref(false)
const tocLoading = ref(false)
const mappingLoading = ref(false)
const tocSaving = ref(false)
const previewVisible = ref(false)
const previewPageNumber = ref<number | null>(null)
const machineVisible = ref(false)
const machinePage = ref<KnowledgePage | null>(null)
const tocSelectedId = ref<string | null>(null)
const uploadRole = ref<KnowledgeAssetRole>('ORIGINAL')

async function loadAssets(): Promise<void> {
  if (!selectedVersionId.value) return
  assetLoading.value = true
  try {
    assets.value = (await fetchVersionAssets(selectedVersionId.value)).items
    const original = assets.value.find(item => item.role === 'ORIGINAL')
    originalPreviewFile.value = original ? { id: original.fileId, originalName: original.fileName, mimeType: original.mimeType } : null
  }
  catch { assets.value = [] }
  finally { assetLoading.value = false }
}

async function loadToc(): Promise<void> {
  if (!selectedVersionId.value) return
  tocLoading.value = true
  try { tocItems.value = (await fetchVersionToc(selectedVersionId.value)).items }
  catch { tocItems.value = [] }
  finally { tocLoading.value = false }
}

async function loadMappings(): Promise<void> {
  if (!selectedVersionId.value) return
  mappingLoading.value = true
  try { mappings.value = (await fetchVersionPageMappings(selectedVersionId.value)).items }
  catch { mappings.value = [] }
  finally { mappingLoading.value = false }
}

const tocSelected = computed(() => tocItems.value.find(item => item.id === tocSelectedId.value) ?? null)
const tocSelectedPage = computed(() => tocSelected.value?.physicalPageNumber ?? null)
const resolvedMappings = computed(() => mappings.value.map((mapping) => {
  const original = readingPages.value.find(page => page.id === mapping.originalPageId)
  return {
    ...mapping,
    originalPhysicalPageNumber: mapping.originalPhysicalPageNumber ?? original?.physicalPageNumber ?? null,
  }
}))

function openOriginalPage(pageNumber: number | null): void {
  if (pageNumber == null || !originalPreviewFile.value) {
    MessagePlugin.warning(originalPreviewFile.value ? '该目录项尚未绑定正式原文件页' : '请先上传正式原文件')
    return
  }
  previewPageNumber.value = pageNumber
  previewVisible.value = true
}

function openMachinePage(page: KnowledgePage): void {
  machinePage.value = page
  machineVisible.value = true
}

async function saveToc(items: KnowledgeTocItem[], confirm: boolean): Promise<void> {
  if (!selectedVersionId.value) return
  tocSaving.value = true
  try {
    await replaceVersionToc(selectedVersionId.value, items.map(({ id: _id, children: _children, status: _status, confidence: _confidence, ...item }) => item), confirm)
    await loadToc()
    MessagePlugin.success(confirm ? '目录已保存并确认' : '目录已保存')
  } catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
  finally { tocSaving.value = false }
}

async function deleteToc(item: KnowledgeTocItem): Promise<void> {
  try { await deleteKnowledgeTocItem(item.id); await loadToc(); MessagePlugin.success('目录项已删除') }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
}

function addToc(): void {
  const next: KnowledgeTocItem = { id: `new-${Date.now()}`, parentId: null, title: '新目录项', level: 1, sortOrder: tocItems.value.length, pageLabel: null, physicalPageNumber: null, source: 'MANUAL', confidence: null, status: 'DRAFT' }
  void saveToc([...tocItems.value, next], false)
}

async function autoMatchMappings(): Promise<void> {
  if (!selectedVersionId.value) return
  try { await remapVersionToc(selectedVersionId.value); await loadToc(); await loadMappings(); MessagePlugin.success('已完成自动匹配，请人工确认低置信映射') }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
}

async function verifyMapping(mapping: KnowledgePageMapping): Promise<void> {
  if (mapping.originalPhysicalPageNumber == null || !selectedVersionId.value) { MessagePlugin.warning('该映射缺少正式原文件页，请先完成绑定'); return }
  try { await verifyVersionPageMappings(selectedVersionId.value, [{ searchPhysicalPageNumber: mapping.searchPhysicalPageNumber, originalPhysicalPageNumber: mapping.originalPhysicalPageNumber, pageLabel: mapping.pageLabel }]); await loadMappings(); MessagePlugin.success('页面映射已确认') }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
}

async function batchConfirmMappings(): Promise<void> {
  const valid = resolvedMappings.value.filter(item => item.originalPhysicalPageNumber != null).map(item => ({ searchPhysicalPageNumber: item.searchPhysicalPageNumber, originalPhysicalPageNumber: item.originalPhysicalPageNumber!, pageLabel: item.pageLabel }))
  if (valid.length === 0) { MessagePlugin.warning('暂无可确认的页面映射'); return }
  try { await verifyVersionPageMappings(selectedVersionId.value, valid); await loadMappings(); MessagePlugin.success(`已确认 ${valid.length} 条页面映射`) }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
}

const activeTab = ref('proofing')
const proofingTab = ref('toc')
const advancedTab = ref('machine')
const versionOptions = computed(() =>
  versions.value.map(item => ({
    label: `v${item.version} · ${knowledgeVersionStatusMetaFor(item.status).label}`,
    value: item.id,
    disabled: !item.fileId,
  })),
)

// ===== 分块列表（辅助查询索引，高级调试） =====
const chunkQuery = reactive({ page: 1, pageSize: 20 })
const chunks = ref<KnowledgeChunk[]>([])
const chunkTotal = ref(0)
const chunkContentType = ref<KnowledgeChunkContentType | undefined>(undefined)
const chunksLoading = ref(false)
const chunksError = ref<unknown>(null)

// ===== 引用测试（本文档维度检索） =====
const citationQuery = ref('')
const citationSearching = ref(false)
const citationError = ref<string | null>(null)
const citationSearched = ref(false)
const citationHits = ref<KnowledgeSearchHit[]>([])
const citationTook = ref(0)

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
    const current
      = result.versions.find(item => item.status === 'PUBLISHED')
        ?? result.versions.find(item => item.fileId)
        ?? result.versions[0]
    if (current && selectedVersionId.value !== current.id) {
      selectedVersionId.value = current.id
    }
    void loadParsingJob(selectedVersionId.value)
    void loadAssets()
    void loadToc()
    void loadMappings()
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

/** 章节树独立加载：失败或为空时目录自动回退到按页面 sectionPath 聚合，不影响完整页阅读 */
async function loadSections(): Promise<void> {
  if (!selectedVersionId.value) {
    return
  }
  try {
    const result = await fetchVersionSections(selectedVersionId.value)
    sectionNodes.value = result.sections
    sectionsReady.value = true
  }
  catch {
    sectionNodes.value = []
    sectionsReady.value = false
  }
}

function touchReadingCache(page: KnowledgePage): void {
  readingCache.set(page.physicalPageNumber, page)
  readingCacheAccess.set(page.physicalPageNumber, ++readingAccessSequence)
  while (readingCache.size > READING_CACHE_LIMIT) {
    const oldest = [...readingCacheAccess.entries()].sort((a, b) => a[1] - b[1])[0]
    if (!oldest) break
    readingCacheAccess.delete(oldest[0])
    readingCache.delete(oldest[0])
  }
}

function resetReadingCache(): void {
  readingCache.clear()
  readingCacheAccess.clear()
  readingPages.value = []
  readingTotal.value = null
}

function pageFromWindowItem(item: KnowledgePageWindowItem, versionId: string): KnowledgePage {
  return {
    id: item.id,
    documentId,
    versionId,
    pageNumber: item.pageNumber,
    physicalPageNumber: item.physicalPageNumber,
    pageLabel: item.pageLabel,
    pageTitle: item.pageTitle,
    parsedText: null,
    extractedText: null,
    pageImageObjectKey: null,
    pageImageUrl: null,
    sectionPath: item.sectionPath,
    hasTables: item.hasTables,
    hasImages: item.hasImages,
    parseStatus: 'PENDING',
    createdAt: new Date().toISOString(),
  }
}

/** 按当前物理页读取完整内容，并预取前后各两页轻量导航信息；完整页使用最近八页 LRU 缓存。 */
async function loadReadingPages(center = currentPhysicalPageNumber.value ?? 1): Promise<void> {
  if (!selectedVersionId.value) return
  readingRequest?.abort()
  const controller = new AbortController()
  readingRequest = controller
  const sequence = ++readingRequestSequence
  readingLoading.value = true
  readingError.value = null
  void loadSections()
  try {
    const result = await fetchVersionPageWindow(selectedVersionId.value, center, 2, 2, controller.signal)
    if (sequence !== readingRequestSequence || controller.signal.aborted) return
    const current = result.page
    const currentPage: KnowledgePage = {
      id: current.id,
      documentId,
      versionId: selectedVersionId.value,
      pageNumber: current.pageNumber,
      physicalPageNumber: current.physicalPageNumber,
      pageLabel: current.pageLabel,
      pageTitle: current.pageTitle,
      parsedText: current.fullText,
      extractedText: current.extractedText,
      pageImageObjectKey: null,
      pageImageUrl: current.pageImageUrl,
      sectionPath: result.items.find(item => item.physicalPageNumber === current.physicalPageNumber)?.sectionPath ?? null,
      blocks: current.blocks,
      hasTables: current.blocks.some(block => block.contentType === 'TABLE'),
      hasImages: false,
      parseStatus: 'PARSED',
      createdAt: new Date().toISOString(),
    }
    touchReadingCache(currentPage)
    const visiblePages = new Map<number, KnowledgePage>()
    for (const item of result.items) {
      const cached = readingCache.get(item.physicalPageNumber)
      visiblePages.set(item.physicalPageNumber, cached ?? pageFromWindowItem(item, selectedVersionId.value))
    }
    for (const page of readingCache.values()) visiblePages.set(page.physicalPageNumber, page)
    readingPages.value = [...visiblePages.values()].sort((a, b) => a.physicalPageNumber - b.physicalPageNumber)
    currentPhysicalPageNumber.value = current.physicalPageNumber
    currentPageNumber.value = current.pageNumber
    readingTotal.value = result.total
  }
  catch (cause) {
    if (!controller.signal.aborted && sequence === readingRequestSequence) readingError.value = cause
  }
  finally {
    if (sequence === readingRequestSequence) readingLoading.value = false
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
  resetReadingCache()
  currentPageNumber.value = null
  currentPhysicalPageNumber.value = null
  sectionNodes.value = []
  sectionsReady.value = false
  chunkQuery.page = 1
  void loadParsingJob(id)
  void loadAssets()
  void loadToc()
  void loadMappings()
  void loadReadingPages()
  if (canDebug.value) void loadChunks()
}

function filterChunks(): void {
  chunkQuery.page = 1
  void loadChunks()
}

function onChunkPageChange(pageInfo: PageInfo): void {
  chunkQuery.page = pageInfo.current
  if (pageInfo.pageSize) {
    chunkQuery.pageSize = pageInfo.pageSize
  }
  void loadChunks()
}

// ===== 阅读视图目录与翻页 =====

interface ReadingOutlineNode {
  key: string
  label: string
  pageNumbers: number[]
  depth: number
}

/** 后端章节树可读（非空）时优先用真树；否则回退到按页面 sectionPath 聚合的扁平目录 */
const readingOutline = computed<ReadingOutlineNode[]>(() => {
  const keyword = outlineKeyword.value.trim()
  if (sectionsReady.value && sectionNodes.value.length > 0) {
    const tree = filterSectionTree(buildSectionTree(sectionNodes.value), keyword)
    return flattenSectionTree(tree)
      .map(({ node, depth }) => ({
        key: node.id,
        label: node.title,
        depth,
        pageNumbers: pagesInSection(node, readingPages.value),
      }))
  }

  const groups = new Map<string, number[]>()
  for (const page of readingPages.value) {
    const label = page.sectionPath?.trim() || '未标注章节'
    const bucket = groups.get(label)
    if (bucket) {
      bucket.push(page.pageNumber)
    }
    else {
      groups.set(label, [page.pageNumber])
    }
  }
  const normalizedKeyword = keyword.toLowerCase()
  return [...groups.entries()]
    .filter(([label]) => !normalizedKeyword || label.toLowerCase().includes(normalizedKeyword))
    .map(([label, pageNumbers]) => ({
      key: label,
      label,
      pageNumbers: [...pageNumbers].sort((a, b) => a - b),
      depth: 0,
    }))
})

/** 章节树是否在实际生效（用于文案提示数据来源） */
const usingSectionTree = computed(() =>
  sectionsReady.value && sectionNodes.value.length > 0)

const currentPage = computed(() =>
  readingPages.value.find(page => page.physicalPageNumber === currentPhysicalPageNumber.value) ?? null)

const hasPrevPage = computed(() => (currentPhysicalPageNumber.value ?? 1) > 1)
const hasNextPage = computed(() => readingTotal.value != null && (currentPhysicalPageNumber.value ?? 0) < readingTotal.value)

function selectOutline(node: ReadingOutlineNode): void {
  const target = node.pageNumbers[0]
  if (target !== undefined) void openReadingPage(target)
}

function goToPhysicalPage(physicalPageNumber: number): void {
  void openReadingPage(physicalPageNumber)
}

function goToPage(pageNumber: number): void {
  void openReadingPage(pageNumber)
}

async function openReadingPage(physicalPageNumber: number): Promise<void> {
  const cached = readingCache.get(physicalPageNumber)
  if (cached?.blocks && cached.extractedText !== null) {
    touchReadingCache(cached)
    currentPhysicalPageNumber.value = physicalPageNumber
    currentPageNumber.value = cached.pageNumber
    readingPages.value = [...readingCache.values()].sort((a, b) => a.physicalPageNumber - b.physicalPageNumber)
    return
  }
  await loadReadingPages(physicalPageNumber)
}

function stepPage(offset: -1 | 1): void {
  const current = currentPhysicalPageNumber.value
  if (current === null) return
  const target = current + offset
  if (target >= 1) void openReadingPage(target)
}

// ===== 引用测试（本文档维度层级检索） =====

const citationSources = computed(() =>
  citationHits.value.map(hit => ({
    source: aiSourceRefFromSearchHit(hit),
    debug: canDebug.value
      ? {
          hitReason: hit.hitReason,
          matchReasons: hit.matchReasons?.join('、'),
          matchedTerms: hit.matchedTerms?.join('、'),
          contentType: hit.contentType,
          rankScore: hit.rankScore,
        } as Record<string, unknown>
      : null,
  })))

async function runCitationSearch(): Promise<void> {
  const text = citationQuery.value.trim()
  if (!text) {
    MessagePlugin.warning('请输入测试问题')
    return
  }
  if (citationSearching.value) {
    return
  }
  citationSearching.value = true
  citationError.value = null
  try {
    const result = await searchKnowledge({ query: text, limit: 20 })
    citationHits.value = result.items.filter(hit => hit.documentId === documentId)
    citationTook.value = result.took
    citationSearched.value = true
  }
  catch (cause) {
    citationError.value = normalizeFeedbackError(cause).message
  }
  finally {
    citationSearching.value = false
  }
}

// ===== 版本操作 =====

function selectedVersion(): KnowledgeDocumentVersion | undefined {
  return versions.value.find(item => item.id === selectedVersionId.value)
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
  confirm: row => ({ title: '审核通过', content: `确定审核通过 v${row.version}？通过后即可发布为当前使用版本。` }),
  successMessage: '已审核通过',
  onSuccess: () => load(),
})

const publishAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await publishKnowledgeVersion(row.id)
  },
  confirm: row => ({ title: '发布版本', content: `确定将 v${row.version} 发布为当前使用版本？本文档其他已发布版本将自动停用。`, danger: true }),
  successMessage: '已发布',
  onSuccess: () => load(),
})

const disableAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await disableKnowledgeVersion(row.id)
  },
  confirm: row => ({ title: '停用版本', content: `确定停用 v${row.version}？停用后该文档将不再参与检索。`, danger: true }),
  successMessage: '已停用',
  onSuccess: () => load(),
})

const rollbackAction = useConfirmedCrudAction<KnowledgeDocumentVersion, unknown>({
  action: async (row) => {
    await rollbackKnowledgeVersion(documentId, row.id)
  },
  confirm: row => ({
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
  confirm: row => ({
    title: '删除版本',
    content: `确定删除草稿 v${row.version}？该版本的内容、识别记录与上传文件将一并删除，且无法恢复。`,
    danger: true,
  }),
  successMessage: '版本已删除',
  onSuccess: () => load(),
})

async function changeUsageMode(mode: 'AI_ENABLED' | 'BROWSE_ONLY'): Promise<void> {
  const version = selectedVersion()
  if (!version || version.usageMode === mode) {
    return
  }
  try {
    await updateVersionUsageMode(version.id, mode)
    version.usageMode = mode
    MessagePlugin.success(mode === 'AI_ENABLED' ? '已启用 AI 检索' : '已切换为仅原文浏览')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

const publishReadiness = computed(() => {
  const version = selectedVersion()
  if (!version) {
    return { blockers: [], warnings: [] }
  }
  const blockers: string[] = []
  const warnings: string[] = []
  const hasSearchSource = assets.value.some(item => item.role === 'SEARCH_SOURCE') || assets.value.some(item => item.role === 'ORIGINAL')
  if (version.usageMode === 'AI_ENABLED' && !hasSearchSource) {
    blockers.push('AI 检索需要正式文件或独立的检索文件')
  }
  if (version.usageMode === 'AI_ENABLED' && mappings.value.some(item => item.originalPageId == null)) {
    warnings.push('部分检索页尚未关联正式原文件页')
  }
  if (tocItems.value.length > 0 && !tocItems.value.some(item => item.status === 'CONFIRMED')) {
    warnings.push('原文目录尚未确认')
  }
  return { blockers, warnings }
})

// ===== 文件上传 =====

const uploadVisible = ref(false)
const uploadFile = ref<File | null>(null)
const uploadFileMeta = ref<UploadFile[]>([])
const uploading = ref(false)

function openUploadDialog(version: KnowledgeDocumentVersion, role: KnowledgeAssetRole = uploadRole.value): void {
  uploadRole.value = role
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
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
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
      ...(uploadRole.value !== 'ORIGINAL' ? { assetRole: uploadRole.value } : {}),
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
    const completed = await completeKnowledgeUpload(version.id, intent.fileId, uploadRole.value === 'ORIGINAL' ? undefined : uploadRole.value)
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

function openDownloadedFile(url: string): void { window.open(url, '_blank', 'noopener') }

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
          .filter(item => item.id !== chunk.id)
          .map(item => h('option', { value: item.id }, `#${item.chunkIndex + 1} ${item.sourceSection ?? item.contentType}（第 ${item.sourcePage ?? '?'} 页）`)),
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
    const lines = result.items.map(item => `${item.term}（${item.termType}）`).join('、')
    MessagePlugin.info(lines ? `命中术语：${lines}` : '该片段暂无术语标注')
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
}

// ===== 内容详情预览 =====

const chunkPreviewVisible = ref(false)
const chunkPreviewTarget = ref<KnowledgeChunk | null>(null)

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
      const meta = knowledgeVersionStatusMetaFor(row.status as string)
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'status',
    minWidth: 90,
    title: '状态',
  },
  {
    cell: (_, { row }) => {
      const meta = knowledgeParseStatusMetaFor(row.parseStatus as string)
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
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回
      </t-button>
    </template>

    <template #actions>
      <t-tag v-if="document" variant="outline">
        {{ document.status === 'ACTIVE' ? '启用' : '停用' }}
      </t-tag>
      <t-tag v-if="document?.currentVersion" variant="light" theme="primary">
        当前使用版本 v{{ document.currentVersion.version }}
      </t-tag>
    </template>

    <t-tabs v-model="activeTab" @change="(value: unknown) => { if (value === 'proofing') { void loadReadingPages(); void loadToc(); void loadMappings() } if (value === 'advanced' && canDebug) { void loadReadingPages(); void loadToc(); void loadMappings(); chunkQuery.page = 1; void loadChunks() } }">
      <t-tab-panel value="publishing" label="版本与发布">
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
          <t-alert
            v-if="publishReadiness.blockers.length > 0 || publishReadiness.warnings.length > 0"
            :theme="publishReadiness.blockers.length > 0 ? 'error' : 'warning'"
            :message="[...publishReadiness.blockers.map(item => `发布阻断：${item}`), ...publishReadiness.warnings.map(item => `发布提示：${item}`)].join('；')"
          />
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
                <template #icon>
                  <CloudUploadIcon />
                </template>
                新建版本
              </t-button>
            </template>
            <template #operations="{ row }">
              <AppTableActions :actions="getVersionActions(row)" />
            </template>
          </AppDataTable>
          <KnowledgeAssetPanel
            :assets="assets"
            :editable="canUpload && selectedVersion()?.status === 'DRAFT'"
            :loading="assetLoading"
            :parse-status="selectedVersion()?.parseStatus ?? 'PENDING'"
            :usage-mode="selectedVersion()?.usageMode ?? 'AI_ENABLED'"
            @usage-mode-change="changeUsageMode"
            @preview="(asset) => { originalPreviewFile = { id: asset.fileId, originalName: asset.fileName, mimeType: asset.mimeType }; previewPageNumber = null; previewVisible = true }"
            @replace="(role) => { uploadRole = role; const version = selectedVersion(); if (version) openUploadDialog(version) }"
          />
        </t-space>
      </t-tab-panel>

      <t-tab-panel value="proofing" label="内容校对">
        <t-tabs v-model="proofingTab" class="knowledge-proofing-tabs">
          <t-tab-panel value="toc" label="目录校对">
            <t-loading :loading="tocLoading">
              <div class="vicp-toc-layout">
            <KnowledgeTocEditor
              :editable="canEditChunk && selectedVersion()?.status === 'DRAFT'"
              :items="tocItems"
              :saving="tocSaving"
              :selected-id="tocSelectedId"
              @add="addToc"
              @delete="deleteToc"
              @save="saveToc"
              @select="(item) => { tocSelectedId = item.id; if (item.physicalPageNumber != null) { goToPhysicalPage(item.physicalPageNumber); openOriginalPage(item.physicalPageNumber) } }"
            />
            <section class="vicp-toc-preview">
              <div class="vicp-toc-preview__title">对应原始页面</div>
              <template v-if="tocSelectedPage != null && readingPages.find(page => page.physicalPageNumber === tocSelectedPage)">
                <t-alert theme="info" message="正式原文以 ORIGINAL PDF 页面为准；下方仅展示同页机器提取内容用于核对。" />
                <div class="vicp-toc-preview__meta">图集页码：{{ tocSelected?.pageLabel || '—' }} · PDF 物理页：{{ tocSelectedPage }}</div>
                <KnowledgePageView
                  :full-text="readingPages.find(page => page.physicalPageNumber === tocSelectedPage)?.extractedText ?? readingPages.find(page => page.physicalPageNumber === tocSelectedPage)?.parsedText ?? ''"
                  :page-number="tocSelectedPage"
                />
                <t-button theme="primary" variant="outline" @click="openOriginalPage(tocSelectedPage)">打开正式原页</t-button>
              </template>
              <AppEmptyState v-else title="选择目录项" description="选择左侧目录项后，在此核对正式原 PDF 页面" size="small" />
            </section>
          </div>
        </t-loading>
      </t-tab-panel>

      <t-tab-panel value="reading" label="原始页面">
        <div class="vicp-reading">
          <aside class="vicp-reading__outline">
            <div class="vicp-reading__outline-head">
              <strong>目录章节</strong>
              <t-input
                v-model="outlineKeyword"
                clearable
                placeholder="筛选章节"
                size="small"
              />
              <span v-if="usingSectionTree" class="vicp-reading__outline-source">已按解析章节树展示</span>
              <span v-else class="vicp-reading__outline-source">按页面所在章节聚合</span>
            </div>
            <t-loading :loading="readingLoading" text="正在加载页面内容...">
              <div v-if="readingError" class="vicp-reading__outline-state">
                <t-alert theme="error" :message="normalizeFeedbackError(readingError).message" />
                <t-button size="small" theme="primary" variant="outline" @click="() => void loadReadingPages()">
                  重试
                </t-button>
              </div>
              <ul v-else-if="readingOutline.length > 0" class="vicp-reading__outline-list">
                <li
                  v-for="node in readingOutline"
                  :key="node.key"
                  class="vicp-reading__outline-item"
                  :class="{ 'is-current': currentPage && node.pageNumbers.includes(currentPage.pageNumber) }"
                  :style="{ paddingLeft: `${12 + node.depth * 14}px` }"
                  role="button"
                  :tabindex="node.pageNumbers.length > 0 ? 0 : -1"
                  :aria-disabled="node.pageNumbers.length === 0"
                  @click="selectOutline(node)"
                  @keydown.enter="selectOutline(node)"
                >
                  <span class="vicp-reading__outline-title">{{ node.label }}</span>
                  <span class="vicp-reading__outline-pages">{{ node.pageNumbers.length > 0 ? `P${node.pageNumbers[0]}${node.pageNumbers.length > 1 ? `-${node.pageNumbers[node.pageNumbers.length - 1]}` : ''}` : '—' }}</span>
                </li>
              </ul>
              <div v-else-if="!readingLoading" class="vicp-reading__outline-state">
                <AppEmptyState
                  description="该版本还没有识别内容，请先上传文件并识别"
                  size="small"
                  title="暂无章节目录"
                />
              </div>
            </t-loading>
          </aside>

          <section class="vicp-reading__body">
            <div class="vicp-reading__toolbar">
              <t-select v-model="selectedVersionId" :options="versionOptions" placeholder="选择版本" style="width: 220px" @change="(value: unknown) => selectVersion(String(value))" />
              <t-tag v-if="selectedVersion()" variant="light" theme="primary">
                {{ knowledgeVersionStatusMetaFor(selectedVersion()!.status).label }}
              </t-tag>
              <t-tag v-if="readingTotal != null && readingTotal > 0" variant="outline">
                已解析 {{ readingPages.length }}/{{ readingTotal }} 页
              </t-tag>
              <t-button
                v-if="currentPage && originalPreviewFile"
                size="small"
                theme="primary"
                variant="outline"
                @click="openOriginalPage(currentPage.physicalPageNumber)"
              >
                查看正式原页
              </t-button>
              <t-input-number
                v-if="readingPages.length > 0"
                class="vicp-reading__page-jump"
                :max="readingPages[readingPages.length - 1]?.pageNumber ?? 1"
                :min="readingPages[0]?.pageNumber ?? 1"
                size="small"
                :value="currentPageNumber ?? undefined"
                theme="normal"
                @change="(value: unknown) => typeof value === 'number' && goToPage(value)"
              />
              <span class="vicp-reading__section">{{ currentPage?.sectionPath || '' }}</span>
            </div>

            <template v-if="currentPage">
              <t-alert theme="info" message="机器提取内容仅用于 AI 检索与校对；正式排版请使用「查看正式原页」。" />
              <KnowledgePageView
                :full-text="currentPage.extractedText ?? currentPage.parsedText ?? ''"
                :page-number="currentPage.physicalPageNumber"
              />
              <div class="vicp-reading__pager">
                <t-button size="small" variant="outline" :disabled="!hasPrevPage" @click="stepPage(-1)">
                  上一页
                </t-button>
                <span class="vicp-reading__pager-label">{{ currentPage.pageLabel ? `图集页码 ${currentPage.pageLabel} · ` : '' }}PDF 物理页 {{ currentPage.physicalPageNumber }}</span>
                <t-button size="small" variant="outline" :disabled="!hasNextPage" @click="stepPage(1)">
                  下一页
                </t-button>
              </div>
            </template>
            <AppEmptyState
              v-else-if="!readingLoading"
              description="选择左侧章节或页码查看完整页面内容"
              size="small"
              title="暂无页面内容"
            />
          </section>
        </div>
          </t-tab-panel>
        </t-tabs>
      </t-tab-panel>

      <t-tab-panel v-if="canDebug" value="advanced" label="高级设置">
        <t-tabs v-model="advancedTab" class="knowledge-advanced-tabs">
      <t-tab-panel value="machine" label="机器解析">
        <AppDataTable
          :columns="[
            { colKey: 'pageLabel', title: '页面', minWidth: 100 },
            { colKey: 'pageTitle', title: '页面标题', minWidth: 220 },
            { colKey: 'parsedText', title: '解析摘要', minWidth: 360 },
            { colKey: 'actions', title: '操作', minWidth: 100 },
          ]"
          :data="readingPages"
          description="机器提取内容仅用于 AI 检索，不代表原 PDF 排版。页面归属和内容块关系用于解析质量核对。"
          empty-description="请先上传并完成识别"
          empty-title="暂无机器解析内容"
          :status="readingLoading ? 'loading' : 'ready'"
          row-key="id"
        >
          <template #pageLabel="{ row }">{{ row.pageLabel || row.physicalPageNumber }}</template>
          <template #pageTitle="{ row }">{{ row.pageTitle || '—' }}</template>
          <template #parsedText="{ row }">{{ row.extractedText || row.parsedText || '无文本层' }}</template>
          <template #actions="{ row }"><t-button size="small" variant="text" theme="primary" @click="openMachinePage(row)">查看机器提取</t-button></template>
        </AppDataTable>
      </t-tab-panel>

      <t-tab-panel value="mapping" label="页面映射">
        <KnowledgePageMappingTable :editable="selectedVersion()?.status === 'DRAFT'" :loading="mappingLoading" :mappings="mappings" :pages="readingPages.map(page => ({ id: page.id, physicalPageNumber: page.physicalPageNumber, pageLabel: page.pageLabel }))" @auto-match="autoMatchMappings" @batch-confirm="batchConfirmMappings" @verify="verifyMapping" />
      </t-tab-panel>

      <t-tab-panel value="chunks" label="AI 检索调试（高级）">
        <AppDataTable
          :columns="chunkColumns"
          :data="chunks"
          description="辅助检索切片，仅供解析质量排查与调参使用；日常运营无需维护切片，内容以「目录与原文」为准"
          empty-description="该版本还没有生成辅助检索切片"
          empty-title="暂无切片"
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
              <t-select v-model="selectedVersionId" :options="versionOptions" placeholder="选择版本" style="width: 220px" @change="(value: unknown) => selectVersion(String(value))" />
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

      <t-tab-panel value="citation" label="AI 引用测试">
        <div class="vicp-citation">
          <div class="vicp-citation__bar">
            <t-input
              v-model="citationQuery"
              clearable
              maxlength="500"
              placeholder="输入测试问题，检查 AI 能否引用本文档（如：门窗洞口怎么处理？）"
              @enter="runCitationSearch"
            />
            <t-button theme="primary" :loading="citationSearching" @click="runCitationSearch">
              检索
            </t-button>
          </div>
          <t-alert v-if="citationError" theme="error" :message="citationError" style="margin-top: 12px" />
          <template v-if="citationSearched">
            <p class="vicp-citation__summary">
              全库检索耗时 {{ citationTook }}ms，其中命中本文档 {{ citationHits.length }} 条：
            </p>
            <div v-if="citationSources.length > 0" class="vicp-citation__list">
              <KnowledgeHitCard
                v-for="(item, index) in citationSources"
                :key="`${index}-${item.source.chunkId ?? item.source.pageId ?? item.source.title}`"
                :debug="item.debug"
                :debug-enabled="canDebug"
                :index="index + 1"
                :source="item.source"
              />
            </div>
            <AppEmptyState
              v-else
              description="本次检索命中了其他资料；可调整问题表述，或检查该文档是否已发布"
              size="small"
              title="未命中本文档"
            />
          </template>
          <AppEmptyState
            v-else
            description="输入问题后按全库真实检索执行，结果按文档 → 章节 → 页面 → 内容块路径展示"
            size="small"
            title="输入测试问题开始验证"
          />
        </div>
      </t-tab-panel>
        </t-tabs>
      </t-tab-panel>
    </t-tabs>

    <AppFilePreview
      :file="originalPreviewFile"
      :page-number="previewPageNumber"
      :visible="previewVisible"
      @close="previewVisible = false"
      @download="openDownloadedFile"
    />

    <t-drawer v-model:visible="machineVisible" header="机器解析内容" size="min(720px, 94vw)" :footer="false">
      <template v-if="machinePage">
        <t-alert theme="info" message="仅用于 AI 检索，不代表原 PDF 排版。" />
        <div class="vicp-machine-meta">图集页码：{{ machinePage.pageLabel || '—' }} · PDF 物理页：{{ machinePage.physicalPageNumber }}</div>
        <div v-for="block in machinePage.blocks ?? []" :key="block.id" class="vicp-machine-block">
          <div class="vicp-machine-block__meta">Block {{ block.blockIndex + 1 }} · {{ chunkTypeLabel[block.contentType] ?? block.contentType }} · Section：{{ block.sectionTitle || block.sectionId || '未关联' }}</div>
          <div>{{ block.content }}</div>
        </div>
        <pre v-if="(machinePage.blocks ?? []).length === 0" class="vicp-preview-body">{{ machinePage.extractedText || machinePage.parsedText || '无文本层' }}</pre>
      </template>
    </t-drawer>

    <!-- 文件上传 -->
    <t-dialog v-model:visible="uploadVisible" :header="uploadRole === 'SEARCH_SOURCE' ? '上传检索文件' : '上传正式原文件'" :confirm-btn="{ content: '上传', theme: 'primary', loading: uploading }" :on-confirm="submitUpload" :on-cancel="() => (uploadVisible = false)">
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

    <!-- 片段内容预览 -->
    <t-dialog v-model:visible="chunkPreviewVisible" header="内容与标注" :footer="false" width="min(680px, 92vw)" :on-close="() => (chunkPreviewVisible = false)">
      <template v-if="chunkPreviewTarget">
        <div class="vicp-preview-meta">
          #{{ chunkPreviewTarget.chunkIndex + 1 }} · {{ chunkTypeLabel[chunkPreviewTarget.contentType] ?? chunkPreviewTarget.contentType }}
          <template v-if="chunkPreviewTarget.sourcePage != null">
            · 第 {{ chunkPreviewTarget.sourcePage }} 页
          </template>
          <template v-if="chunkPreviewTarget.sourceSection">
            · {{ chunkPreviewTarget.sourceSection }}
          </template>
        </div>
        <div class="vicp-preview-body">
          {{ chunkPreviewTarget.content }}
        </div>
        <div
          v-if="chunkPreviewTarget.keywords?.length || chunkPreviewTarget.aliasTerms?.length || chunkPreviewTarget.citationAnchor || chunkPreviewTarget.invalid"
          class="vicp-preview-meta-list"
        >
          <div v-if="chunkPreviewTarget.keywords?.length" class="vicp-preview-meta-item">
            <span>关键词</span>{{ chunkPreviewTarget.keywords.join('、') }}
          </div>
          <div v-if="chunkPreviewTarget.aliasTerms?.length" class="vicp-preview-meta-item">
            <span>别名</span>{{ chunkPreviewTarget.aliasTerms.join('、') }}
          </div>
          <div v-if="chunkPreviewTarget.citationAnchor" class="vicp-preview-meta-item">
            <span>引用位置</span>{{ chunkPreviewTarget.citationAnchor }}
          </div>
          <div v-if="chunkPreviewTarget.invalid" class="vicp-preview-meta-item is-invalid">
            <span>无效标记</span>{{ chunkPreviewTarget.invalidReason ?? '未填写原因' }}
          </div>
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

/* 阅读视图：左目录 + 右完整页面 */
.vicp-reading {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
  padding-top: 16px;
}
.vicp-reading__outline {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-secondarycontainer);
  max-height: 72vh;
}
.vicp-reading__outline-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vicp-reading__outline-head strong {
  font-size: var(--td-font-size-body-medium);
}
.vicp-reading__outline-source {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}
.vicp-reading__outline-list {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.vicp-reading__outline-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--td-radius-small);
  cursor: pointer;
}
.vicp-reading__outline-item:hover {
  background: var(--td-bg-color-container-hover);
}
.vicp-reading__outline-item.is-current {
  background: var(--td-brand-color-1);
}
.vicp-reading__outline-title {
  min-width: 0;
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vicp-reading__outline-pages {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}
.vicp-reading__outline-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
}
.vicp-reading__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
  max-height: 72vh;
  overflow: auto;
}
.vicp-reading__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vicp-reading__page-jump {
  width: 96px;
}
.vicp-reading__section {
  min-width: 0;
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vicp-reading__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--td-component-stroke);
}
.vicp-reading__pager-label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

/* 引用测试 */
.vicp-citation {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
}
.vicp-citation__bar {
  display: flex;
  gap: 8px;
}
.vicp-citation__bar :deep(.t-input) {
  flex: 1;
}
.vicp-citation__summary {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-citation__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

@media (max-width: 960px) {
  .vicp-reading {
    grid-template-columns: 1fr;
  }
  .vicp-reading__outline {
    max-height: 40vh;
  }
}
</style>
