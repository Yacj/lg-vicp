<script setup lang="ts">
import type { KnowledgeHeaderAction } from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import type {
  KnowledgeCategory,
  KnowledgeChapterTreeNode,
  KnowledgeDocument,
  KnowledgeDocumentVersion,
  KnowledgePage,
  KnowledgeSelectedFile,
} from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  approveKnowledgeVersion,
  bindKnowledgeSearchSource,
  deleteKnowledgeDocument,
  disableKnowledgeVersion,
  fetchKnowledgeCategories,
  fetchKnowledgeDocumentDetail,
  fetchVersionChapterTree,
  fetchVersionExtractedText,
  fetchVersionPageWindow,
  fetchVersionPages,
  publishKnowledgeVersion,
  restartKnowledgeParse,
  updateVersionUsageMode,
} from '@/api/modules/knowledge'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import KnowledgeAdvancedDrawer from '@/components/business/knowledge/KnowledgeAdvancedDrawer.vue'
import KnowledgeChapterTree from '@/components/business/knowledge/KnowledgeChapterTree.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import KnowledgeFailurePanel from '@/components/business/knowledge/KnowledgeFailurePanel.vue'
import KnowledgeLifecycleBar from '@/components/business/knowledge/KnowledgeLifecycleBar.vue'
import KnowledgeOverviewPanel from '@/components/business/knowledge/KnowledgeOverviewPanel.vue'
import KnowledgePageGallery from '@/components/business/knowledge/KnowledgePageGallery.vue'
import KnowledgeParsedContent from '@/components/business/knowledge/KnowledgeParsedContent.vue'
import KnowledgeParseStatus from '@/components/business/knowledge/KnowledgeParseStatus.vue'
import KnowledgeRecognitionReview from '@/components/business/knowledge/KnowledgeRecognitionReview.vue'
import KnowledgeReplaceFileDrawer from '@/components/business/knowledge/KnowledgeReplaceFileDrawer.vue'
import KnowledgeSearchablePanel from '@/components/business/knowledge/KnowledgeSearchablePanel.vue'
import KnowledgeStructuredDataPanel from '@/components/business/knowledge/KnowledgeStructuredDataPanel.vue'
import KnowledgeTestPanel from '@/components/business/knowledge/KnowledgeTestPanel.vue'
import KnowledgeVersionDrawer from '@/components/business/knowledge/KnowledgeVersionDrawer.vue'
import KnowledgeWorkspaceHeader from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useKnowledgeLifecycle } from '@/composables/useKnowledgeLifecycle'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError, businessUserMessage } from '@/utils/business-error'
import { isKnowledgeFileParsingInProgress, isKnowledgePageDrivenWorkspace, isKnowledgePageRenderingInProgress, isKnowledgeParsingStatus, isKnowledgeReadyStatus } from '@/utils/knowledge-user'

const route = useRoute()
const router = useRouter()
const documentId = computed(() => String(route.params.id))
const { canAccess } = usePermissionAccess()

const canEdit = computed(() => canAccess({ permissions: ['system:knowledge:doc:edit'] }))
const canUpload = computed(() => canAccess({ permissions: ['system:knowledge:doc:upload'] }))
const canParse = computed(() => canAccess({ permissions: ['system:knowledge:doc:parse'] }))
const canTest = computed(() => canAccess({ permissions: ['system:knowledge:doc:test'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:knowledge:doc:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:knowledge:doc:publish'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:doc:remove'] }))
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))
const canUploadPages = computed(() => canAccess({ permissions: ['system:knowledge:page:upload'] }) && versionEditable.value)
const canHandleRecognition = computed(() => canAccess({ permissions: ['system:knowledge:page:review', 'system:knowledge:page:confirm', 'system:knowledge:page:recognize'] }) && versionEditable.value)

const documentMeta = ref<KnowledgeDocument | null>(null)
const versions = ref<KnowledgeDocumentVersion[]>([])
const categories = ref<KnowledgeCategory[]>([])
const chapters = ref<KnowledgeChapterTreeNode[]>([])
const readingPages = ref<KnowledgePage[]>([])
const selectedChapterId = ref<string | null>(null)
const currentPage = ref<KnowledgePage | null>(null)
const readingLoading = ref(false)
const previewVisible = ref(false)
const previewPage = ref<number | null>(null)
const versionVisible = ref(false)
const advancedVisible = ref(false)
const editVisible = ref(false)
const replaceVisible = ref(false)
const publishVisible = ref(false)
const activeTab = ref<string>('overview')
const activeSection = computed(() => {
  if (activeTab.value === 'gallery' || activeTab.value === 'recognition') return 'processing'
  if (activeTab.value === 'content' || activeTab.value === 'structured') return 'reading'
  return activeTab.value
})
const focusPhysicalPageNumber = ref<number | null>(null)
const galleryKey = ref(0)
/** 上一次 workspace 的页面数：变化时重挂图库，确保页序调整后重新拉取。 */
const previousPageCount = ref(0)
const previousChapterVersionId = ref<string | null>(null)

