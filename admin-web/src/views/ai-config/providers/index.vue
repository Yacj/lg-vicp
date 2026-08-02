<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiProviderForm } from '@/composables/useAiProviderManagement'
import type { AiProvider } from '@/types/ai'
import type { AppTableAction } from '@/types/crud'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiProviderManagement } from '@/composables/useAiProviderManagement'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { formatDate } from '@/utils/day'

const {
  closeTestResult,
  providerDeleteAction,
  providerDrawer,
  providerList,
  providerStatusAction,
  retryLastTest,
  runConnectionTest,
  testOutcome,
  testResultVisible,
  testingProviderId,
} = useAiProviderManagement()
const { canAccess } = usePermissionAccess()

const rows = providerList.data
const tableStatus = providerList.tableStatus
const drawerVisible = providerDrawer.visible
const drawerMode = providerDrawer.mode
const drawerSubmitting = providerDrawer.isSubmitting
const statusRunning = providerStatusAction.running
const deleteRunning = providerDeleteAction.running
const testingRunning = computed(() => testingProviderId.value !== null)

const canAddProvider = computed(() => canAccess({ permissions: ['system:ai:provider:add'] }))
const canEditProvider = computed(() => canAccess({ permissions: ['system:ai:provider:edit'] }))
const canRemoveProvider = computed(() => canAccess({ permissions: ['system:ai:provider:remove'] }))
const canTestProvider = computed(() => canAccess({ permissions: ['system:ai:provider:test'] }))

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const rules = computed<FormRules<AiProviderForm>>(() => ({
  name: [
    { message: '请输入服务商名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
  baseUrl: [
    { message: '请输入 API 地址', required: true },
    { message: '请输入合法的 HTTP(S) 地址', pattern: /^https?:\/\/.+/i },
  ],
  apiKey: [{
    message: '新增服务商必须填写 API Key',
    required: drawerMode.value === 'create',
  }],
  description: [{
    message: '描述不能超过 500 个字符',
    validator: value => value === null || value === undefined || value === '' || String(value).length <= 500,
  }],
  timeoutMs: [{
    message: '响应等待时间应在 1000 到 300000（毫秒）之间',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1000 && Number(value) <= 300000),
  }],
  priority: [{
    message: '优先级应为 0 到 9999 的整数',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 9999),
  }],
}))

function providerTypeLabel(provider: AiProvider): string {
  return provider.type === 'OPENAI_COMPATIBLE' ? 'OpenAI 兼容' : provider.type
}

function lastTestStatusLabel(provider: AiProvider): string {
  return provider.lastTestStatus === 'OK' ? '成功' : provider.lastTestStatus === 'FAILED' ? '失败' : '未测试'
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 160, title: '服务商名称' },
  {
    cell: (_h, { row }) => providerTypeLabel(row as AiProvider),
    colKey: 'type',
    minWidth: 110,
    title: '类型',
  },
  {
    cell: (_h, { row }) => h('code', { class: 'ai-provider-page__url' }, (row as AiProvider).baseUrl),
    colKey: 'baseUrl',
    minWidth: 220,
    title: 'API 地址',
  },
  {
    cell: (_h, { row }) => {
      const provider = row as AiProvider
      return provider.apiKeyMasked
        ? h('code', { class: 'ai-provider-page__key' }, provider.apiKeyMasked)
        : h(AppStatusTag, { label: '未配置', status: 'warning' })
    },
    colKey: 'apiKeyMasked',
    minWidth: 140,
    title: 'API Key',
  },
  {
    cell: (_h, { row }) => String((row as AiProvider).priority ?? '-'),
    colKey: 'priority',
    title: '优先级',
    width: 90,
  },
  {
    cell: (_h, { row }) => {
      const provider = row as AiProvider
      if (!provider.lastTestAt) {
        return '-'
      }
      return h(AppStatusTag, {
        label: lastTestStatusLabel(provider),
        status: provider.lastTestStatus === 'OK' ? 'success' : 'error',
      })
    },
    colKey: 'lastTestStatus',
    minWidth: 110,
    title: '最近测试',
  },
  {
    cell: (_h, { row }) => {
      const provider = row as AiProvider
      return provider.lastTestAt ? formatDate(new Date(provider.lastTestAt)) : '-'
    },
    colKey: 'lastTestAt',
    minWidth: 160,
    title: '测试时间',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiProvider).enabled ? '启用' : '停用',
      status: (row as AiProvider).enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 90,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as AiProvider).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 170,
  },
]

const errorDescription = computed(() => providerList.error.value
  ? normalizeFeedbackError(providerList.error.value).message
  : '请检查网络连接后重试')

