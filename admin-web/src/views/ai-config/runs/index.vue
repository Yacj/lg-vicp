<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AgentRunTableRow } from '@/composables/useAiRunRecords'
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchPlatformProjects } from '@/api/modules/projects'
import { fetchUsers } from '@/api/modules/users'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiRunRecords } from '@/composables/useAiRunRecords'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'AiConfigRuns' })

const { runList } = useAiRunRecords()
const router = useRouter()
const { canAccess } = usePermissionAccess()

const canListProjects = computed(() => canAccess({ permissions: ['system:project:list'] }))
const canListUsers = computed(() => canAccess({ permissions: ['system:user:list'] }))
const projectOptions = ref<Array<{ label: string, value: string }>>([])
const userOptions = ref<Array<{ label: string, value: string }>>([])

onMounted(() => {
  if (canListProjects.value) {
    void fetchPlatformProjects({ page: 1, pageSize: 100 })
      .then((result) => {
        projectOptions.value = result.items.map(item => ({ label: item.name, value: item.id }))
      })
      .catch(() => {
        projectOptions.value = []
      })
  }
  if (canListUsers.value) {
    void fetchUsers({ page: 1, pageSize: 100 })
      .then((result) => {
        userOptions.value = result.items.map(item => ({
          label: item.phone ? `${item.displayName}（${item.phone}）` : item.displayName,
          value: item.id,
        }))
      })
      .catch(() => {
        userOptions.value = []
      })
  }
})

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '已删除', value: 'deleted' },
]

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => formatDate(new Date((row as AgentRunTableRow).conversation.updatedAt)),
    colKey: 'conversation.updatedAt',
    title: '时间',
    width: 180,
  },
  {
    cell: (_h, { row }) => (row as AgentRunTableRow).user.displayName,
    colKey: 'user.displayName',
    minWidth: 140,
    title: '用户',
  },
  {
    cell: (_h, { row }) => (row as AgentRunTableRow).conversation.title || '未命名会话',
    colKey: 'conversation.title',
    minWidth: 200,
    title: 'Conversation',
  },
  {
    cell: (_h, { row }) => (row as AgentRunTableRow).project?.name ?? '—',
    colKey: 'project.name',
    minWidth: 160,
    title: '项目',
  },
  {
    cell: () => '—',
    colKey: 'model',
    minWidth: 120,
    title: '模型',
  },
  {
    cell: (_h, { row }) => {
      const item = row as AgentRunTableRow
      return h(AppStatusTag, {
        label: item.conversation.status === 'active' ? '正常' : '已删除',
        status: item.conversation.status === 'active' ? 'success' : 'disabled',
      })
    },
    colKey: 'conversation.status',
    title: '状态',
    width: 100,
  },
  {
    cell: () => '—',
    colKey: 'duration',
    title: '耗时',
    width: 90,
  },
  {
    cell: () => '—',
    colKey: 'toolCount',
    title: '工具调用次数',
    width: 100,
  },
]

const errorDescription = computed(() => runList.error.value
  ? normalizeFeedbackError(runList.error.value).message
  : '请检查网络连接后重试')

function openDetail(row: TableRowData): void {
  const item = row as AgentRunTableRow
  void router.push({
    path: `/ai-config/runs/${item.conversation.id}`,
    query: { title: item.conversation.title ?? '' },
  })
}
</script>

<template>
  <AppPage
    description="按会话排查 AI 运行结果。模型、请求时间、耗时、状态、错误与工具调用次数在详情中展示，不展示模型私有推理。"
    title="AI 运行记录"
  >
    <template #search>
      <AppSearchPanel
        :loading="runList.isLoading.value"
        @reset="runList.reset"
        @search="runList.search"
      >
        <t-form-item label="状态">
          <t-select v-model="runList.query.status" :options="statusOptions" />
        </t-form-item>
        <t-form-item v-if="canListProjects" label="项目">
          <t-select
            v-model="runList.query.projectId"
            clearable
            filterable
            :options="projectOptions"
            placeholder="全部项目"
          />
        </t-form-item>
        <t-form-item v-if="canListUsers" label="用户">
          <t-select
            v-model="runList.query.userId"
            clearable
            filterable
            :options="userOptions"
            placeholder="全部用户"
          />
        </t-form-item>
        <t-form-item label="时间">
          <t-date-range-picker
            v-model="runList.query.dateRange"
            clearable
            placeholder="开始日期 - 结束日期"
          />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="runList.current.value"
      :data="runList.data.value"
      empty-description="暂无符合条件的会话运行记录"
      empty-title="暂无运行记录"
      :error-description="errorDescription"
      :page-size="runList.pageSize.value"
      row-key="conversation.id"
      :status="runList.tableStatus.value"
      :total="runList.total.value"
      @page-change="runList.changePage"
      @refresh="runList.refresh"
      @retry="runList.retry"
    >
      <template #operations="{ row }">
        <t-button theme="primary" variant="text" @click="openDetail(row)">
          查看详情
        </t-button>
      </template>
    </AppDataTable>
  </AppPage>
</template>
