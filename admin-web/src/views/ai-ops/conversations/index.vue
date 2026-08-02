<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { PlatformConversationTableRow } from '@/composables/useAiConversationOps'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiConversationOps } from '@/composables/useAiConversationOps'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { AI_SCENE_OPTIONS, getAiClientAppLabel, getAiReasoningModeLabel, getAiSceneLabel } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const { conversationList } = useAiConversationOps()
const router = useRouter()

const rows = conversationList.data
const current = conversationList.current
const pageSize = conversationList.pageSize
const total = conversationList.total
const tableStatus = conversationList.tableStatus

const sceneFilterOptions = [
  { label: '全部场景', value: 'all' },
  ...AI_SCENE_OPTIONS,
]

const clientAppFilterOptions = [
  { label: '全部客户端', value: 'all' },
  { label: 'PC AI 工作台', value: 'pc_ai' },
  { label: 'B 端管理台', value: 'b_admin' },
  { label: 'C 端应用', value: 'c_app' },
]

const statusFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '已删除', value: 'deleted' },
]

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const item = row as PlatformConversationTableRow
      return h('div', { class: 'ai-ops-page__title' }, [
        h('span', { class: 'ai-ops-page__title-text' }, item.conversation.title || '未命名会话'),
        item.conversation.isPinned
          ? h('span', { class: 'ai-ops-page__pinned' }, '置顶')
          : null,
      ])
    },
    colKey: 'conversation.title',
    minWidth: 200,
    title: '会话标题',
  },
  {
    cell: (_h, { row }) => {
      const item = row as PlatformConversationTableRow
      return h('div', { class: 'ai-ops-page__user' }, [
        h('span', {}, item.user.displayName),
        item.user.phone
          ? h('span', { class: 'ai-ops-page__muted' }, item.user.phone)
          : null,
      ])
    },
    colKey: 'user.displayName',
    minWidth: 160,
    title: '用户',
  },
  {
    cell: (_h, { row }) => (row as PlatformConversationTableRow).project?.name ?? '-',
    colKey: 'project.name',
    minWidth: 160,
    title: '项目',
  },
  {
    cell: (_h, { row }) => getAiSceneLabel((row as PlatformConversationTableRow).conversation.scene),
    colKey: 'conversation.scene',
    minWidth: 110,
    title: '场景',
  },
  {
    cell: (_h, { row }) => {
      const reasoningMode = (row as PlatformConversationTableRow).conversation.reasoningMode
      return reasoningMode
        ? h(AppStatusTag, {
            label: getAiReasoningModeLabel(reasoningMode),
            status: reasoningMode === 'ON' ? 'processing' : 'default',
          })
        : '-'
    },
    colKey: 'conversation.reasoningMode',
    minWidth: 110,
    title: '推理模式',
  },
  {
    cell: (_h, { row }) => getAiClientAppLabel((row as PlatformConversationTableRow).conversation.clientApp),
    colKey: 'conversation.clientApp',
    minWidth: 130,
    title: '客户端',
  },
  {
    cell: (_h, { row }) => String((row as PlatformConversationTableRow).messageCount),
    colKey: 'messageCount',
    title: '消息数',
    width: 100,
  },
  {
    cell: (_h, { row }) => {
      const item = row as PlatformConversationTableRow
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
    cell: (_h, { row }) => formatDate(new Date((row as PlatformConversationTableRow).conversation.createdAt)),
    colKey: 'conversation.createdAt',
    title: '创建时间',
    width: 180,
  },
]

const errorDescription = computed(() => conversationList.error.value
  ? normalizeFeedbackError(conversationList.error.value).message
  : '请检查网络连接后重试')

function openDetail(row: TableRowData): void {
  const item = row as PlatformConversationTableRow
  void router.push({
    path: `/ai-ops/conversations/${item.conversation.id}`,
    query: { title: item.conversation.title ?? '' },
  })
}
</script>

<template>
  <AppPage>
    <template #search>
      <AppSearchPanel
        :loading="conversationList.isLoading.value"
        @reset="conversationList.reset"
        @search="conversationList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="conversationList.query.keyword"
            clearable
            placeholder="会话标题、用户或项目"
          />
        </t-form-item>
        <t-form-item label="场景">
          <t-select v-model="conversationList.query.scene" :options="sceneFilterOptions" />
        </t-form-item>
        <t-form-item label="客户端">
          <t-select v-model="conversationList.query.clientApp" :options="clientAppFilterOptions" />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="conversationList.query.status" :options="statusFilterOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      empty-description="暂无 AI 会话记录"
      empty-title="暂无会话"
      :error-description="errorDescription"
      :page-size="pageSize"
      row-key="conversation.id"
      :status="tableStatus"
      :total="total"
      @page-change="conversationList.changePage"
      @refresh="conversationList.refresh"
      @retry="conversationList.retry"
    >
      <template #operations="{ row }">
        <t-button variant="text" theme="primary" @click="openDetail(row)">
          查看详情
        </t-button>
      </template>
    </AppDataTable>
  </AppPage>
</template>

<style scoped>
.ai-ops-page__title {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.ai-ops-page__title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-ops-page__pinned {
  flex-shrink: 0;
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-page__user {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ai-ops-page__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