function getActions(row: TableRowData): AppTableAction[] {
  const provider = row as AiProvider
  const actions: AppTableAction[] = []
  if (canTestProvider.value) {
    actions.push({
      handler: () => void runConnectionTest(provider),
      key: 'test',
      label: '测试连接',
      loading: testingProviderId.value === provider.id,
    })
  }
  if (canEditProvider.value) {
    actions.push(
      {
        handler: () => providerDrawer.openEdit(provider),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => providerStatusAction.run({ enabled: !provider.enabled, provider }),
        key: 'status',
        label: provider.enabled ? '停用' : '启用',
        loading: statusRunning.value,
        theme: provider.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveProvider.value) {
    actions.push({
      handler: () => providerDeleteAction.run(provider),
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
        :loading="providerList.isLoading.value"
        @reset="providerList.reset"
        @search="providerList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="providerList.query.keyword"
            clearable
            placeholder="服务商名称或 API 地址"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="providerList.query.status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="rows"
      empty-description="可新增第一个 AI 服务商"
      empty-title="暂无服务商"
      :error-description="errorDescription"
      row-key="id"
      :status="tableStatus"
      @refresh="providerList.refresh"
      @retry="providerList.retry"
    >
      <template v-if="canAddProvider" #toolbar>
        <t-button theme="primary" @click="providerDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增服务商
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      description="API Key 仅用于后端发起 AI 请求，保存后不可回显；编辑时留空表示保留原密钥。"
      :form-data="providerDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增服务商' : '编辑服务商'"
      :visible="drawerVisible"
      @cancel="providerDrawer.close"
      @submit="providerDrawer.submit"
      @update:visible="providerDrawer.setVisible"
    >
      <t-form-item label="服务商名称" name="name">
        <t-input
          v-model="providerDrawer.formData.name"
          maxlength="120"
          placeholder="例如：DeepSeek"
        />
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="服务商描述" name="description">
        <t-input
          v-model="providerDrawer.formData.description"
          maxlength="500"
          placeholder="选填：说明服务商用途或接入方"
        />
      </t-form-item>
      <t-form-item label="API 地址" name="baseUrl">
        <t-input
          v-model="providerDrawer.formData.baseUrl"
          placeholder="https://api.deepseek.com/v1"
        />
      </t-form-item>
      <t-form-item
        :label="drawerMode === 'create' ? 'API Key' : 'API Key（留空保留原密钥）'"
        name="apiKey"
      >
        <t-input
          v-model="providerDrawer.formData.apiKey"
          autocomplete="new-password"
          placeholder="sk-..."
          type="password"
        />
      </t-form-item>
      <t-form-item
        label="响应等待时间"
        name="timeoutMs"
        help="等待服务商返回的最大时长，超过则本次请求判定失败；单位为毫秒（1000 毫秒 = 1 秒），范围 1000-300000。留空使用系统默认值。"
      >
        <t-input-number
          v-model="providerDrawer.formData.timeoutMs"
          class="ai-provider-page__input-number"
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
        help="数值越小越优先使用；留空由系统默认排序。"
      >
        <t-input-number
          v-model="providerDrawer.formData.priority"
          class="ai-provider-page__input-number"
          :max="9999"
          :min="0"
          placeholder="0-9999"
          theme="column"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-radio-group v-model="providerDrawer.formData.enabled" variant="default-filled">
          <t-radio :value="true">
            启用
          </t-radio>
          <t-radio :value="false">
            停用
          </t-radio>
        </t-radio-group>
      </t-form-item>
    </AppCrudFormDialog>

    <t-dialog
      :cancel-btn="null"
      confirm-text="关闭"
      :header="testOutcome?.success ? '连接测试成功' : '连接测试失败'"
      :visible="testResultVisible"
      width="min(560px, 92vw)"
      @close="closeTestResult"
      @confirm="closeTestResult"
    >
      <template v-if="testOutcome">
        <p class="ai-provider-page__test-meta">
          {{ testOutcome.providerName }} · 耗时 {{ testOutcome.durationMs }} ms
        </p>
        <t-alert
          v-if="testOutcome.success"
          class="ai-provider-page__test-response"
          theme="success"
          :title="testOutcome.response || testOutcome.message"
        />
        <template v-else>
          <t-alert class="ai-provider-page__test-response" theme="error" :title="testOutcome.message" />
          <p v-if="testOutcome.requestId" class="ai-provider-page__test-request-id">
            请求 ID：{{ testOutcome.requestId }}
          </p>
          <t-button :loading="testingRunning" theme="primary" variant="outline" @click="retryLastTest">
            重试
          </t-button>
        </template>
      </template>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.ai-provider-page__url {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-provider-page__key {
  padding: 0 var(--td-size-1);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-provider-page__input-number {
  width: 100%;
}

.ai-provider-page__test-meta {
  margin: 0 0 var(--td-comp-margin-m);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-provider-page__test-response {
  margin-bottom: var(--td-comp-margin-m);
  white-space: pre-wrap;
}

.ai-provider-page__test-request-id {
  margin: 0 0 var(--td-comp-margin-m);
  color: var(--td-text-color-secondary);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}
</style>
