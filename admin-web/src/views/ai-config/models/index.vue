<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiModelForm } from '@/composables/useAiModelManagement'
import type { AiConnectionTestResult, AiModel } from '@/types/ai'
import type { AppTableAction } from '@/types/crud'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref, watch } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import {
  AI_MODEL_CAPABILITY_META,
  useAiModelManagement,
} from '@/composables/useAiModelManagement'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { getAiModelCapabilityLabels } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const {
  loadProviders,
  modelDeleteAction,
  modelDrawer,
  modelList,
  modelStatusAction,
  providerNameById,
  providerOptions,
  providers,
  providersLoadError,
  providersLoading,
  testConnection,
  testingModelId,
} = useAiModelManagement()
const { canAccess } = usePermissionAccess()

const rows = modelList.data
const tableStatus = modelList.tableStatus
const drawerVisible = modelDrawer.visible
const drawerMode = modelDrawer.mode
const drawerSubmitting = modelDrawer.isSubmitting
const statusRunning = modelStatusAction.running
const deleteRunning = modelDeleteAction.running

const canAddModel = computed(() => canAccess({ permissions: ['system:ai:model:add'] }))
const canEditModel = computed(() => canAccess({ permissions: ['system:ai:model:edit'] }))
const canRemoveModel = computed(() => canAccess({ permissions: ['system:ai:model:remove'] }))
const canTestModel = computed(() => canAccess({ permissions: ['system:ai:model:test'] }))

/** 打开模型表单前确保服务商选项已加载。 */
watch(drawerVisible, (visible) => {
  if (visible && providers.value.length === 0 && !providersLoadError.value) {
    void loadProviders()
  }
})

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const rules = computed<FormRules<AiModelForm>>(() => ({
  providerId: [{ message: '请选择服务商', required: true }],
  displayName: [
    { message: '请输入模型名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
  modelId: [
    { message: '请输入模型编码', required: true },
    { max: 160, message: '编码不能超过 160 个字符' },
  ],
  description: [{
    message: '描述不能超过 500 个字符',
    validator: value => value === null || value === undefined || value === '' || String(value).length <= 500,
  }],
  priority: [{
    message: '优先级应为 0 到 9999 的整数',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 9999),
  }],
  contextWindow: [{
    message: '记忆容量应为大于 0 的整数',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) > 0),
  }],
  maxOutputTokens: [{
    message: '单次回答长度应为大于 0 的整数',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) > 0),
  }],
  defaultTemperature: [{
    message: '回答风格取值应在 0 到 2 之间',
    validator: value => value === null || value === undefined || value === '' || (Number(value) >= 0 && Number(value) <= 2),
  }],
  timeoutMs: [{
    message: '响应等待时间应在 1000 到 300000（毫秒）之间',
    validator: value => Number.isInteger(Number(value)) && Number(value) >= 1000 && Number(value) <= 300000,
  }],
}))

function capabilityTags(model: AiModel): string[] {
  return getAiModelCapabilityLabels(model.capabilities)
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 160, title: '模型名称' },
  {
    cell: (_h, { row }) => h('code', { class: 'ai-model-page__code' }, (row as AiModel).modelId),
    colKey: 'modelId',
    minWidth: 180,
    title: '模型编码',
  },
  {
    cell: (_h, { row }) => providerNameById.value.get((row as AiModel).providerId) ?? '-',
    colKey: 'providerId',
    minWidth: 140,
    title: '服务商',
  },
  {
    cell: (_h, { row }) => {
      const value = (row as AiModel).contextWindow
      return value === null || value === undefined ? '-' : String(value)
    },
    colKey: 'contextWindow',
    minWidth: 120,
    title: '记忆容量',
  },
  {
    cell: (_h, { row }) => String((row as AiModel).priority ?? '-'),
    colKey: 'priority',
    title: '优先级',
    width: 90,
  },
  {
    cell: (_h, { row }) => h(
      'div',
      { class: 'ai-model-page__capabilities' },
      capabilityTags(row as AiModel).map(tag => h('span', { class: 'ai-model-page__capability-tag' }, tag)),
    ),
    colKey: 'capabilities',
    minWidth: 200,
    title: '能力',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiModel).enabled ? '启用' : '停用',
      status: (row as AiModel).enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 100,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as AiModel).createdAt)),
    colKey: 'createdAt',
    title: '创建时间',
    width: 180,
  },
]

const errorDescription = computed(() => modelList.error.value
  ? normalizeFeedbackError(modelList.error.value).message
  : '请检查网络连接后重试')

/** 连通性测试结果弹窗。 */
const testResultVisible = ref(false)
const testResult = ref<AiConnectionTestResult | null>(null)
const feedback = useAppFeedback()

async function runConnectionTest(model: AiModel): Promise<void> {
  try {
    const result = await testConnection(model)
    testResult.value = result
    testResultVisible.value = true
  }
  catch (error) {
    await feedback.messageError(error)
  }
}

