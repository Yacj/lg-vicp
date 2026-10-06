<script setup lang="ts">
import type { FormRules, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onUnmounted, ref, watch } from 'vue'
import CollectionTaskDrawer from '@/components/business/collection/CollectionTaskDrawer.vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  createManualCollection,
  fetchCollectionTask,
  fetchCollectionTasks,
  importCollectionTaskToKnowledge,
} from '@/api/modules/collection'
import type { AppTableAction } from '@/types/crud'
import type { CollectionTask, CollectionUiStatus, ManualCollectionInput } from '@/types/collection'
import { COLLECTION_PERMISSIONS } from '@/types/collection'
import {
  COLLECTION_UI_STATUS_OPTIONS,
  collectionResultCount,
  collectionUiStatusMeta,
  isCollectionConfirmable,
  isCollectionImported,
  toCollectionUiStatus,
} from '@/utils/collection'
import { formatDate } from '@/utils/day'

const emit = defineEmits<{
  openKnowledge: [documentId: string]
}>()

const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()
const canCreate = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.MANUAL_CREATE] }))
const canView = computed(() => canAccess({
  permissions: [COLLECTION_PERMISSIONS.LIST, COLLECTION_PERMISSIONS.TASK_VIEW],
}))
const canImport = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.TASK_IMPORT] }))
const canViewKnowledge = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))

const list = useCrudList<CollectionTask, { keyword: string, uiStatus: CollectionUiStatus | '' }>({
  createQuery: () => ({ keyword: '', uiStatus: '' }),
  fetcher: async ({ query, page, pageSize, signal }) => {
    const keyword = query.keyword.trim() || undefined
    if (query.uiStatus === 'COLLECTING') {
      const [pending, running] = await Promise.all([
        fetchCollectionTasks({ keyword, mode: 'MANUAL', page: 1, pageSize: 100, status: 'PENDING' }, signal),
        fetchCollectionTasks({ keyword, mode: 'MANUAL', page: 1, pageSize: 100, status: 'RUNNING' }, signal),
      ])
      const items = [...pending.items, ...running.items]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      return { items, page: 1, pageSize, total: pending.total + running.total }
    }
    return fetchCollectionTasks({
      keyword,
      mode: 'MANUAL',
      page,
      pageSize,
      status: query.uiStatus || undefined,
    }, signal)
  },
  immediate: true,
  rowKey: 'id',
})

const createDrawer = useCrudDrawer<ManualCollectionInput, CollectionTask, CollectionTask>({
  createForm: () => ({ name: '', sourceUrl: '', remark: '' }),
  editForm: entity => ({ name: entity.name, sourceUrl: entity.sourceUrl, remark: '' }),
  submit: async ({ data }) => createManualCollection({
    name: data.name.trim(),
    sourceUrl: data.sourceUrl.trim(),
    remark: data.remark?.trim() || undefined,
  }),
  onSuccess: async () => {
    await feedback.message('success', '已开始采集')
    await list.refresh()
  },
  onError: cause => void feedback.messageError(cause),
})

const createRules: FormRules<ManualCollectionInput> = {
  name: [{ required: true, message: '请输入采集名称' }],
  sourceUrl: [
    { required: true, message: '请输入来源地址' },
    { url: { protocols: ['http', 'https'] }, message: '来源地址格式不正确' },
  ],
}

const selectedTask = ref<CollectionTask | null>(null)

async function openTask(task: CollectionTask): Promise<void> {
  if (canAccess({ permissions: [COLLECTION_PERMISSIONS.TASK_VIEW] })) {
    try {
      selectedTask.value = await fetchCollectionTask(task.id)
      return
    }
    catch {
      selectedTask.value = task
      return
    }
  }
  selectedTask.value = task
}

const importAction = useConfirmedCrudAction<CollectionTask, { knowledgeDocumentId: string }>({
  action: async (task) => importCollectionTaskToKnowledge(task.id),
  confirm: task => ({
    title: '确认入库',
    content: `将「${task.name}」入库为知识库，并进入解析流程。知识库名称使用采集名称。`,
  }),
  successMessage: '已入库，正在进入知识库解析流程',
  onSuccess: async (result, task) => {
    await list.refresh()
    selectedTask.value = null
    emit('openKnowledge', result.knowledgeDocumentId)
    void task
  },
})

