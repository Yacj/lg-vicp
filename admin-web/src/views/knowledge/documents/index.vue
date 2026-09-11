<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  deleteKnowledgeDocument,
  fetchKnowledgeDocuments,
} from '@/api/modules/knowledge'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeDocument, KnowledgeDocType, KnowledgeUserStatus } from '@/types/knowledge'
import { knowledgeDocTypes, knowledgeUserStatuses } from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeDocTypeLabel, knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'

const { canAccess } = usePermissionAccess()
const router = useRouter()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:doc:add'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:doc:remove'] }))
const canViewDetail = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))

const keyword = ref('')
const docType = ref<KnowledgeDocType | undefined>(undefined)
const userStatus = ref<KnowledgeUserStatus | undefined>(undefined)
const moreExpanded = ref(false)
const sourceOrg = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const documents = ref<KnowledgeDocument[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)
const createVisible = ref(false)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const searchKeyword = keyword.value.trim() || sourceOrg.value.trim()
    const result = await fetchKnowledgeDocuments({
      page: query.page,
      pageSize: query.pageSize,
      ...(searchKeyword ? { keyword: searchKeyword } : {}),
      ...(docType.value ? { docType: docType.value } : {}),
      ...(userStatus.value ? { userStatus: userStatus.value } : {}),
    })
    documents.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void load()
})

function search(): void {
  query.page = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  docType.value = undefined
  userStatus.value = undefined
  sourceOrg.value = ''
  query.page = 1
  void load()
}

function onPageChange(pageInfo: PageInfo): void {
  query.page = pageInfo.current
  if (pageInfo.pageSize) {
    query.pageSize = pageInfo.pageSize
  }
  void load()
}

function openDetail(id: string): void {
  void router.push({ name: 'KnowledgeDocumentDetail', params: { id } })
}

const deleteAction = useConfirmedCrudAction<KnowledgeDocument, unknown>({
  action: async (row) => {
    await deleteKnowledgeDocument(row.id)
  },
  confirm: (row) => ({ title: '删除知识库', content: `确定删除「${row.title}」？解析内容和历史版本将一并清理。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    colKey: 'title',
    minWidth: 280,
    title: '知识库',
    cell: (_, { row }) => h('div', { class: 'vicp-doc-title' }, (row as KnowledgeDocument).title),
  },
  {
    colKey: 'docType',
    minWidth: 120,
    title: '类型',
    cell: (_, { row }) => knowledgeDocTypeLabel((row as KnowledgeDocument).docType),
  },
  {
    colKey: 'userStatus',
    minWidth: 160,
    title: '解析状态',
    cell: (_, { row }) => {
      const meta = knowledgeUserStatusMetaFor((row as KnowledgeDocument).userStatus)
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
  },
  {
    colKey: 'usage',
    minWidth: 120,
    title: '使用状态',
    cell: (_, { row }) => knowledgeUserStatusMetaFor((row as KnowledgeDocument).userStatus).usageLabel,
  },
  {
    colKey: 'updatedAt',
    minWidth: 120,
    title: '更新时间',
    cell: (_, { row }) => formatDate(new Date((row as KnowledgeDocument).updatedAt), 'YYYY-MM-DD'),
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeDocument
  const actions: AppTableAction[] = []
  if (canViewDetail.value) {
    actions.push({ key: 'view', label: '查看', handler: () => openDetail(entity.id) })
  }
  if (canRemove.value) {
    actions.push({
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}
</script>

<template>
  <AppPage description="管理图集、标准、产品资料等知识内容。解析完成后，提问时就能用到。" title="知识库">
    <template #search>
      <AppSearchPanel
        :collapsible="true"
        :expanded="moreExpanded"
        :loading="isLoading"
        @reset="reset"
        @search="search"
        @update:expanded="(value: boolean) => moreExpanded = value"
      >
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="知识库名称 / 编号" />
        </t-form-item>
        <t-form-item label="类型">
          <t-select
            v-model="docType"
            :options="knowledgeDocTypes.map((value) => ({ label: knowledgeDocTypeLabel(value), value }))"
            clearable
            placeholder="全部"
          />
        </t-form-item>
        <t-form-item label="解析状态">
          <t-select
            v-model="userStatus"
            :options="knowledgeUserStatuses.map((value) => ({ label: knowledgeUserStatusMetaFor(value).label, value }))"
            clearable
            placeholder="全部"
          />
        </t-form-item>
        <template #advanced>
          <t-form-item label="来源机构">
            <t-input v-model="sourceOrg" clearable placeholder="来源机构" />
          </t-form-item>
        </template>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="query.page"
      :data="documents"
      empty-description="上传图集、标准、产品资料后，系统会自动整理章节和内容，之后就能用来提问。"
      empty-title="还没有知识库"
      :error-description="errorDescription"
      :operations-width="140"
      :page-size="query.pageSize"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="createVisible = true">
          <template #icon>
            <AddIcon />
          </template>
          新建知识库
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" :max-visible="2" />
      </template>
    </AppDataTable>

    <KnowledgeCreateDrawer
      v-model:visible="createVisible"
      @created="(id: string) => openDetail(id)"
    />
  </AppPage>
</template>

<style scoped>
.vicp-doc-title {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
</style>
