<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiFeedbackItem } from '@/types/ai'
import { computed, h, ref } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiFeedbackOps } from '@/composables/useAiFeedbackOps'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { AI_SCENE_OPTIONS, getAiClientAppLabel, getAiFeedbackReactionLabel, getAiSceneLabel } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const { feedbackList, markHandled } = useAiFeedbackOps()
const { canAccess } = usePermissionAccess()

const rows = feedbackList.data
const current = feedbackList.current
const pageSize = feedbackList.pageSize
const total = feedbackList.total
const tableStatus = feedbackList.tableStatus

const reactionFilterOptions = [
  { label: '全部反应', value: 'all' },
  { label: '点赞', value: 'LIKE' },
  { label: '点踩', value: 'DISLIKE' },
]

const sceneFilterOptions = [
  { label: '全部场景', value: 'all' },
  ...AI_SCENE_OPTIONS,
]

const canHandleFeedback = computed(() => canAccess({ permissions: ['system:ai:feedback:handle'] }))

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const item = row as AiFeedbackItem
      return h(AppStatusTag, {
        label: getAiFeedbackReactionLabel(item.feedback.reaction ?? ''),
        status: item.feedback.reaction === 'LIKE' ? 'success' : 'warning',
      })
    },
    colKey: 'feedback.reaction',
    title: '反应',
    width: 100,
  },
  {
    cell: (_h, { row }) => (row as AiFeedbackItem).feedback.content || '-',
    colKey: 'feedback.content',
    ellipsis: true,
    minWidth: 240,
    title: '反馈内容',
  },
  {
    cell: (_h, { row }) => {
      const content = (row as AiFeedbackItem).message.content
      return content.length > 60 ? `${content.slice(0, 60)}...` : content
    },
    colKey: 'message.content',
    ellipsis: true,
    minWidth: 220,
    title: '消息预览',
  },
  {
    cell: (_h, { row }) => getAiSceneLabel((row as AiFeedbackItem).conversation.scene),
    colKey: 'conversation.scene',
    minWidth: 110,
    title: '场景',
  },
  {
    cell: (_h, { row }) => {
      const item = row as AiFeedbackItem
      return h('div', { class: 'ai-feedback-page__user' }, [
        h('span', {}, item.user.displayName),
        item.user.phone
          ? h('span', { class: 'ai-feedback-page__muted' }, item.user.phone)
          : null,
      ])
    },
    colKey: 'user.displayName',
    minWidth: 150,
    title: '用户',
  },
  {
    cell: (_h, { row }) => getAiClientAppLabel((row as AiFeedbackItem).conversation.clientApp),
    colKey: 'conversation.clientApp',
    minWidth: 130,
    title: '客户端',
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as AiFeedbackItem).feedback.createdAt)),
    colKey: 'feedback.createdAt',
    title: '反馈时间',
    width: 180,
  },
  {
    cell: (_h, { row }) => {
      const handledAt = (row as AiFeedbackItem).feedback.handledAt
      return h(AppStatusTag, {
        label: handledAt ? '已处理' : '未处理',
        status: handledAt ? 'success' : 'default',
      })
    },
    colKey: 'feedback.handledAt',
    title: '处理状态',
    width: 100,
  },
  {
    cell: (_h, { row }) => (row as AiFeedbackItem).feedback.handlingNote ?? '-',
    colKey: 'feedback.handlingNote',
    ellipsis: true,
    minWidth: 180,
    title: '处理备注',
  },
  {
    cell: (_h, { row }) => {
      const handledAt = (row as AiFeedbackItem).feedback.handledAt
      return handledAt ? formatDate(new Date(handledAt)) : '-'
    },
    colKey: 'feedback.handledAtTime',
    minWidth: 160,
    title: '处理时间',
  },
  {
    cell: (_h, { row }) => (row as AiFeedbackItem).feedback.handledById ?? '-',
    colKey: 'feedback.handledById',
    minWidth: 140,
    title: '处理人',
  },
]

const errorDescription = computed(() => feedbackList.error.value
  ? normalizeFeedbackError(feedbackList.error.value).message
  : '请检查网络连接后重试')

/** 消息查看弹窗。 */
const viewVisible = ref(false)
const viewItem = ref<AiFeedbackItem | null>(null)

function openMessage(row: TableRowData): void {
  viewItem.value = row as AiFeedbackItem
  viewVisible.value = true
}

/** 标记已处理弹窗。 */
const handleVisible = ref(false)
const handleNote = ref('')
const handleTarget = ref<AiFeedbackItem | null>(null)
const handleSubmitting = ref(false)

function openHandleDialog(row: TableRowData): void {
  handleTarget.value = row as AiFeedbackItem
  handleNote.value = ''
  handleVisible.value = true
}

async function submitHandle(): Promise<void> {
  if (handleSubmitting.value || !handleTarget.value) {
    return
  }
  const note = handleNote.value.trim()
  if (note.length > 1000) {
    return
  }
  handleSubmitting.value = true
  try {
    await markHandled(handleTarget.value, {
      handlingNote: note,
      ...(handleTarget.value.feedback.reasonCode ? { reasonCode: handleTarget.value.feedback.reasonCode } : {}),
    })
    handleVisible.value = false
  }
  finally {
    handleSubmitting.value = false
  }
}