const errorDescription = computed(() => list.error.value
  ? normalizeFeedbackError(list.error.value).message
  : '请检查网络连接后重试')

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', ellipsis: true, minWidth: 180, title: '名称' },
  { colKey: 'sourceUrl', ellipsis: true, minWidth: 240, title: '来源地址' },
  {
    colKey: 'status',
    minWidth: 100,
    title: '状态',
    cell: (_, { row }) => h(AppStatusTag, collectionUiStatusMeta((row as CollectionTask).status)),
  },
  {
    colKey: 'resultCount',
    minWidth: 100,
    title: '结果数量',
    cell: (_, { row }) => collectionResultCount(row as CollectionTask),
  },
  {
    colKey: 'createdAt',
    minWidth: 160,
    title: '创建时间',
    cell: (_, { row }) => formatDate(new Date((row as CollectionTask).createdAt), 'YYYY-MM-DD HH:mm'),
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as CollectionTask
  const actions: AppTableAction[] = []
  if (canView.value) {
    actions.push({ key: 'view', label: '查看', handler: () => void openTask(entity) })
  }
  if (canImport.value && isCollectionConfirmable(entity)) {
    actions.push({
      key: 'import',
      label: '确认入库',
      loading: importAction.running.value,
      handler: () => importAction.run(entity),
    })
  }
  if (canViewKnowledge.value && isCollectionImported(entity) && entity.importedKnowledgeDocumentId) {
    actions.push({
      key: 'knowledge',
      label: '查看知识',
      handler: () => emit('openKnowledge', entity.importedKnowledgeDocumentId!),
    })
  }
  return actions
}

function onPageChange(pageInfo: PageInfo): void {
  void list.changePage(pageInfo)
}

const hasCollecting = computed(() => list.data.value.some(item => toCollectionUiStatus(item.status) === 'COLLECTING'))
let pollTimer: ReturnType<typeof setInterval> | null = null

watch(hasCollecting, (collecting) => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (collecting) {
    pollTimer = setInterval(() => {
      void list.refresh()
    }, 8000)
  }
}, { immediate: true })

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})
</script>

<template>
  <div class="collection-manual-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="名称 / 来源地址" />
      </t-form-item>
      <t-form-item label="状态">
        <t-select
          v-model="list.query.uiStatus"
          :options="[...COLLECTION_UI_STATUS_OPTIONS]"
          clearable
          placeholder="全部"
        />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新建第一个手动采集任务"
      empty-title="暂无手动采集"
      :error-description="errorDescription"
      :operations-width="180"
      :page-size="list.pageSize.value"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="onPageChange"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #toolbar>
        <t-button v-if="canCreate" theme="primary" @click="createDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新建采集
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :form-data="createDrawer.formData"
      :mode="createDrawer.mode.value"
      :rules="createRules"
      :submitting="createDrawer.isSubmitting.value"
      confirm-text="开始采集"
      title="新建采集"
      :visible="createDrawer.visible.value"
      width="min(520px, 92vw)"
      @cancel="createDrawer.close"
      @submit="createDrawer.submit"
      @update:visible="createDrawer.setVisible"
    >
      <t-form-item label="采集名称" name="name" required-mark>
        <t-input v-model="createDrawer.formData.name" maxlength="160" placeholder="如：安徽地方标准" />
      </t-form-item>
      <t-form-item label="来源地址" name="sourceUrl" required-mark>
        <t-input v-model="createDrawer.formData.sourceUrl" maxlength="2000" placeholder="https://…" />
      </t-form-item>
      <t-form-item label="备注" name="remark">
        <t-textarea
          v-model="createDrawer.formData.remark"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :maxlength="500"
          placeholder="选填"
        />
      </t-form-item>
    </AppCrudFormDialog>

    <CollectionTaskDrawer
      :importing="importAction.running.value"
      :task="selectedTask"
      :visible="selectedTask !== null"
      @close="selectedTask = null"
      @import="importAction.run"
      @open-knowledge="emit('openKnowledge', $event)"
    />
  </div>
</template>

<style scoped>
.collection-manual-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}
</style>