/**
 * 页面级唯一生命周期轮询：workspace / 知识索引 / 识别汇总三处共用一个 3s 定时器。
 * 图库与识别校验面板通过 pollTick 复用同一节拍，不再各自起 setInterval。
 */
const {
  workspace,
  index,
  recognitionSummary,
  versionId,
  loading,
  error,
  refresh,
  pollTick,
  isPolling,
} = useKnowledgeLifecycle({
  documentId,
  onWorkspace: async (next) => {
    const pageCountChanged = next.summary.pageCount !== previousPageCount.value
    if (pageCountChanged) {
      previousPageCount.value = next.summary.pageCount
      galleryKey.value += 1
    }
    if (isKnowledgeReadyStatus(next.currentVersion?.userStatus) && next.currentVersion?.id
      && (previousChapterVersionId.value !== next.currentVersion.id || pageCountChanged)) {
      previousChapterVersionId.value = next.currentVersion.id
      await loadChapters(next.currentVersion.id)
    }
  },
})

const userStatus = computed(() => workspace.value?.currentVersion?.userStatus ?? 'PENDING_PARSE')
/** 后端版本守卫：仅 DRAFT 可编辑，已进入审核/发布流程的版本一律只读。 */
const versionEditable = computed(() => workspace.value?.currentVersion?.status === 'DRAFT')
const hasPages = computed(() => (workspace.value?.summary.pageCount ?? 0) > 0)
const publishBlockers = computed(() => (workspace.value?.summary.publishBlockers ?? []).map(businessUserMessage))
const pageRendering = computed(() => isKnowledgePageRenderingInProgress(workspace.value))
const categoryName = computed(() => {
  const id = workspace.value?.document.categoryId ?? documentMeta.value?.categoryId
  return categories.value.find(item => item.id === id)?.name ?? ''
})
const selectedChapter = computed(() => findChapter(chapters.value, selectedChapterId.value))
const currentReadingPage = computed(() => readingPages.value.find(page => page.physicalPageNumber === currentPage.value?.physicalPageNumber))
const currentPageUnconfirmed = computed(() => currentReadingPage.value?.recognitionStatus != null && currentReadingPage.value.recognitionStatus !== 'CONFIRMED')
const previewFile = computed(() => {
  const file = workspace.value?.primaryFile
  if (!file) {
    return null
  }
  return { id: file.id, originalName: file.name, mimeType: file.mimeType || 'application/pdf' }
})
const moreActions = computed<KnowledgeHeaderAction[]>(() => {
  const actions: KnowledgeHeaderAction[] = []
  if (canEdit.value) {
    actions.push({ key: 'edit', label: '编辑基本信息' })
  }
  if (canUpload.value && workspace.value?.actions.canReplaceFile) {
    actions.push({ key: 'replace', label: '更换文件' })
  }
  if (canParse.value && workspace.value?.actions.canRetry) {
    actions.push({ key: 'reparse', label: '重新解析' })
  }
  actions.push({ key: 'versions', label: '历史版本' })
  if (canApprove.value || canPublish.value) {
    actions.push({ key: 'publish', label: '发布设置' })
  }
  if (canDebug.value) {
    actions.push({ key: 'advanced', label: '校正章节和页码' })
  }
  if (canRemove.value) {
    actions.push({ key: 'delete', label: '删除知识库', theme: 'error' })
  }
  return actions
})
/** 页图流程始终保留图库与识别校验入口，包括待识别、识别失败及空知识库。 */
const isPageDriven = computed(() => isKnowledgePageDrivenWorkspace(workspace.value))
const isFileParsing = computed(() => isKnowledgeFileParsingInProgress(workspace.value))
const showWorkspaceTabs = computed(() => Boolean(workspace.value) && (
  isKnowledgeReadyStatus(userStatus.value)
  || isPageDriven.value
  || (userStatus.value !== 'PARSE_FAILED'
    && userStatus.value !== 'SEARCHABLE_FILE_REQUIRED'
    && !isKnowledgeParsingStatus(userStatus.value))
))

