<script setup lang="ts">
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import KnowledgeAdvancedDrawer from '@/components/business/knowledge/KnowledgeAdvancedDrawer.vue'
import KnowledgeChapterTree from '@/components/business/knowledge/KnowledgeChapterTree.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import KnowledgeFailurePanel from '@/components/business/knowledge/KnowledgeFailurePanel.vue'
import KnowledgeParsedContent from '@/components/business/knowledge/KnowledgeParsedContent.vue'
import KnowledgeParseStatus from '@/components/business/knowledge/KnowledgeParseStatus.vue'
import KnowledgeReplaceFileDrawer from '@/components/business/knowledge/KnowledgeReplaceFileDrawer.vue'
import KnowledgeSearchablePanel from '@/components/business/knowledge/KnowledgeSearchablePanel.vue'
import KnowledgeTestDrawer from '@/components/business/knowledge/KnowledgeTestDrawer.vue'
import KnowledgeVersionDrawer from '@/components/business/knowledge/KnowledgeVersionDrawer.vue'
import KnowledgeWorkspaceHeader from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import type { KnowledgeHeaderAction } from '@/components/business/knowledge/KnowledgeWorkspaceHeader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  approveKnowledgeVersion,
  bindKnowledgeSearchSource,
  deleteKnowledgeDocument,
  disableKnowledgeVersion,
  fetchKnowledgeCategories,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeWorkspace,
  fetchVersionChapterTree,
  fetchVersionPageWindow,
  publishKnowledgeVersion,
  restartKnowledgeParse,
  updateVersionUsageMode,
} from '@/api/modules/knowledge'
import type {
  KnowledgeCategory,
  KnowledgeChapterTreeNode,
  KnowledgeDocument,
  KnowledgeDocumentVersion,
  KnowledgePage,
  KnowledgeSelectedFile,
  KnowledgeUserTestSource,
  KnowledgeWorkspace,
} from '@/types/knowledge'
import { isKnowledgeParsingStatus, isKnowledgeReadyStatus, knowledgeUserMessage } from '@/utils/knowledge-user'

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
const testVisible = ref(false)
const versionVisible = ref(false)
const advancedVisible = ref(false)
const editVisible = ref(false)
const replaceVisible = ref(false)
const publishVisible = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const userStatus = computed(() => workspace.value?.currentVersion?.userStatus ?? 'PENDING_PARSE')
const versionId = computed(() => workspace.value?.currentVersion?.id ?? null)
const categoryName = computed(() => {
  const id = workspace.value?.document.categoryId ?? documentMeta.value?.categoryId
  return categories.value.find(item => item.id === id)?.name ?? ''
})
const selectedChapter = computed(() => findChapter(chapters.value, selectedChapterId.value))
const previewFile = computed(() => {
  const file = workspace.value?.primaryFile
  if (!file) return null
  return { id: file.id, originalName: file.name, mimeType: file.mimeType || 'application/pdf' }
})
const moreActions = computed<KnowledgeHeaderAction[]>(() => {
  const actions: KnowledgeHeaderAction[] = []
  if (canEdit.value) actions.push({ key: 'edit', label: '编辑基本信息' })
  if (canUpload.value && workspace.value?.actions.canReplaceFile) actions.push({ key: 'replace', label: '更换文件' })
  if (canParse.value && workspace.value?.actions.canRetry) actions.push({ key: 'reparse', label: '重新解析' })
  actions.push({ key: 'versions', label: '历史版本' })
  if (canApprove.value || canPublish.value) actions.push({ key: 'publish', label: '发布设置' })
  if (canDebug.value) actions.push({ key: 'advanced', label: '校正章节和页码' })
  if (canRemove.value) actions.push({ key: 'delete', label: '删除知识库', theme: 'error' })
  return actions
})

function findChapter(items: KnowledgeChapterTreeNode[], id: string | null): KnowledgeChapterTreeNode | null {
  if (!id) return null
  for (const item of items) {
    if (item.id === id) return item
    const child = findChapter(item.children ?? [], id)
    if (child) return child
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

async function loadWorkspace(showLoading = true): Promise<void> {
  if (showLoading) loading.value = true
  error.value = null
  try {
    workspace.value = await fetchKnowledgeWorkspace(documentId.value)
    if (isKnowledgeParsingStatus(workspace.value.currentVersion?.userStatus)) {
      startPoll()
    }
    else {
      stopPoll()
      if (isKnowledgeReadyStatus(workspace.value.currentVersion?.userStatus) && workspace.value.currentVersion?.id) {
        await loadChapters(workspace.value.currentVersion.id)
      }
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
      await openPage(1)
    }
  }
  catch {
    chapters.value = []
  }
}

async function openChapter(node: KnowledgeChapterTreeNode): Promise<void> {
  selectedChapterId.value = node.id
  await openPage(node.physicalPageNumber ?? 1)
}

async function openPage(physicalPageNumber: number): Promise<void> {
  if (!versionId.value) return
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
  if (key === 'edit') editVisible.value = true
  if (key === 'replace') replaceVisible.value = true
  if (key === 'versions') {
    void loadVersions()
    versionVisible.value = true
  }
  if (key === 'advanced') advancedVisible.value = true
  if (key === 'publish') publishVisible.value = true
  if (key === 'reparse') void reparse()
  if (key === 'delete') void deleteAction.run()
}

async function reparse(): Promise<void> {
  if (!versionId.value) return
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
  if (!versionId.value) return
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
  if (!versionId.value) return
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

function openTestSource(source: KnowledgeUserTestSource, original: boolean): void {
  testVisible.value = false
  if (original) {
    openOriginal(source.physicalPageNumber)
    return
  }
  if (source.physicalPageNumber != null) {
    void openPage(source.physicalPageNumber)
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
  if (!versionId.value) return
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
  if (!versionId.value) return
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
  if (!versionId.value) return
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
        @test="testVisible = true"
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
        v-if="isKnowledgeParsingStatus(userStatus)"
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

      <div v-else-if="isKnowledgeReadyStatus(userStatus)" class="knowledge-workspace__result">
        <KnowledgeChapterTree
          :items="chapters"
          :loading="readingLoading && chapters.length === 0"
          :selected-id="selectedChapterId"
          @select="openChapter"
        />
        <KnowledgeParsedContent
          :can-preview="Boolean(previewFile)"
          :loading="readingLoading"
          :page="currentPage"
          :title="selectedChapter?.title"
          @preview-page="openOriginal(currentPage?.physicalPageNumber)"
        />
      </div>

      <AppEmptyState
        v-else
        description="请上传知识文件并等待系统自动解析。"
        title="还没有解析结果"
      />
    </div>

    <AppFilePreview
      :file="previewFile"
      :page-number="previewPage"
      :visible="previewVisible"
      @close="previewVisible = false"
    />
    <KnowledgeTestDrawer
      v-model:visible="testVisible"
      :version-id="versionId"
      @open-content="openTestSource($event, false)"
      @open-original="openTestSource($event, true)"
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
        解析完成后可以审核并发布。发布后，提问时就能用到这份知识库。
      </p>
      <t-space>
        <t-button v-if="canApprove && workspace?.currentVersion?.status === 'DRAFT'" theme="primary" variant="outline" @click="approve">
          审核通过
        </t-button>
        <t-button v-if="canPublish && workspace?.summary.canPublish" theme="primary" @click="publish">
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
</style>
