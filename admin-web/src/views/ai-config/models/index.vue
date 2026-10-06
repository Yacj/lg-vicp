<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiModelForm } from '@/composables/useAiModelManagement'
import type { AiModel, AiModelTestResult } from '@/types/ai'
import type { AppTableAction } from '@/types/crud'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiModelManagement } from '@/composables/useAiModelManagement'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  AI_REASONING_LEVEL_OPTIONS,
  buildAdmissionCheckRows,
  canEnableModel,
  canSetDefaultModel,
  classifyModelTestFailure,
  ENABLE_MODEL_REQUIRES_TEST_HINT,
  getAiReasoningLevelLabel,
  getDisplayedTestStatusLabel,
  getDisplayedTestStatusTone,
  getProviderBaseUrlPreview,
  getProviderCredentialPreview,
  isModelIdentityChanged,
  isToolCallingBlocked,
  MODEL_PROMPT_DUTY_HINT,
  MODEL_PROMPT_DUTY_PATH,
  resolveDisplayedTestStatus,
  resolveSelectedProvider,
  TOOL_CALLING_BLOCKED_HINT,
} from '@/utils/ai-model'
import { formatDate } from '@/utils/day'

const {
  loadProviders,
  modelDefaultAction,
  modelDeleteAction,
  modelDrawer,
  modelList,
  modelStatusAction,
  providerNameById,
  providerOptions,
  providers,
  providersLoadError,
  providersLoading,
  testModel,
  testingModelId,
} = useAiModelManagement()
const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()

const rows = modelList.data
const tableStatus = modelList.tableStatus
const drawerVisible = modelDrawer.visible
const drawerMode = modelDrawer.mode
const drawerSubmitting = modelDrawer.isSubmitting
const statusRunning = modelStatusAction.running
const defaultRunning = modelDefaultAction.running
const deleteRunning = modelDeleteAction.running

const canAddModel = computed(() => canAccess({ permissions: ['system:ai:model:add'] }))
const canEditModel = computed(() => canAccess({ permissions: ['system:ai:model:edit'] }))
const canRemoveModel = computed(() => canAccess({ permissions: ['system:ai:model:remove'] }))
const canTestModel = computed(() => canAccess({ permissions: ['system:ai:model:test'] }))

const defaultModel = computed(() => (rows.value as AiModel[]).find(model => model.isDefault) ?? null)

const editingModel = computed(() => {
  const current = modelDrawer.entity.value
  if (!current) {
    return null
  }
  return (rows.value as AiModel[]).find(model => model.id === current.id) ?? current
})

const identityChanged = computed(() => {
  const original = modelDrawer.entity.value
  if (!original || drawerMode.value !== 'edit') {
    return false
  }
  return isModelIdentityChanged(original, modelDrawer.formData)
})

const formTestStatus = computed(() => resolveDisplayedTestStatus(
  editingModel.value?.lastTestStatus,
  identityChanged.value,
))

const selectedProvider = computed(() =>
  resolveSelectedProvider(providers.value, modelDrawer.formData.providerId))

const formAdmissionReport = ref<AiModelTestResult | null>(null)
const formCheckRows = computed(() => buildAdmissionCheckRows(
  formAdmissionReport.value,
  modelDrawer.formData.supportsVision,
))

watch(drawerVisible, (visible) => {
  formAdmissionReport.value = null
  if (visible && providers.value.length === 0 && !providersLoadError.value) {
    void loadProviders()
  }
})

watch(
  () => [
    modelDrawer.formData.providerId,
    modelDrawer.formData.modelId,
    modelDrawer.formData.supportsVision,
    modelDrawer.formData.reasoningLevel,
  ] as const,
  () => {
    if (!identityChanged.value) {
      return
    }
    formAdmissionReport.value = null
    if (modelDrawer.formData.enabled) {
      modelDrawer.formData.enabled = false
    }
    if (modelDrawer.formData.isDefault) {
      modelDrawer.formData.isDefault = false
    }
  },
)