/** 已处理信息弹窗。 */
const infoVisible = ref(false)
const infoItem = ref<AiFeedbackItem | null>(null)

function openInfoDialog(row: TableRowData): void {
  infoItem.value = row as AiFeedbackItem
  infoVisible.value = true
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs === undefined) {
    return '-'
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}
</script>

<template>
  <AppPage>
    <template #search>
      <AppSearchPanel
        :loading="feedbackList.isLoading.value"
        @reset="feedbackList.reset"
        @search="feedbackList.search"
      >
        <t-form-item label="反应">
          <t-select v-model="feedbackList.query.reaction" :options="reactionFilterOptions" />
        </t-form-item>
        <t-form-item label="场景">
          <t-select v-model="feedbackList.query.scene" :options="sceneFilterOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      empty-description="暂无 AI 回答反馈"
      empty-title="暂无反馈"
      :error-description="errorDescription"
      :page-size="pageSize"
      row-key="feedback.id"
      :status="tableStatus"
      :total="total"
      @page-change="feedbackList.changePage"
      @refresh="feedbackList.refresh"
      @retry="feedbackList.retry"
    >
      <template #operations="{ row }">
        <div class="ai-feedback-page__operations">
          <t-button variant="text" theme="primary" @click="openMessage(row)">
            查看消息
          </t-button>
          <t-button
            v-if="canHandleFeedback && !(row as AiFeedbackItem).feedback.handledAt"
            variant="text"
            theme="success"
            @click="openHandleDialog(row)"
          >
            标记已处理
          </t-button>
          <t-button
            v-else-if="(row as AiFeedbackItem).feedback.handledAt"
            variant="text"
            @click="openInfoDialog(row)"
          >
            处理信息
          </t-button>
        </div>
      </template>
    </AppDataTable>

    <t-drawer
      :cancel-btn="null"
      confirm-text="关闭"
      :footer="false"
      header="消息详情"
      :visible="viewVisible"
      size="min(720px, 92vw)"
      @close="viewVisible = false"
    >
      <template v-if="viewItem">
        <t-descriptions bordered :column="2" size="medium">
          <t-descriptions-item label="反馈内容">
            {{ viewItem.feedback.content || '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="标签">
            {{ viewItem.feedback.tags.length ? viewItem.feedback.tags.join('、') : '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="模型">
            {{ viewItem.message.model ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="服务商">
            {{ viewItem.message.provider ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="Token（输入/输出）">
            {{ viewItem.message.tokenInput ?? '-' }} / {{ viewItem.message.tokenOutput ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="耗时">
            {{ formatDuration(viewItem.message.durationMs) }}
          </t-descriptions-item>
          <t-descriptions-item label="消息时间">
            {{ formatDate(new Date(viewItem.message.createdAt)) }}
          </t-descriptions-item>
        </t-descriptions>
        <h4 class="ai-feedback-page__view-title">
          消息内容
        </h4>
        <pre class="ai-feedback-page__view-content">{{ viewItem.message.content }}</pre>
      </template>
    </t-drawer>

    <t-dialog
      :cancel-btn="{ content: '取消' }"
      confirm-text="确认处理"
      header="标记已处理"
      :loading="handleSubmitting"
      :visible="handleVisible"
      width="min(520px, 92vw)"
      @close="handleVisible = false"
      @confirm="submitHandle"
    >
      <t-form label-align="top">
        <t-form-item
          help="选填：记录处理结论或后续动作，最长 1000 字。"
          label="处理备注"
        >
          <t-textarea
            v-model="handleNote"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :maxlength="1000"
            placeholder="例如：已核对模型输出，确认属于业务规则问题，转交产品跟进"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog
      :cancel-btn="null"
      confirm-text="关闭"
      header="处理信息"
      :visible="infoVisible"
      width="min(520px, 92vw)"
      @close="infoVisible = false"
      @confirm="infoVisible = false"
    >
      <t-descriptions v-if="infoItem" bordered :column="1" size="medium">
        <t-descriptions-item label="处理状态">
          <AppStatusTag label="已处理" status="success" />
        </t-descriptions-item>
        <t-descriptions-item label="处理人">
          {{ infoItem.feedback.handledById ?? '-' }}
        </t-descriptions-item>
        <t-descriptions-item label="处理时间">
          {{ infoItem.feedback.handledAt ? formatDate(new Date(infoItem.feedback.handledAt)) : '-' }}
        </t-descriptions-item>
        <t-descriptions-item label="处理备注">
          {{ infoItem.feedback.handlingNote ?? '-' }}
        </t-descriptions-item>
      </t-descriptions>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.ai-feedback-page__user {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ai-feedback-page__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-feedback-page__operations {
  display: flex;
  align-items: center;
  gap: var(--td-size-1);
}

.ai-feedback-page__view-title {
  margin: var(--td-size-5) 0 var(--td-size-3);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}

.ai-feedback-page__view-content {
  margin: 0;
  padding: var(--td-size-4);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  font-family: inherit;
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-medium);
}
</style>
