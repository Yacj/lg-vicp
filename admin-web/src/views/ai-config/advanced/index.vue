<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiModel } from '@/types/ai'
import { computed, h } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiModelManagement } from '@/composables/useAiModelManagement'
import { getAiReasoningLevelLabel } from '@/utils/ai-model'
import {
  AGENT_RUNTIME_LIMITS,
  AGENT_TOOL_CATALOG,
  getAgentToolStatusLabel,
  getAgentToolStatusTone,
  resolveAgentToolStatus,
} from '@/utils/ai-agent'

defineOptions({ name: 'AiConfigAdvanced' })

const { modelList } = useAiModelManagement()

const rows = computed(() => modelList.data.value as AiModel[])
const defaultModel = computed(() => rows.value.find(model => model.isDefault) ?? null)
const enabledModels = computed(() => rows.value.filter(model => model.enabled))
const visionModels = computed(() => rows.value.filter(model => model.supportsVision))
/** 专业工具随「已启用模型」运行；由运行时实际能力与准入机制管理，不依赖人工开关。 */
const toolStatus = computed(() => resolveAgentToolStatus(enabledModels.value.length > 0))

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
    description="查看系统 AI 运行能力与专业工具状态。运行限制与工具由系统统一管理，本页只读。"
    title="高级设置"
  >
    <section class="ai-advanced__section">
      <h2 class="ai-advanced__heading">
        模型概览
      </h2>
      <t-descriptions bordered :column="3" size="medium">
        <t-descriptions-item label="默认模型">
          <template v-if="defaultModel">
            {{ defaultModel.displayName }}
            <span class="ai-advanced__muted">（{{ getAiReasoningLevelLabel(defaultModel.reasoningLevel) }}推理强度）</span>
          </template>
          <span v-else class="ai-advanced__muted">未设置</span>
        </t-descriptions-item>
        <t-descriptions-item label="已启用模型">
          {{ enabledModels.length }} 个
        </t-descriptions-item>
        <t-descriptions-item label="支持图片输入">
          {{ visionModels.length }} 个
        </t-descriptions-item>
      </t-descriptions>
      <p class="ai-advanced__hint">
        模型启用后，可用于系统支持的 AI 场景。建议先完成准入检测，确认当前模型配置可正常调用。
      </p>
      <t-alert
        v-if="!defaultModel"
        theme="info"
        title="尚未设置默认模型。可在模型配置中，将已启用且检测正常的模型设为默认。"
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
          <span class="ai-advanced__muted">（{{ item.source }}）</span>
        </t-descriptions-item>
      </t-descriptions>
    </section>

    <section class="ai-advanced__section">
      <h2 class="ai-advanced__heading">
        专业工具
      </h2>
      <p class="ai-advanced__hint">
        工具由系统注册，管理员只查看用途和状态，不能编辑工具定义或调用逻辑。
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

.ai-advanced__hint,
.ai-advanced__muted {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.5;
}
</style>
