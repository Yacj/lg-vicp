<script setup lang="ts">
import type { KnowledgeHeaderAction } from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import type {
  KnowledgeCategory,
  KnowledgeChapterTreeNode,
  KnowledgeDocument,
  KnowledgeDocumentVersion,
  KnowledgePage,
  KnowledgeSelectedFile,
  KnowledgeWorkspace,
} from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  approveKnowledgeVersion,
  bindKnowledgeSearchSource,
  deleteKnowledgeDocument,
  disableKnowledgeVersion,
  fetchKnowledgeCategories,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeWorkspace,
  fetchVersionChapterTree,
  fetchVersionExtractedText,
  fetchVersionPageWindow,
  publishKnowledgeVersion,
  restartKnowledgeParse,
  updateVersionUsageMode,
} from '@/api/modules/knowledge'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import KnowledgeAdvancedDrawer from '@/components/business/knowledge/KnowledgeAdvancedDrawer.vue'
import KnowledgeChapterTree from '@/components/business/knowledge/KnowledgeChapterTree.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import KnowledgeFailurePanel from '@/components/business/knowledge/KnowledgeFailurePanel.vue'
import KnowledgeOverviewPanel from '@/components/business/knowledge/KnowledgeOverviewPanel.vue'
import KnowledgePageGallery from '@/components/business/knowledge/KnowledgePageGallery.vue'
import KnowledgePageStatusBar from '@/components/business/knowledge/KnowledgePageStatusBar.vue'
import KnowledgeParsedContent from '@/components/business/knowledge/KnowledgeParsedContent.vue'
import KnowledgeParseStatus from '@/components/business/knowledge/KnowledgeParseStatus.vue'
import KnowledgeReplaceFileDrawer from '@/components/business/knowledge/KnowledgeReplaceFileDrawer.vue'
import KnowledgeRecognitionReview from '@/components/business/knowledge/KnowledgeRecognitionReview.vue'
import KnowledgeSearchablePanel from '@/components/business/knowledge/KnowledgeSearchablePanel.vue'
import KnowledgeStructuredDataPanel from '@/components/business/knowledge/KnowledgeStructuredDataPanel.vue'
import KnowledgeTestPanel from '@/components/business/knowledge/KnowledgeTestPanel.vue'
import KnowledgeVersionDrawer from '@/components/business/knowledge/KnowledgeVersionDrawer.vue'
import KnowledgeWorkspaceHeader from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  isKnowledgePageRenderingInProgress,
  isKnowledgeParsingStatus,
  isKnowledgeReadyStatus,
  knowledgeUserMessage,
} from '@/utils/knowledge-user'

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

const workspace = ref<KnowledgeWorkspace | null>(null)
const documentMeta = ref<KnowledgeDocument | null>(null)
const versions = ref<KnowledgeDocumentVersion[]>([])
const categories = ref<KnowledgeCategory[]>([])
const chapters = ref<KnowledgeChapterTreeNode[]>([])
const selectedChapterId = ref<string | null>(null)
const currentPage = ref<KnowledgePage | null>(null)
const loading = ref(false)
const readingLoading = ref(false)
const error = ref<unknown>(null)
const previewVisible = ref(false)
const previewPage = ref<number | null>(null)
const versionVisible = ref(false)
const advancedVisible = ref(false)
const editVisible = ref(false)
const replaceVisible = ref(false)
const publishVisible = ref(false)
const activeTab = ref<string>('overview')
const focusPhysicalPageNumber = ref<number | null>(null)
const galleryKey = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null

const userStatus = computed(() => workspace.value?.currentVersion?.userStatus ?? 'PENDING_PARSE')
const versionId = computed(() => workspace.value?.currentVersion?.id ?? null)
/** 后端版本守卫：仅 DRAFT 可编辑，已进入审核/发布流程的版本一律只读。 */
const versionEditable = computed(() => workspace.value?.currentVersion?.status === 'DRAFT')
const hasPages = computed(() => (workspace.value?.summary.pageCount ?? 0) > 0)
const publishBlockers = computed(() => workspace.value?.summary.publishBlockers ?? [])
const pageRendering = computed(() => isKnowledgePageRenderingInProgress(workspace.value))
const categoryName = computed(() => {
  const id = workspace.value?.document.categoryId ?? documentMeta.value?.categoryId
  return categories.value.find(item => item.id === id)?.name ?? ''
})
const selectedChapter = computed(() => findChapter(chapters.value, selectedChapterId.value))
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
/** 无文件、无页面、无解析任务的空知识库：创建后即进入详情页引导上传资料页面。 */
const isEmptyKnowledgeBase = computed(() => Boolean(workspace.value)
  && !workspace.value?.primaryFile
  && (workspace.value?.summary.pageCount ?? 0) === 0
  && !workspace.value?.parsing.lastJob)