function findChapter(items: KnowledgeChapterTreeNode[], id: string | null): KnowledgeChapterTreeNode | null {
  if (!id) {
    return null
  }
  for (const item of items) {
    if (item.id === id) {
      return item
    }
    const child = findChapter(item.children ?? [], id)
    if (child) {
      return child
    }
  }
  return null
}

async function loadChapters(id: string): Promise<void> {
  try {
    const [tree, firstPage] = await Promise.all([fetchVersionChapterTree(id), fetchVersionPages(id, 1, 100)])
    const pages = [...firstPage.items]
    for (let page = 2; page <= Math.ceil(firstPage.total / 100); page += 1) {
      pages.push(...(await fetchVersionPages(id, page, 100)).items)
    }
    if (versionId.value !== id) return
    readingPages.value = pages.sort((a, b) => a.physicalPageNumber - b.physicalPageNumber)
    chapters.value = tree.items
    const first = chapters.value[0]
    if (first) {
      selectedChapterId.value = first.id
      await openChapter(first)
    }
    else {
      selectedChapterId.value = null
      if (hasPages.value) {
        await openPage(readingPages.value[0]?.physicalPageNumber ?? 1)
      }
      else {
        await loadExtractedText()
      }
    }
  }
  catch {
    chapters.value = []
    readingPages.value = []
  }
}

async function openChapter(node: KnowledgeChapterTreeNode): Promise<void> {
  selectedChapterId.value = node.id
  if (!hasPages.value) {
    await loadExtractedText()
    return
  }
  await openPage(node.physicalPageNumber ?? readingPages.value[0]?.physicalPageNumber ?? 1)
}

async function loadExtractedText(): Promise<void> {
  if (!versionId.value) {
    return
  }
  readingLoading.value = true
  try {
    const result = await fetchVersionExtractedText(versionId.value)
    currentPage.value = {
      id: `extracted-${versionId.value}`,
      documentId: documentId.value,
      versionId: versionId.value,
      pageNumber: 0,
      physicalPageNumber: 0,
      pageLabel: '机器提取文本',
      pageTitle: '机器提取文本（非页面视觉）',
      parsedText: result.text,
      extractedText: result.text,
      pageImageObjectKey: null,
      pageImageUrl: null,
      sectionPath: null,
      blocks: result.blocks,
      hasTables: result.blocks.some(block => block.contentType === 'TABLE'),
      hasImages: false,
      parseStatus: 'PARSED',
      createdAt: new Date().toISOString(),
    }
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    readingLoading.value = false
  }
}

async function openPage(physicalPageNumber: number): Promise<void> {
  if (!versionId.value) {
    return
  }
  readingLoading.value = true
  currentPage.value = null
  try {
    const result = await fetchVersionPageWindow(versionId.value, physicalPageNumber, 1, 1)
    currentPage.value = {
      id: result.page.id,
      documentId: documentId.value,
      versionId: versionId.value,
      pageNumber: result.page.pageNumber,
      physicalPageNumber: result.page.physicalPageNumber,
      pageLabel: result.page.pageLabel,
      pageTitle: result.page.pageTitle,
      parsedText: result.page.fullText,
      extractedText: result.page.extractedText,
      pageImageObjectKey: null,
      pageImageUrl: result.page.pageImageUrl,
      sectionPath: null,
      blocks: result.page.blocks,
      hasTables: result.page.blocks.some(block => block.contentType === 'TABLE'),
      hasImages: false,
      parseStatus: 'PARSED',
      createdAt: new Date().toISOString(),
    }
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    readingLoading.value = false
  }
}

function openReadingPage(physicalPageNumber: number): void {
  selectedChapterId.value = null
  void openPage(physicalPageNumber)
}

async function loadVersions(): Promise<void> {
  try {
    const detail = await fetchKnowledgeDocumentDetail(documentId.value)
    documentMeta.value = detail.document
    versions.value = detail.versions
  }
  catch {
    versions.value = []
  }
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = (await fetchKnowledgeCategories()).items
  }
  catch {
    categories.value = []
  }
}

