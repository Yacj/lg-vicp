<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { ProjectAiMemory, ProjectAiMemoryView } from '@/types/ai'
import { computed, h, toRef } from 'vue'
import { useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useProjectAiMemory } from '@/composables/useProjectAiMemory'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  getProjectAiMemoryStatusLabel,
  getProjectAiMemoryStatusTone,
  getProjectAiMemoryTypeLabel,
  getProjectAiMemoryVerifiedLabel,
} from '@/utils/ai-memory'
import { formatDate } from '@/utils/day'

const props = defineProps<{
  projectId: string
  canManage: boolean
}>()

const router = useRouter()
const { canAccess } = usePermissionAccess()
const enabled = computed(() => true)
const { confirmAction, memoryList, rejectAction } = useProjectAiMemory(
  toRef(props, 'projectId'),
  enabled,
)

const canOpenConversation = computed(() => canAccess({ permissions: ['system:ai:conversation:detail'] }))

const viewOptions = [
  { label: '有效记忆', value: 'active' },
  { label: '待确认', value: 'pending' },
  { label: '历史', value: 'history' },
] as const

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => getProjectAiMemoryTypeLabel((row as ProjectAiMemory).memoryType),
    colKey: 'memoryType',
    title: '类型',
    width: 100,
  },
  {
    cell: (_h, { row }) => {
      const item = row as ProjectAiMemory
      return item.title ? `${item.title}：${item.content}` : item.content
    },
    colKey: 'content',
    ellipsis: true,
    minWidth: 280,
    title: '内容',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: getProjectAiMemoryStatusLabel((row as ProjectAiMemory).status),
      status: getProjectAiMemoryStatusTone((row as ProjectAiMemory).status),
    }),
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => getProjectAiMemoryVerifiedLabel((row as ProjectAiMemory).verified),
    colKey: 'verified',
    title: '是否已确认',
    width: 120,
  },
  {
    cell: (_h, { row }) => (row as ProjectAiMemory).sourceConversationId ? '已关联' : '—',
    colKey: 'sourceConversationId',
    minWidth: 140,
    title: '来源 Conversation',
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectAiMemory).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

function openSource(memory: ProjectAiMemory): void {
  if (!memory.sourceConversationId) {
    return
  }
  void router.push({
    path: `/ai-ops/conversations/${memory.sourceConversationId}`,
  })
}

function memoryActions(row: TableRowData): AppTableAction[] {
  const memory = row as ProjectAiMemory
  const actions: AppTableAction[] = []
  if (canOpenConversation.value && memory.sourceConversationId) {
    actions.push({
      handler: () => openSource(memory),
      key: 'source',
      label: '查看来源',
    })
  }
  if (props.canManage && memory.status !== 'REJECTED') {
    if (memory.status === 'PENDING' && !memory.verified) {
      actions.push({
        handler: () => confirmAction.run(memory),
        key: 'confirm',
        label: '确认',
        loading: confirmAction.running.value,
      })
    }
    actions.push({
      handler: () => rejectAction.run(memory),
      key: 'reject',
      label: '标记无效',
      loading: rejectAction.running.value,
      theme: 'danger',
    })
  }
  return actions
}

const errorDescription = computed(() => memoryList.error.value
  ? normalizeFeedbackError(memoryList.error.value).message
  : '请检查网络连接后重试')
</script>

<template>
  <section class="project-memory">
    <div class="project-memory__toolbar">
      <t-radio-group
        :model-value="memoryList.query.view"
        variant="default-filled"
        @change="(value: unknown) => { memoryList.query.view = value as ProjectAiMemoryView }"
      >
        <t-radio-button
          v-for="option in viewOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </t-radio-button>
      </t-radio-group>
    </div>

    <AppDataTable
      :columns="columns"
      :data="memoryList.data.value"
      empty-description="该项目暂无符合当前视图的 AI 记忆"
      empty-title="暂无 AI 记忆"
      :error-description="errorDescription"
      :operations-width="180"
      row-key="id"
      :show-pagination="false"
      :status="memoryList.tableStatus.value"
      :total="memoryList.total.value"
      @refresh="memoryList.refresh"
      @retry="memoryList.retry"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="memoryActions(row)" />
      </template>
    </AppDataTable>
  </section>
</template>

<style scoped>
.project-memory {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}

.project-memory__toolbar {
  display: flex;
  justify-content: flex-start;
}
</style>