const showWorkspaceTabs = computed(() => Boolean(workspace.value) && (
  isKnowledgeReadyStatus(userStatus.value)
  || isEmptyKnowledgeBase.value
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

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPoll(): void {
  stopPoll()
  pollTimer = setInterval(() => {
    void loadWorkspace(false)
  }, 3000)
}

function syncPoll(next: KnowledgeWorkspace): void {
  if (isKnowledgeParsingStatus(next.currentVersion?.userStatus) || isKnowledgePageRenderingInProgress(next)) {
    startPoll()
  }
  else {
    stopPoll()
  }
}

async function loadWorkspace(showLoading = true): Promise<void> {
  if (showLoading) {
    loading.value = true
  }
  error.value = null
  try {
    const previousPageCount = workspace.value?.summary.pageCount ?? 0
    workspace.value = await fetchKnowledgeWorkspace(documentId.value)
    syncPoll(workspace.value)
    if (workspace.value.summary.pageCount !== previousPageCount) {
      galleryKey.value += 1
    }
    if (isKnowledgeReadyStatus(workspace.value.currentVersion?.userStatus) && workspace.value.currentVersion?.id) {
      await loadChapters(workspace.value.currentVersion.id)
    }
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    loading.value = false
  }
}

async function loadChapters(id: string): Promise<void> {
  try {
    chapters.value = (await fetchVersionChapterTree(id)).items
    const first = chapters.value[0]
    if (first) {
      selectedChapterId.value = first.id
      await openChapter(first)
    }
    else {
      selectedChapterId.value = null
      if (hasPages.value) {
        await openPage(1)
      }
      else {
        await loadExtractedText()
      }
    }
  }
  catch {
    chapters.value = []
  }
}

async function openChapter(node: KnowledgeChapterTreeNode): Promise<void> {
  selectedChapterId.value = node.id
  if (!hasPages.value) {
    await loadExtractedText()
    return
  }
  await openPage(node.physicalPageNumber ?? 1)
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
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
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
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
  finally {
    readingLoading.value = false
  }
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
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
}

async function bindSearchable(file: KnowledgeSelectedFile): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await bindKnowledgeSearchSource(versionId.value, file.fileId)
    MessagePlugin.success('已补充可搜索文字版本，正在重新解析')
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
}

async function browseOnly(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await updateVersionUsageMode(versionId.value, 'BROWSE_ONLY')
    MessagePlugin.success('已设为只查看原文件')
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
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
    MessagePlugin.info('已切换到页面图库，请按页面卡片定位来源页')
  }
}

function openRecognitionPage(physicalPageNumber: number): void {
  activeTab.value = 'recognition'
  focusPhysicalPageNumber.value = null
  requestAnimationFrame(() => { focusPhysicalPageNumber.value = physicalPageNumber })
}