const deleteAction = useConfirmedCrudAction<void, unknown>({
  action: async () => {
    await deleteKnowledgeDocument(documentId.value)
  },
  confirm: () => ({ title: '删除知识库', content: `确定删除「${workspace.value?.document.title ?? ''}」？`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => {
    void router.push({ path: '/knowledge/documents' })
  },
})

function onMore(key: string): void {
  if (key === 'edit') {
    editVisible.value = true
  }
  if (key === 'replace') {
    replaceVisible.value = true
  }
  if (key === 'versions') {
    void loadVersions()
    versionVisible.value = true
  }
  if (key === 'advanced') {
    advancedVisible.value = true
  }
  if (key === 'publish') {
    publishVisible.value = true
  }
  if (key === 'reparse') {
    void reparse()
  }
  if (key === 'delete') {
    void deleteAction.run()
  }
}

async function reparse(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await restartKnowledgeParse(versionId.value)
    MessagePlugin.success('已开始重新解析')
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

async function bindSearchable(file: KnowledgeSelectedFile): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await bindKnowledgeSearchSource(versionId.value, file.fileId)
    MessagePlugin.success('已补充可搜索文字版本，正在重新解析')
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

async function browseOnly(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await updateVersionUsageMode(versionId.value, 'BROWSE_ONLY')
    MessagePlugin.success('已设为只查看原文件')
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

function openOriginal(pageNumber?: number | null): void {
  previewPage.value = pageNumber ?? null
  previewVisible.value = true
}

function openGalleryPage(physicalPageNumber: number | null | undefined, pageId?: string | null): void {
  activeTab.value = 'gallery'
  if (physicalPageNumber != null) {
    focusPhysicalPageNumber.value = null
    requestAnimationFrame(() => {
      focusPhysicalPageNumber.value = physicalPageNumber
    })
    return
  }
  if (pageId) {
    MessagePlugin.info('已打开资料页面，请按页码查找引用来源。')
  }
}

function openRecognitionPage(physicalPageNumber: number): void {
  activeTab.value = 'recognition'
  focusPhysicalPageNumber.value = null
  requestAnimationFrame(() => {
    focusPhysicalPageNumber.value = physicalPageNumber
  })
}

function onTabChange(value: string | number | boolean): void {
  activeTab.value = String(value)
  if (activeTab.value === 'content' && versionId.value) {
    void loadChapters(versionId.value)
  }
}
function onSectionChange(value: string | number): void {
  const section = String(value)
  onTabChange(section === 'processing' ? 'gallery' : section === 'reading' ? 'content' : section)
}

async function approve(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await approveKnowledgeVersion(versionId.value)
    MessagePlugin.success('已审核通过')
    publishVisible.value = false
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

async function publish(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await publishKnowledgeVersion(versionId.value)
    MessagePlugin.success('已发布，可以用于提问')
    publishVisible.value = false
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

async function disable(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await disableKnowledgeVersion(versionId.value)
    MessagePlugin.success('已停用')
    publishVisible.value = false
    await refresh()
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
}

watch(documentId, () => {
  activeTab.value = 'overview'
  focusPhysicalPageNumber.value = null
  previousPageCount.value = 0
  previousChapterVersionId.value = null
  readingPages.value = []
  chapters.value = []
  currentPage.value = null
  void loadVersions()
})

onMounted(() => {
  void loadCategories()
  void loadVersions()
})
</script>

<template>
  <AppPage>
    <template #header>
      <KnowledgeWorkspaceHeader
        :can-preview="Boolean(previewFile)"
        :can-test="Boolean(canTest && versionId && isKnowledgeReadyStatus(userStatus))"
        :category-name="categoryName"
        :doc-type="workspace?.document.docType"
        :more-actions="moreActions"
        :title="workspace?.document.title || documentMeta?.title || '知识库'"
        :user-status="userStatus"
        @back="router.push({ path: '/knowledge/documents' })"
        @more="onMore"
        @preview="openOriginal(null)"
        @test="activeTab = 'test'"
      />
    </template>

    <AppErrorState
      v-if="error && !workspace"
      :description="businessUserError(error)"
      @action="refresh"
    />

    <div v-else-if="loading && !workspace" class="knowledge-workspace">
      <t-loading loading text="正在加载知识库" />
    </div>

    <div v-else class="knowledge-workspace">
      <KnowledgeParseStatus
        v-if="isFileParsing"
        :file="workspace?.primaryFile"
        :job="workspace?.parsing.lastJob"
        :progress="workspace?.parsing.lastJob?.progress"
        :stage="workspace?.parsing.lastJob?.stage"
      />

      <KnowledgeFailurePanel
        v-else-if="!isPageDriven && userStatus === 'PARSE_FAILED'"
        :can-debug="canDebug"
        :can-replace="canUpload && Boolean(workspace?.actions.canReplaceFile)"
        :can-retry="canParse && Boolean(workspace?.actions.canRetry)"
        :file="workspace?.primaryFile"
        :job="workspace?.parsing.lastJob"
        @replace="replaceVisible = true"
        @retry="reparse"
      />

      <KnowledgeSearchablePanel
        v-else-if="!isPageDriven && userStatus === 'SEARCHABLE_FILE_REQUIRED'"
        @bind="bindSearchable"
        @browse-only="browseOnly"
      />

      <template v-else-if="showWorkspaceTabs || isKnowledgeReadyStatus(userStatus)">
        <KnowledgeLifecycleBar
          v-if="['gallery', 'content', 'structured'].includes(activeTab)"
          :index="index"
          :recognition-summary="recognitionSummary"
          :workspace="workspace"
        />

        <t-tabs
          class="knowledge-workspace__tabs"
          :value="activeSection"
          @change="onSectionChange"
        >
          <t-tab-panel label="概览" value="overview">
            <KnowledgeOverviewPanel
              :can-rebuild-index="canParse"
              :can-test="canTest"
              :can-open-publish="canApprove || canPublish"
              :can-upload-pages="canUploadPages"
              :can-handle-recognition="canHandleRecognition"
              :index="index"
              :recognition-summary="recognitionSummary"
              :version-id="versionId"
              :version-status="workspace?.currentVersion?.status"
              :workspace="workspace"
              @navigate="onTabChange($event)"
              @publish="publishVisible = true"
              @refresh="refresh({ silent: true })"
            />
          </t-tab-panel>

          <t-tab-panel label="处理资料" value="processing">
            <div class="knowledge-workspace__subnav" aria-label="资料处理内容">
              <t-radio-group :value="activeTab" variant="default-filled" @change="onTabChange">
                <t-radio-button value="gallery">资料页面</t-radio-button>
                <t-radio-button value="recognition">核对识别结果</t-radio-button>
              </t-radio-group>
            </div>
            <KnowledgePageGallery
              v-if="activeTab === 'gallery'"
              :key="galleryKey"
              :version-id="versionId"
              :editable="canEdit"
              :version-editable="versionEditable"
              :focus-physical-page-number="focusPhysicalPageNumber"
              :rendering="pageRendering"
              :poll-tick="pollTick"
              :polling="isPolling"
              @changed="refresh({ silent: true })"
              @review-page="openRecognitionPage"
            />
            <KnowledgeRecognitionReview
              v-else
              :key="`recognition-${versionId}`"
              :document-id="documentId"
              :version-id="versionId"
              :version-editable="versionEditable"
              :focus-physical-page-number="focusPhysicalPageNumber"
              :poll-tick="pollTick"
              :polling="isPolling"
              @open-gallery-page="openGalleryPage"
              @refresh="refresh()"
            />
          </t-tab-panel>

          <t-tab-panel label="查看内容" value="reading">
            <div class="knowledge-workspace__subnav" aria-label="资料内容类型">
              <t-radio-group :value="activeTab" variant="default-filled" @change="onTabChange">
                <t-radio-button value="content">正文与目录</t-radio-button>
                <t-radio-button value="structured">热工信息</t-radio-button>
              </t-radio-group>
            </div>
            <KnowledgeStructuredDataPanel
              v-if="activeTab === 'structured'"
              :document-id="documentId"
              :version-id="versionId"
              @open-source-page="openGalleryPage($event.physicalPageNumber, $event.pageId)"
            />
            <div v-else class="knowledge-workspace__result">
              <KnowledgeChapterTree
                :items="chapters"
                :pages="readingPages"
                :loading="readingLoading && chapters.length === 0"
                :selected-id="selectedChapterId"
                :selected-physical-page-number="currentPage?.physicalPageNumber"
                @select="openChapter"
                @select-page="openReadingPage"
              />
              <KnowledgeParsedContent
                :can-preview="Boolean(previewFile) && hasPages"
                :loading="readingLoading"
                :machine-text="!hasPages || currentPage?.pageLabel === '机器提取文本'"
                :page="currentPage"
                :unconfirmed="currentPageUnconfirmed"
                :title="selectedChapter?.title"
                @preview-page="openOriginal(currentPage?.physicalPageNumber)"
                @open-gallery="openGalleryPage(currentPage?.physicalPageNumber)"
                @open-recognition="currentPage?.physicalPageNumber && openRecognitionPage(currentPage.physicalPageNumber)"
              />
            </div>
          </t-tab-panel>

          <t-tab-panel v-if="canTest" label="问答测试" value="test">
            <KnowledgeTestPanel
              :can-debug="canDebug"
              :version-id="versionId"
            />
          </t-tab-panel>
        </t-tabs>
      </template>

      <AppEmptyState
        v-else
        description="请上传知识文件并等待系统自动解析。"
        title="还没有解析结果"
      >
        <template #action>
          <t-button theme="primary" @click="replaceVisible = true">
            上传知识文件
          </t-button>
        </template>
      </AppEmptyState>
    </div>

    <AppFilePreview
      :file="previewFile"
      :page-number="previewPage"
      :visible="previewVisible"
      @close="previewVisible = false"
    />
    <KnowledgeVersionDrawer
      v-model:visible="versionVisible"
      :current-version-id="versionId"
      :versions="versions"
    />
    <KnowledgeAdvancedDrawer
      v-model:visible="advancedVisible"
      :editable="canEdit && workspace?.currentVersion?.status === 'DRAFT'"
      :version-id="versionId"
    />
    <KnowledgeCreateDrawer
      v-model:visible="editVisible"
      :document="documentMeta"
      mode="edit"
      @updated="refresh"
    />
    <KnowledgeReplaceFileDrawer
      v-model:visible="replaceVisible"
      :document-id="documentId"
      @replaced="refresh"
    />
    <t-dialog
      :footer="false"
      header="发布设置"
      :visible="publishVisible"
      @close="publishVisible = false"
      @update:visible="(value: boolean) => publishVisible = value"
    >
      <p class="knowledge-publish-hint">
        发布后，这份资料可用于问答。发布前请核对资料页面，并更新问答内容。
      </p>

      <t-alert
        v-if="!workspace?.summary.canPublish"
        class="knowledge-publish-blockers"
        theme="warning"
        title="暂时无法发布"
      >
        <template v-if="publishBlockers.length">
          <p class="knowledge-publish-blockers-title">
            还需要完成：
          </p>
          <ul class="knowledge-publish-blockers-list">
            <li v-for="(blocker, blockerIndex) in publishBlockers" :key="blockerIndex">
              {{ blocker }}
            </li>
          </ul>
        </template>
        <p v-else>
          请先核对资料页面并更新问答内容，再发布给提问使用。
        </p>
        <t-space class="knowledge-publish-actions">
          <t-button v-if="!hasPages" size="small" variant="outline" @click="publishVisible = false; activeTab = 'gallery'">前往上传页面</t-button>
          <t-button v-if="hasPages && (recognitionSummary?.reviewRequired || recognitionSummary?.failed)" size="small" variant="outline" @click="publishVisible = false; activeTab = 'recognition'">核对识别结果</t-button>
          <t-button v-if="index?.indexStatus !== 'INDEX_READY' || index?.indexDirty" size="small" variant="outline" @click="publishVisible = false; activeTab = 'overview'">查看问答内容状态</t-button>
        </t-space>
      </t-alert>

      <t-space>
        <t-button v-if="canApprove && workspace?.currentVersion?.status === 'DRAFT'" theme="primary" variant="outline" @click="approve">
          审核通过
        </t-button>
        <t-button
          v-if="canPublish"
          :disabled="!workspace?.summary.canPublish"
          :title="workspace?.summary.canPublish ? '发布后可用于提问' : '请先完成上方列出的发布条件'"
          theme="primary"
          @click="publish"
        >
          发布
        </t-button>
        <t-button v-if="canPublish && workspace?.currentVersion?.status === 'PUBLISHED'" theme="warning" variant="outline" @click="disable">
          停用
        </t-button>
        <t-button v-if="canEdit && versionEditable && workspace?.primaryFile" theme="default" variant="outline" @click="browseOnly">
          只查看原文件
        </t-button>
      </t-space>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.knowledge-workspace {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.knowledge-workspace__tabs {
  background: transparent;
}
.knowledge-workspace__tabs :deep(.t-tabs__operations) {
  background: var(--td-bg-color-page);
}
.knowledge-workspace__subnav {
  padding: var(--td-size-4) var(--td-size-4) 0;
  background: transparent;
}

.knowledge-workspace__result {
  display: flex;
  min-width: 0;
  min-height: 480px;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-publish-hint {
  margin: 0 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
}

.knowledge-publish-blockers {
  margin-bottom: var(--td-size-4);
}

.knowledge-publish-blockers-title {
  margin: 0 0 var(--td-size-2);
  font-weight: 600;
}

.knowledge-publish-blockers-list {
  margin: 0;
  padding-left: 18px;
}
</style>