onMounted(() => {
  void loadProviders()
})

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const rules = computed<FormRules<AiModelForm>>(() => ({
  providerId: [{ message: '请选择 Provider', required: true }],
  displayName: [
    { message: '请输入模型名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
  modelId: [
    { message: '请输入 Model ID', required: true },
    { max: 160, message: 'Model ID 不能超过 160 个字符' },
  ],
}))

function providerLabel(model: AiModel): string {
  return model.providerName
    ?? providerNameById.value.get(model.providerId)
    ?? model.provider
    ?? '-'
}

function listTestStatus(model: AiModel) {
  return resolveDisplayedTestStatus(model.lastTestStatus, false)
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const model = row as AiModel
      return h('div', { class: 'ai-model-page__name' }, [
        h('span', model.displayName),
        model.isDefault
          ? h(AppStatusTag, { label: '默认', status: 'success' })
          : null,
      ])
    },
    colKey: 'displayName',
    minWidth: 180,
    title: '模型名称',
  },
  {
    cell: (_h, { row }) => providerLabel(row as AiModel),
    colKey: 'provider',
    minWidth: 120,
    title: 'Provider',
  },
  {
    cell: (_h, { row }) => h('code', { class: 'ai-model-page__code' }, (row as AiModel).modelId),
    colKey: 'modelId',
    minWidth: 160,
    title: 'Model ID',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiModel).supportsVision ? '支持' : '未启用',
      status: (row as AiModel).supportsVision ? 'success' : 'disabled',
    }),
    colKey: 'supportsVision',
    title: '图片输入',
    width: 110,
  },
  {
    cell: (_h, { row }) => getAiReasoningLevelLabel((row as AiModel).reasoningLevel),
    colKey: 'reasoningLevel',
    title: '推理强度',
    width: 100,
  },
  {
    cell: (_h, { row }) => {
      const status = listTestStatus(row as AiModel)
      return h(AppStatusTag, {
        label: getDisplayedTestStatusLabel(status),
        status: getDisplayedTestStatusTone(status),
      })
    },
    colKey: 'lastTestStatus',
    title: '检测状态',
    width: 120,
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiModel).enabled ? '启用' : '停用',
      status: (row as AiModel).enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 90,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as AiModel).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

const errorDescription = computed(() => modelList.error.value
  ? normalizeFeedbackError(modelList.error.value).message
  : '请检查网络连接后重试')

const testResultVisible = ref(false)
const testReport = ref<AiModelTestResult | null>(null)
const testError = ref<unknown>(null)
const testedSupportsVision = ref(false)

const dialogCheckRows = computed(() => buildAdmissionCheckRows(
  testReport.value,
  testedSupportsVision.value,
))
const dialogFailure = computed(() => {
  if (testReport.value && !testReport.value.ok) {
    return classifyModelTestFailure({ report: testReport.value })
  }
  if (testError.value) {
    return classifyModelTestFailure({ error: testError.value })
  }
  return null
})

async function runModelTest(model: AiModel, source: 'list' | 'form'): Promise<void> {
  testError.value = null
  try {
    const result = await testModel(model)
    testReport.value = result
    testedSupportsVision.value = model.supportsVision
    if (source === 'form') {
      formAdmissionReport.value = result
    }
    else {
      testResultVisible.value = true
    }
    if (!result.ok) {
      await feedback.message('warning', classifyModelTestFailure({ report: result }).label)
    }
  }
  catch (error) {
    testError.value = error
    testReport.value = null
    testedSupportsVision.value = model.supportsVision
    if (source === 'form') {
      formAdmissionReport.value = null
    }
    testResultVisible.value = true
    await feedback.message('error', classifyModelTestFailure({ error }).label)
  }
}

function onEnabledChange(value: boolean): void {
  if (value && !canEnableModel(formTestStatus.value)) {
    modelDrawer.formData.enabled = false
    void feedback.message('warning', ENABLE_MODEL_REQUIRES_TEST_HINT)
    return
  }
  modelDrawer.formData.enabled = value
  if (!value) {
    modelDrawer.formData.isDefault = false
  }
}

function onDefaultChange(value: boolean): void {
  const current = editingModel.value
  if (value && (!current || !canSetDefaultModel({
    enabled: modelDrawer.formData.enabled,
    lastTestStatus: current.lastTestStatus,
  }, identityChanged.value))) {
    modelDrawer.formData.isDefault = false
    void feedback.message('warning', ENABLE_MODEL_REQUIRES_TEST_HINT)
    return
  }
  modelDrawer.formData.isDefault = value
}

async function handleToggleEnabled(model: AiModel): Promise<void> {
  if (!model.enabled && !canEnableModel(listTestStatus(model))) {
    await feedback.message('warning', ENABLE_MODEL_REQUIRES_TEST_HINT)
    return
  }
  await modelStatusAction.run({ enabled: !model.enabled, model })
}

async function handleSetDefault(model: AiModel): Promise<void> {
  if (!canSetDefaultModel(model)) {
    await feedback.message('warning', ENABLE_MODEL_REQUIRES_TEST_HINT)
    return
  }
  await modelDefaultAction.run(model)
}

const canTestCurrentForm = computed(() =>
  canTestModel.value
  && drawerMode.value === 'edit'
  && Boolean(modelDrawer.entity.value)
  && !identityChanged.value)