function onTabChange(value: string | number): void {
  activeTab.value = String(value)
  if (activeTab.value === 'content' && versionId.value) {
    void loadChapters(versionId.value)
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

async function approve(): Promise<void> {
  if (!versionId.value) {
    return
  }
  try {
    await approveKnowledgeVersion(versionId.value)
    MessagePlugin.success('已审核通过')
    publishVisible.value = false
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
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
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
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
    await loadWorkspace()
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
}

watch(documentId, () => {
  activeTab.value = 'overview'
  focusPhysicalPageNumber.value = null
  void loadWorkspace()
  void loadVersions()
})

onMounted(() => {
  void loadCategories()
  void loadWorkspace()
  void loadVersions()
})

onUnmounted(() => {
  stopPoll()
})
</script>

<template>
  <AppPage>
    <template #header>
      <KnowledgeWorkspaceHeader
        :can-preview="Boolean(previewFile)"
        :can-test="Boolean(canTest && versionId && isKnowledgeReadyStatus(userStatus))"
        :category-name="categoryName"
        :chapter-count="workspace?.summary.tocCount || workspace?.summary.sectionCount || chapters.length"
        :doc-type="workspace?.document.docType"
        :more-actions="moreActions"
        :page-count="workspace?.summary.pageCount"
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
      :description="knowledgeUserMessage(normalizeFeedbackError(error).message)"
      @action="loadWorkspace"
    />

    <div v-else-if="loading && !workspace" class="knowledge-workspace">
      <t-loading loading text="正在加载知识库" />
    </div>

    <div v-else class="knowledge-workspace">
      <KnowledgeParseStatus
        v-if="isKnowledgeParsingStatus(userStatus) && !isEmptyKnowledgeBase"
        :file="workspace?.primaryFile"
        :job="workspace?.parsing.lastJob"
        :progress="workspace?.parsing.lastJob?.progress ?? 8"
        :stage="workspace?.parsing.lastJob?.stage"
      />

      <KnowledgeFailurePanel
        v-else-if="userStatus === 'PARSE_FAILED'"
        :can-debug="canDebug"
        :can-replace="canUpload && Boolean(workspace?.actions.canReplaceFile)"
        :can-retry="canParse && Boolean(workspace?.actions.canRetry)"
        :file="workspace?.primaryFile"
        :job="workspace?.parsing.lastJob"
        @replace="replaceVisible = true"
        @retry="reparse"
      />

      <KnowledgeSearchablePanel
        v-else-if="userStatus === 'SEARCHABLE_FILE_REQUIRED'"
        @bind="bindSearchable"
        @browse-only="browseOnly"
      />

      <template v-else-if="showWorkspaceTabs || isKnowledgeReadyStatus(userStatus)">
        <KnowledgePageStatusBar
          :workspace="workspace"
        />

        <t-tabs
          class="knowledge-workspace__tabs"
          :value="activeTab"
          @change="onTabChange"
        >
          <t-tab-panel label="资料概览" value="overview">
            <KnowledgeOverviewPanel
              :can-publish="canPublish"
              :can-rebuild-index="canEdit"
              :version-id="versionId"
              :version-status="workspace?.currentVersion?.status"
              :workspace="workspace"
              @refresh="loadWorkspace(false)"
            />
          </t-tab-panel>

          <t-tab-panel label="页面图库" value="gallery">
            <KnowledgePageGallery
              :key="galleryKey"
              :version-id="versionId"
              :editable="canEdit"
              :version-editable="versionEditable"
              :focus-physical-page-number="focusPhysicalPageNumber"
              :rendering="pageRendering"
              @changed="loadWorkspace(false)"
              @review-page="openRecognitionPage"
            />
          </t-tab-panel>

          <t-tab-panel label="识别校验" value="recognition">
            <KnowledgeRecognitionReview
              :key="`recognition-${versionId}`"
              :document-id="documentId"
              :version-id="versionId"
              :focus-physical-page-number="focusPhysicalPageNumber"
              @open-gallery-page="openGalleryPage"
            />
          </t-tab-panel>

          <t-tab-panel label="结构化数据" value="structured">
            <KnowledgeStructuredDataPanel
              :document-id="documentId"
              :version-id="versionId"
              @open-source-page="openGalleryPage($event.physicalPageNumber, $event.pageId)"
            />
          </t-tab-panel>

          <t-tab-panel label="资料内容" value="content">
            <div class="knowledge-workspace__result">
              <KnowledgeChapterTree
                :items="chapters"
                :loading="readingLoading && chapters.length === 0"
                :selected-id="selectedChapterId"
                @select="openChapter"
              />
              <KnowledgeParsedContent
                :can-preview="Boolean(previewFile) && hasPages"
                :loading="readingLoading"
                :machine-text="!hasPages || currentPage?.pageLabel === '机器提取文本'"
                :page="currentPage"
                :title="selectedChapter?.title"
                @preview-page="openOriginal(currentPage?.physicalPageNumber)"
                @open-gallery="openGalleryPage(currentPage?.physicalPageNumber)"
              />
            </div>
          </t-tab-panel>

          <t-tab-panel v-if="canTest" label="知识库测试" value="test">
            <KnowledgeTestPanel
              :version-id="versionId"
              @open-gallery-page="openGalleryPage"
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
      @updated="loadWorkspace"
    />
    <KnowledgeReplaceFileDrawer
      v-model:visible="replaceVisible"
      :document-id="documentId"
      @replaced="loadWorkspace"
    />
    <t-dialog
      :footer="false"
      header="发布设置"
      :visible="publishVisible"
      @close="publishVisible = false"
      @update:visible="(value: boolean) => publishVisible = value"
    >
      <p class="knowledge-publish-hint">
        发布后，提问时就能用到这份知识库。发布前需要先完成页面校验并构建知识索引。
      </p>

      <t-alert
        v-if="!workspace?.summary.canPublish && publishBlockers.length"
        class="knowledge-publish-blockers"
        theme="warning"
        title="暂时无法发布"
      >
        <p class="knowledge-publish-blockers-title">还需要完成：</p>
        <ul class="knowledge-publish-blockers-list">
          <li v-for="(blocker, blockerIndex) in publishBlockers" :key="blockerIndex">
            {{ blocker }}
          </li>
        </ul>
      </t-alert>

      <t-space>
        <t-button v-if="canApprove && workspace?.currentVersion?.status === 'DRAFT'" theme="primary" variant="outline" @click="approve">
          审核通过
        </t-button>
        <t-button v-if="canPublish" :disabled="!workspace?.summary.canPublish" theme="primary" @click="publish">
          发布
        </t-button>
        <t-button v-if="canPublish && workspace?.currentVersion?.status === 'PUBLISHED'" theme="warning" variant="outline" @click="disable">
          停用
        </t-button>
        <t-button theme="default" variant="outline" @click="browseOnly">
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