function getActions(row: TableRowData): AppTableAction[] {
  const model = row as AiModel
  const actions: AppTableAction[] = []
  if (canTestModel.value) {
    actions.push({
      handler: () => void runConnectionTest(model),
      key: 'test',
      label: '连通性测试',
      loading: testingModelId.value === model.id,
    })
  }
  if (canEditModel.value) {
    actions.push(
      {
        handler: () => modelDrawer.openEdit(model),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => modelStatusAction.run({ enabled: !model.enabled, model }),
        key: 'status',
        label: model.enabled ? '停用' : '启用',
        loading: statusRunning.value,
        theme: model.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveModel.value) {
    actions.push({
      handler: () => modelDeleteAction.run(model),
      key: 'remove',
      label: '删除',
      loading: deleteRunning.value,
      theme: 'danger',
    })
  }
  return actions
}
</script>

<template>
  <AppPage>
    <template #search>
      <AppSearchPanel
        :loading="modelList.isLoading.value"
        @reset="modelList.reset"
        @search="modelList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="modelList.query.keyword"
            clearable
            placeholder="模型名称或编码"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="modelList.query.status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="rows"
      empty-description="可新增第一个 AI 模型"
      empty-title="暂无模型"
      :error-description="errorDescription"
      row-key="id"
      :status="tableStatus"
      @refresh="modelList.refresh"
      @retry="modelList.retry"
    >
      <template v-if="canAddModel" #toolbar>
        <t-button theme="primary" @click="modelDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增模型
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      description="模型编码需与服务商平台一致；能力开关决定该模型在场景中的可用行为。"
      :form-data="modelDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增模型' : '编辑模型'"
      :visible="drawerVisible"
      width="min(760px, 92vw)"
      @cancel="modelDrawer.close"
      @submit="modelDrawer.submit"
      @update:visible="modelDrawer.setVisible"
    >
      <template #default="{ readonly }">
        <t-form-item label="服务商" name="providerId">
          <t-select
            v-model="modelDrawer.formData.providerId"
            :disabled="readonly"
            :loading="providersLoading"
            :options="providerOptions"
            placeholder="请选择服务商"
          />
        </t-form-item>
        <t-form-item label="模型名称" name="displayName">
          <t-input
            v-model="modelDrawer.formData.displayName"
            maxlength="120"
            placeholder="例如：DeepSeek R1"
          />
        </t-form-item>
        <t-form-item label="模型编码" name="modelId">
          <t-input
            v-model="modelDrawer.formData.modelId"
            maxlength="160"
            placeholder="例如：deepseek-reasoner"
          />
        </t-form-item>
        <t-form-item class="vicp-form-grid-item--wide" label="模型描述" name="description">
          <t-input
            v-model="modelDrawer.formData.description"
            maxlength="500"
            placeholder="选填：说明模型用途或适用场景"
          />
        </t-form-item>
        <t-form-item
          label="记忆容量"
          name="contextWindow"
          help="模型一次对话能记住的信息量，数值越大越能处理长对话；以 Token 为单位，建议与服务商平台配置一致。"
        >
          <t-input-number
            v-model="modelDrawer.formData.contextWindow"
            class="ai-model-page__input-number"
            :min="1"
            placeholder="例如 65536"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="单次回答长度"
          name="maxOutputTokens"
          help="限制模型单次回复的最大长度（Token），数值越大回答越长；留空使用模型默认值。"
        >
          <t-input-number
            v-model="modelDrawer.formData.maxOutputTokens"
            class="ai-model-page__input-number"
            :min="1"
            placeholder="例如 8192"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="回答风格"
          name="defaultTemperature"
          help="数值越高回答越有创意、越发散；数值越低回答越严谨、稳定（范围 0-2）；留空使用模型默认值。"
        >
          <t-input-number
            v-model="modelDrawer.formData.defaultTemperature"
            class="ai-model-page__input-number"
            :max="2"
            :min="0"
            :step="0.1"
            placeholder="默认由模型决定"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="响应等待时间"
          name="timeoutMs"
          help="等待模型回复的最大时长，超过则本次回答判定失败；单位为毫秒（1000 毫秒 = 1 秒），范围 1000-300000。"
        >
          <t-input-number
            v-model="modelDrawer.formData.timeoutMs"
            class="ai-model-page__input-number"
            :max="300000"
            :min="1000"
            :step="1000"
            placeholder="例如 60000"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="优先级"
          name="priority"
          help="数值越小越优先被场景选用；留空由系统默认排序。"
        >
          <t-input-number
            v-model="modelDrawer.formData.priority"
            class="ai-model-page__input-number"
            :max="9999"
            :min="0"
            placeholder="0-9999"
            theme="column"
          />
        </t-form-item>
        <t-form-item label="状态" name="enabled">
          <t-radio-group v-model="modelDrawer.formData.enabled" variant="default-filled">
            <t-radio :value="true">
              启用
            </t-radio>
            <t-radio :value="false">
              停用
            </t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item class="vicp-form-grid-item--wide" label="能力">
          <div class="ai-model-page__capability-fields">
            <t-checkbox
              v-for="meta in AI_MODEL_CAPABILITY_META"
              :key="meta.key"
              v-model="modelDrawer.formData[meta.key]"
            >
              {{ meta.label }}
            </t-checkbox>
          </div>
        </t-form-item>
      </template>
    </AppCrudFormDialog>

    <t-dialog
      :cancel-btn="null"
      confirm-text="关闭"
      header="连通性测试"
      :visible="testResultVisible"
      width="min(560px, 92vw)"
      @confirm="testResultVisible = false"
      @close="testResultVisible = false"
    >
      <p class="ai-model-page__test-note">
        模型返回结果（固定测试提示词，maxOutputTokens 16）：
      </p>
      <t-alert
        class="ai-model-page__test-response"
        theme="success"
        :title="testResult?.response ?? ''"
      />
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.ai-model-page__code {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-1);
}

.ai-model-page__capability-tag {
  padding: 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-component);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__input-number {
  width: 100%;
}

.ai-model-page__capability-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-4);
}

.ai-model-page__test-note {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__test-response {
  word-break: break-all;
}
</style>
