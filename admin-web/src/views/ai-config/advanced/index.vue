<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiModel } from '@/types/ai'
import { computed, h } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiModelManagement } from '@/composables/useAiModelManagement'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  AGENT_MODEL_UNSET_HINT,
  canAssignAgentModel,
  getRuntimeModelHealthLabel,
  resolveAgentModelSlot,
} from '@/utils/ai'
import {
  AGENT_RUNTIME_LIMITS,
  AGENT_TOOL_CATALOG,
  getAgentToolStatusLabel,
  getAgentToolStatusTone,
  resolveAgentToolStatus,
} from '@/utils/ai-agent'

defineOptions({ name: 'AiConfigAdvanced' })

const { assigningAgent, assignAgentModel, modelList } = useAiModelManagement()
const { canAccess } = usePermissionAccess()

const canEditAgentModel = computed(() => canAccess({ permissions: ['system:ai:model:edit'] }))
const rows = computed(() => modelList.data.value as AiModel[])
const agentSlot = computed(() => resolveAgentModelSlot(rows.value))
const agentEnabled = computed(() => agentSlot.value.status === 'ok')
const toolStatus = computed(() => resolveAgentToolStatus(agentEnabled.value))

const agentModelOptions = computed(() => rows.value
  .filter(model => canAssignAgentModel(model))
  .map(model => ({
    label: model.enabled ? model.displayName : `${model.displayName}（已停用）`,
    value: model.id,
  })))

function onAgentModelChange(value: unknown): void {
  if (typeof value !== 'string' || !value || value === agentSlot.value.id) {
    return
  }
  void assignAgentModel(value)
}

const toolColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => (row as (typeof AGENT_TOOL_CATALOG)[number]).label,
    colKey: 'label',
    minWidth: 140,
    title: '工具',
  },
  {
    cell: (_h, { row }) => (row as (typeof AGENT_TOOL_CATALOG)[number]).purpose,
    colKey: 'purpose',
    minWidth: 360,
    title: '用途',
  },
  {
    cell: () => h(AppStatusTag, {
      label: getAgentToolStatusLabel(toolStatus.value),
      status: getAgentToolStatusTone(toolStatus.value),
    }),
    colKey: 'status',
    title: '状态',
    width: 120,
  },
]
</script>

<template>
  <AppPage
    description="配置筑小格 Agent 主模型，并查看专业工具状态。步骤数与超时由服务端环境变量控制，本页只读。"
    title="Agent 设置"
  >
    <section class="ai-advanced__section">
      <h2 class="ai-advanced__heading">
        Agent 主模型
      </h2>
      <div class="ai-advanced__model">
        <div class="ai-advanced__model-item">
          <span class="ai-advanced__label">Agent 主模型</span>
          <t-select
            v-if="canEditAgentModel"
            :disabled="agentModelOptions.length === 0 || assigningAgent"
            :loading="assigningAgent || modelList.isLoading.value"
            :model-value="agentSlot.id ?? ''"
            :options="agentModelOptions"
            :placeholder="agentModelOptions.length === 0 ? '暂无支持 Tools 的模型' : '请选择 Agent 主模型'"
            @change="onAgentModelChange"
          />
          <strong v-else class="ai-advanced__value">{{ agentSlot.name ?? '未设置' }}</strong>
          <AppStatusTag
            :label="getRuntimeModelHealthLabel(agentSlot.status)"
            :status="agentSlot.status === 'ok' ? 'success' : agentSlot.status === 'disabled' ? 'warning' : 'disabled'"
          />
          <p class="ai-advanced__hint">
            仅展示已开启「工具调用」的模型。不支持 Tools 的模型不能被设置为 Agent 主模型。
          </p>
        </div>
        <div class="ai-advanced__model-item">
          <span class="ai-advanced__label">是否启用 Agent</span>
          <t-switch :model-value="agentEnabled" disabled :label="['已启用', '未启用']" />
          <p class="ai-advanced__hint">
            已配置且启用支持工具调用的 Agent 主模型时，对话会走专业工具；未配置时回退为普通生成。
          </p>
        </div>
      </div>
      <t-alert
        v-if="agentSlot.status === 'unset'"
        theme="warning"
        :title="AGENT_MODEL_UNSET_HINT"
      />
    </section>

    <section class="ai-advanced__section">
      <h2 class="ai-advanced__heading">
        运行限制
      </h2>
      <t-descriptions bordered :column="3" size="medium">
        <t-descriptions-item
          v-for="item in AGENT_RUNTIME_LIMITS"
          :key="item.key"
          :label="item.label"
        >
          <strong>{{ item.value }} {{ item.unit }}</strong>
          <span class="ai-advanced__muted">（{{ item.source }}，只读）</span>
        </t-descriptions-item>
      </t-descriptions>
    </section>

    <section class="ai-advanced__section">
      <h2 class="ai-advanced__heading">
        工具状态
      </h2>
      <p class="ai-advanced__hint">
        工具由系统注册，管理员只查看用途和状态，不能编辑 JSON Schema、Function Definition、Tool Code 或 Prompt。
      </p>
      <AppDataTable
        :columns="toolColumns"
        :data="[...AGENT_TOOL_CATALOG]"
        empty-description="系统尚未注册专业工具"
        empty-title="暂无工具"
        :show-column-controller="false"
        :show-fullscreen="false"
        :show-pagination="false"
        :show-refresh="false"
        row-key="name"
        status="ready"
      />
    </section>
  </AppPage>
</template>

<style scoped>
.ai-advanced__section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.ai-advanced__heading {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.ai-advanced__model {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--td-size-5);
}

.ai-advanced__model-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
}

.ai-advanced__model-item :deep(.t-select) {
  width: 100%;
}

.ai-advanced__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-advanced__value {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.ai-advanced__hint,
.ai-advanced__muted {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.5;
}

@media (max-width: 960px) {
  .ai-advanced__model {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
