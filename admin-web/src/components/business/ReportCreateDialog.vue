<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReportType } from '@/types/report'
import { createReport, fetchConversationMessages } from '@/api/modules/reports'
import type { ConversationMessageSource } from '@/api/modules/reports'
import { fetchProjectConversations } from '@/api/modules/ai'
import type { ProjectConversation } from '@/types/project'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { formatDate } from '@/utils/day'
import { REPORT_TYPE_META } from '@/utils/report'

/**
 * 创建报告对话框。
 * 流程：选择项目下的 AI 会话 → 选择报告类型 → 选择来源回答（可选，最多 20 条）→ 提交。
 * 数据全部来自真实接口：会话列表 / 会话消息 / 创建报告。
 */
const props = defineProps<{
  visible: boolean
  projectId: string
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'success': []
}>()

const feedback = useAppFeedback()

const conversations = ref<ProjectConversation[]>([])
const conversationsLoading = ref(false)
const selectedConversationId = ref('')
const messages = ref<ConversationMessageSource[]>([])
const messagesLoading = ref(false)
const reportType = ref<ReportType>('energy_design')
const selectedMessageIds = ref<string[]>([])
const submitting = ref(false)

const reportTypeOptions = (Object.keys(REPORT_TYPE_META) as ReportType[]).map(type => ({
  description: REPORT_TYPE_META[type].description,
  label: REPORT_TYPE_META[type].label,
  value: type,
}))

const selectableMessages = computed(() =>
  messages.value.filter(message =>
    message.role === 'ASSISTANT'
    && message.status === 'COMPLETED'
    && message.content.trim().length > 0,
  ))

const conversationOptions = computed(() =>
  conversations.value.map(conversation => ({
    label: conversation.title || '未命名会话',
    value: conversation.id,
  })))

function resetForm(): void {
  conversations.value = []
  selectedConversationId.value = ''
  messages.value = []
  selectedMessageIds.value = []
  reportType.value = 'energy_design'
}

async function loadConversations(): Promise<void> {
  conversationsLoading.value = true
  try {
    const result = await fetchProjectConversations(props.projectId, { page: 1, pageSize: 100 })
    conversations.value = result.items
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    conversationsLoading.value = false
  }
}

async function loadMessages(conversationId: string): Promise<void> {
  messagesLoading.value = true
  selectedMessageIds.value = []
  try {
    messages.value = await fetchConversationMessages(conversationId)
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    messagesLoading.value = false
  }
}

function handleConversationChange(value: unknown): void {
  const conversationId = String(value ?? '')
  selectedConversationId.value = conversationId
  if (conversationId) {
    void loadMessages(conversationId)
  }
  else {
    messages.value = []
    selectedMessageIds.value = []
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    resetForm()
    void loadConversations()
  }
})

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (submitting.value) {
    return
  }
  if (!selectedConversationId.value) {
    await feedback.message('warning', '请选择来源 AI 会话')
    return
  }
  submitting.value = true
  try {
    const result = await createReport({
      projectId: props.projectId,
      conversationId: selectedConversationId.value,
      reportType: reportType.value,
      sourceMessageIds: selectedMessageIds.value,
    })
    feedback.message('success', result.message)
    close()
    emit('success')
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <t-dialog
    cancel-btn="取消"
    :confirm-btn="{ content: '创建报告', loading: submitting }"
    header="创建报告"
    :visible="visible"
    width="640px"
    @cancel="close"
    @close="close"
    @confirm="submit"
    @update:visible="emit('update:visible', $event)"
  >
    <t-form label-align="top">
      <t-form-item label="来源 AI 会话">
        <t-select
          v-model="selectedConversationId"
          :loading="conversationsLoading"
          :options="conversationOptions"
          placeholder="请选择生成报告所基于的 AI 会话"
          @change="handleConversationChange"
        />
      </t-form-item>

      <t-form-item label="报告类型">
        <t-radio-group v-model="reportType" variant="default-filled">
          <t-radio-button
            v-for="option in reportTypeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </t-radio-button>
        </t-radio-group>
        <p class="report-create-dialog__hint">
          {{ REPORT_TYPE_META[reportType].description }}
        </p>
      </t-form-item>

      <t-form-item v-if="selectedConversationId" label="来源回答">
        <template v-if="messagesLoading">
          <t-loading text="正在加载回答..." />
        </template>
        <template v-else>
          <t-checkbox-group v-model="selectedMessageIds">
            <div v-if="selectableMessages.length === 0" class="report-create-dialog__empty">
              该会话暂无已完成的 AI 回答，可提交空来源生成空白报告草稿。
            </div>
            <label
              v-for="message in selectableMessages"
              :key="message.id"
              class="report-create-dialog__message"
            >
              <t-checkbox :value="message.id" />
              <span class="report-create-dialog__message-meta">
                {{ formatDate(new Date(message.createdAt)) }}
                <template v-if="message.model">
                  · {{ message.model }}
                </template>
              </span>
              <span class="report-create-dialog__message-preview">
                {{ message.content.slice(0, 120) }}
              </span>
            </label>
          </t-checkbox-group>
          <p class="report-create-dialog__hint">
            最多选择 20 条回答作为报告素材；不选择时生成空白报告草稿。
          </p>
        </template>
      </t-form-item>
    </t-form>
  </t-dialog>
</template>

<style scoped>
.report-create-dialog__hint {
  width: 100%;
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-create-dialog__empty {
  padding: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-create-dialog__message {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: var(--td-size-2);
  padding: var(--td-size-2) 0;
}

.report-create-dialog__message-meta {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-create-dialog__message-preview {
  min-width: 0;
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>