function getActions(row: TableRowData): AppTableAction[] {
  const model = row as AiModel
  const actions: AppTableAction[] = []
  if (canTestModel.value) {
    actions.push({
      handler: () => void runModelTest(model, 'list'),
      key: 'test',
      label: '测试模型',
      loading: testingModelId.value === model.id,
    })
  }
  if (canEditModel.value) {
    actions.push({
      handler: () => modelDrawer.openEdit(model),
      key: 'edit',
      label: '编辑',
    })
    actions.push({
      handler: () => void handleToggleEnabled(model),
      key: 'status',
      label: model.enabled ? '停用' : '启用',
      loading: statusRunning.value,
      theme: model.enabled ? 'warning' : 'success',
    })
    if (!model.isDefault) {
      actions.push({
        handler: () => void handleSetDefault(model),
        key: 'default',
        label: '设为默认',
        loading: defaultRunning.value,
      })
    }
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
  <AppPage
    description="配置系统使用的模型身份、接口凭证、图片输入和默认推理强度。"
    title="模型配置"
  >
    <section v-if="defaultModel" class="ai-model-page__default">
      <span class="ai-model-page__default-label">当前默认模型</span>
      <strong class="ai-model-page__default-name">{{ defaultModel.displayName }}</strong>
      <AppStatusTag
        :label="getDisplayedTestStatusLabel(listTestStatus(defaultModel))"
        :status="getDisplayedTestStatusTone(listTestStatus(defaultModel))"
      />
      <AppStatusTag
        :label="defaultModel.enabled ? '启用' : '停用'"
        :status="defaultModel.enabled ? 'success' : 'warning'"
      />
    </section>
    <t-alert
      v-else
      theme="info"
      title="尚未设置默认模型。只有已启用且检测正常的模型可以设为默认。"
    />

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
            placeholder="模型名称、Provider 或 Model ID"
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
      :form-data="modelDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增模型' : '编辑模型'"
      :visible="drawerVisible"
      width="min(560px, 92vw)"
      @cancel="modelDrawer.close"
      @submit="modelDrawer.submit"
      @update:visible="modelDrawer.setVisible"
    >
      <t-alert class="ai-model-page__prompt-hint" theme="info">
        {{ MODEL_PROMPT_DUTY_HINT }}
        <template #operation>
          <RouterLink class="ai-model-page__prompt-link" :to="MODEL_PROMPT_DUTY_PATH">
            前往提示词配置
          </RouterLink>
        </template>
      </t-alert>

      <section class="ai-model-page__section">
        <h3 class="ai-model-page__section-title">
          基础信息
        </h3>
        <t-form-item label="模型名称" name="displayName">
          <t-input
            v-model="modelDrawer.formData.displayName"
            maxlength="120"
            placeholder="例如：DeepSeek Chat"
          />
        </t-form-item>
        <t-form-item label="Provider" name="providerId">
          <t-select
            v-model="modelDrawer.formData.providerId"
            :loading="providersLoading"
            :options="providerOptions"
            placeholder="请选择 Provider"
          />
        </t-form-item>
        <t-form-item label="Model ID" name="modelId">
          <t-input
            v-model="modelDrawer.formData.modelId"
            maxlength="160"
            placeholder="例如：deepseek-chat"
          />
        </t-form-item>
        <t-form-item label="API Base URL">
          <t-input
            :model-value="getProviderBaseUrlPreview(selectedProvider)"
            disabled
            placeholder="选择 Provider 后显示接口地址"
          />
        </t-form-item>
        <t-form-item label="API凭证">
          <t-input
            :model-value="getProviderCredentialPreview(selectedProvider)"
            disabled
            placeholder="选择 Provider 后显示凭证状态"
          />
        </t-form-item>
      </section>

      <section class="ai-model-page__section">
        <h3 class="ai-model-page__section-title">
          模型设置
        </h3>
        <t-form-item label="支持图片输入" name="supportsVision">
          <t-switch v-model="modelDrawer.formData.supportsVision" />
        </t-form-item>
      </section>

      <section class="ai-model-page__section">
        <h3 class="ai-model-page__section-title">
          推理强度
        </h3>
        <t-form-item name="reasoningLevel">
          <t-radio-group
            v-model="modelDrawer.formData.reasoningLevel"
            class="ai-model-page__reasoning"
            direction="vertical"
          >
            <t-radio
              v-for="option in AI_REASONING_LEVEL_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              <span class="ai-model-page__reasoning-label">{{ option.label }}</span>
              <span class="ai-model-page__reasoning-hint">{{ option.hint }}</span>
            </t-radio>
          </t-radio-group>
        </t-form-item>
      </section>

      <section class="ai-model-page__section">
        <h3 class="ai-model-page__section-title">
          状态
        </h3>
        <t-form-item label="启用" name="enabled">
          <t-switch
            :model-value="modelDrawer.formData.enabled"
            @change="onEnabledChange(Boolean($event))"
          />
        </t-form-item>
        <t-form-item
          v-if="drawerMode === 'edit'"
          label="设为默认"
          name="isDefault"
        >
          <t-switch
            :model-value="modelDrawer.formData.isDefault"
            @change="onDefaultChange(Boolean($event))"
          />
        </t-form-item>
      </section>

      <section class="ai-model-page__section">
        <h3 class="ai-model-page__section-title">
          模型检测
        </h3>
        <div class="ai-model-page__test-status">
          <span>测试状态</span>
          <AppStatusTag
            :label="getDisplayedTestStatusLabel(formTestStatus)"
            :status="getDisplayedTestStatusTone(formTestStatus)"
          />
        </div>
        <ul v-if="formAdmissionReport" class="ai-model-page__checks">
          <li
            v-for="row in formCheckRows"
            :key="row.key"
            class="ai-model-page__check"
            :class="`is-${row.state}`"
          >
            <span>{{ row.state === 'ok' ? '✓' : row.state === 'failed' ? '×' : '–' }} {{ row.label }}</span>
            <strong>{{ row.message }}</strong>
          </li>
        </ul>
        <t-alert
          v-if="isToolCallingBlocked(formAdmissionReport)"
          theme="error"
          :title="TOOL_CALLING_BLOCKED_HINT"
        />
        <t-button
          :disabled="!canTestCurrentForm"
          :loading="Boolean(editingModel) && testingModelId === editingModel?.id"
          theme="primary"
          variant="outline"
          @click="editingModel && runModelTest(editingModel, 'form')"
        >
          测试模型
        </t-button>
        <p v-if="drawerMode === 'create'" class="ai-model-page__test-hint">
          请先保存模型后再检测。
        </p>
        <p v-else-if="identityChanged" class="ai-model-page__test-hint">
          关键配置已变化，请先保存后再重新检测。
        </p>
      </section>
    </AppCrudFormDialog>

    <t-dialog
      :cancel-btn="null"
      confirm-text="关闭"
      header="模型检测"
      :visible="testResultVisible"
      width="min(560px, 92vw)"
      @confirm="testResultVisible = false"
      @close="testResultVisible = false"
    >
      <t-alert
        v-if="dialogFailure"
        class="ai-model-page__test-alert"
        theme="error"
        :title="dialogFailure.label"
        :message="dialogFailure.message"
      />
      <t-alert
        v-else-if="testReport?.ok"
        class="ai-model-page__test-alert"
        theme="success"
        title="模型检测正常"
      />
      <ul class="ai-model-page__checks">
        <li
          v-for="row in dialogCheckRows"
          :key="row.key"
          class="ai-model-page__check"
          :class="`is-${row.state}`"
        >
          <span>{{ row.state === 'ok' ? '✓' : row.state === 'failed' ? '×' : '–' }} {{ row.label }}</span>
          <strong>{{ row.message }}</strong>
        </li>
      </ul>
      <t-alert
        v-if="isToolCallingBlocked(testReport)"
        theme="error"
        :title="TOOL_CALLING_BLOCKED_HINT"
      />
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.ai-model-page__default {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-3);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.ai-model-page__default-label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__default-name {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.ai-model-page__name {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.ai-model-page__code {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__prompt-hint {
  grid-column: 1 / -1;
}

.ai-model-page__prompt-link {
  color: var(--td-brand-color);
}

.ai-model-page__section {
  display: grid;
  grid-column: 1 / -1;
  gap: var(--td-size-4);
  padding-top: var(--td-size-2);
  border-top: 1px solid var(--td-component-stroke);
}

.ai-model-page__section:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.ai-model-page__section-title {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.ai-model-page__reasoning {
  width: 100%;
}

.ai-model-page__reasoning :deep(.t-radio) {
  align-items: flex-start;
}

.ai-model-page__reasoning-label,
.ai-model-page__reasoning-hint {
  display: block;
}

.ai-model-page__reasoning-hint {
  margin-top: var(--td-size-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__test-status {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  color: var(--td-text-color-secondary);
}

.ai-model-page__checks {
  display: grid;
  gap: var(--td-size-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-model-page__check {
  display: flex;
  justify-content: space-between;
  gap: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__check.is-ok {
  color: var(--td-success-color);
}

.ai-model-page__check.is-failed {
  color: var(--td-error-color);
}

.ai-model-page__test-hint {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-model-page__test-alert {
  margin-bottom: var(--td-size-4);
}
</style>
