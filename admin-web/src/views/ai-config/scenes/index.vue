<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiSceneBindingForm, AiSceneBindingTableRow } from '@/composables/useAiSceneBindings'

import { computed, h, onMounted } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiSceneBindings } from '@/composables/useAiSceneBindings'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { AI_SCENE_META, getAiSceneLabel } from '@/utils/ai'

const {
  error,
  load,
  modelNameById,
  modelOptions,
  modelProviderIdById,
  promptLabelById,
  promptOptions,
  providerNameById,
  rows,
  sceneDrawer,
  status,
} = useAiSceneBindings()
const { canAccess } = usePermissionAccess()

onMounted(() => {
  void load()
})

const canEditScene = computed(() => canAccess({ permissions: ['system:ai:scene:edit'] }))
const drawerVisible = sceneDrawer.visible
const drawerMode = sceneDrawer.mode
const drawerSubmitting = sceneDrawer.isSubmitting
const tableStatus = computed<'ready' | 'loading' | 'error'>(() => {
  if (status.value === 'loading') {
    return 'loading'
  }
  return status.value === 'error' ? 'error' : 'ready'
})

const rules: FormRules<AiSceneBindingForm> = {
  primaryModelId: [{ message: '请选择默认模型', required: true }],
  description: [{
    message: '描述不能超过 500 个字符',
    validator: value => value === null || value === undefined || value === '' || String(value).length <= 500,
  }],
  temperature: [{
    message: '回答风格取值应在 0 到 2 之间',
    validator: value => value === null || value === undefined || value === '' || (Number(value) >= 0 && Number(value) <= 2),
  }],
  maxOutputTokens: [{
    message: '单次回答长度应为大于 0 的整数',
    validator: value => value === null || value === undefined || value === '' || (Number.isInteger(Number(value)) && Number(value) > 0),
  }],
  sort: [{
    message: '排序应为整数',
    validator: value => value === null || value === undefined || value === '' || Number.isInteger(Number(value)),
  }],
}

/** 解析模型名：优先前端模型列表 join，兜底后端返回的 name 字段（模型被删除时仍可展示）。 */
function resolveModelName(modelId: string | null, boundName: string | null): string | null {
  if (!modelId) {
    return null
  }
  return modelNameById.value.get(modelId) ?? boundName
}

function modelCell(modelId: string | null, boundName: string | null) {
  const name = resolveModelName(modelId, boundName)
  if (!name) {
    return h('span', { class: 'ai-scene-page__muted' }, '未设置')
  }
  const providerId = modelProviderIdById.value.get(modelId ?? '') ?? ''
  return h('div', { class: 'ai-scene-page__model-cell' }, [
    h('span', {}, name),
    h('span', { class: 'ai-scene-page__model-provider' }, providerNameById.value.get(providerId) ?? ''),
  ])
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const scene = (row as AiSceneBindingTableRow).scene
      return h('div', { class: 'ai-scene-page__scene' }, [
        h('div', { class: 'ai-scene-page__scene-head' }, [
          h('span', { class: 'ai-scene-page__scene-name' }, getAiSceneLabel(scene)),
          h(AppStatusTag, {
            label: (row as AiSceneBindingTableRow).enabled ? '已开放' : '未开放',
            status: (row as AiSceneBindingTableRow).enabled ? 'success' : 'disabled',
          }),
        ]),
        h('span', { class: 'ai-scene-page__scene-desc' }, AI_SCENE_META[scene].description),
      ])
    },
    colKey: 'scene',
    minWidth: 240,
    title: '场景',
  },
  {
    cell: (_h, { row }) => h('code', { class: 'ai-scene-page__code' }, (row as AiSceneBindingTableRow).scene),
    colKey: 'sceneCode',
    minWidth: 140,
    title: '场景编码',
  },
  {
    cell: (_h, { row }) => {
      const binding = row as AiSceneBindingTableRow
      const primary = resolveModelName(binding.primaryModelId, binding.defaultModelName)
      if (!primary) {
        return h(AppEmptyState, { description: '尚未绑定默认模型', size: 'small', title: '未绑定' })
      }
      return modelCell(binding.primaryModelId, binding.defaultModelName)
    },
    colKey: 'primaryModelId',
    minWidth: 200,
    title: '默认模型',
  },
  {
    cell: (_h, { row }) => {
      const binding = row as AiSceneBindingTableRow
      return modelCell(binding.reasoningModelId, binding.reasoningModelName)
    },
    colKey: 'reasoningModelId',
    minWidth: 180,
    title: '深度分析模型',
  },
  {
    cell: (_h, { row }) => {
      const binding = row as AiSceneBindingTableRow
      return modelCell(binding.fallbackModelId, binding.fallbackModelName)
    },
    colKey: 'fallbackModelId',
    minWidth: 180,
    title: '备用模型',
  },
  {
    cell: (_h, { row }) => {
      const binding = row as AiSceneBindingTableRow
      if (binding.activePromptVersion) {
        return h('span', { class: 'ai-scene-page__prompt-version' }, `v${binding.activePromptVersion}`)
      }
      const label = promptLabelById.value.get(binding.promptTemplateId ?? '')
      return label
        ? h('span', {}, `${label}（未发布）`)
        : h('span', { class: 'ai-scene-page__muted' }, '未设置')
    },
    colKey: 'promptTemplateId',
    minWidth: 150,
    title: '提示词版本',
  },
  {
    cell: (_h, { row }) => {
      const temperature = (row as AiSceneBindingTableRow).temperature
      return temperature === null || temperature === undefined ? '-' : String(temperature)
    },
    colKey: 'temperature',
    minWidth: 90,
    title: '温度',
  },
]

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

function openEdit(row: TableRowData): void {
  sceneDrawer.openEdit(row as AiSceneBindingTableRow)
}
</script>

<template>
  <AppPage>
    <AppDataTable
      :columns="columns"
      :data="rows"
      empty-description="场景为平台固定枚举，等待配置绑定"
      empty-title="暂无场景绑定"
      :error-description="errorDescription"
      row-key="id"
      :status="tableStatus"
      @refresh="load"
      @retry="load"
    >
      <template #operations="{ row }">
        <t-button
          v-if="canEditScene"
          variant="text"
          theme="primary"
          @click="openEdit(row)"
        >
          配置
        </t-button>
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      description="场景为平台固定枚举（编码不可修改）；默认模型必选。知识检索、工具调用等能力仅在对应后端能力启用后生效。"
      :form-data="sceneDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="`配置场景「${getAiSceneLabel((sceneDrawer.formData as AiSceneBindingForm).scene)}」`"
      :visible="drawerVisible"
      width="min(760px, 92vw)"
      @cancel="sceneDrawer.close"
      @submit="sceneDrawer.submit"
      @update:visible="sceneDrawer.setVisible"
    >
      <template #default="{ readonly }">
        <t-form-item label="场景" name="scene">
          <t-input :model-value="getAiSceneLabel((sceneDrawer.formData as AiSceneBindingForm).scene)" readonly />
        </t-form-item>
        <t-form-item
          label="默认模型"
          name="primaryModelId"
          help="该场景发起对话时优先使用的模型。"
        >
          <t-select
            v-model="sceneDrawer.formData.primaryModelId"
            :disabled="readonly"
            :options="modelOptions"
            placeholder="选择默认模型"
          />
        </t-form-item>
        <t-form-item
          label="深度分析模型"
          name="reasoningModelId"
          help="用户选择深度分析（推理模式）时使用的模型；未设置则回退到默认模型。"
        >
          <t-select
            v-model="sceneDrawer.formData.reasoningModelId"
            :disabled="readonly"
            :options="modelOptions"
            placeholder="选填"
          />
        </t-form-item>
        <t-form-item
          label="备用模型"
          name="fallbackModelId"
          help="默认模型不可用（限流/失败）时切换的模型。"
        >
          <t-select
            v-model="sceneDrawer.formData.fallbackModelId"
            :disabled="readonly"
            :options="modelOptions"
            placeholder="选填"
          />
        </t-form-item>
        <t-form-item
          label="提示词模板"
          name="promptTemplateId"
          help="该场景使用的提示词模板；建议绑定已发布版本的模板。"
        >
          <t-select
            v-model="sceneDrawer.formData.promptTemplateId"
            :disabled="readonly"
            :options="promptOptions"
            placeholder="选填"
          />
        </t-form-item>
        <t-form-item class="vicp-form-grid-item--wide" label="场景描述" name="description">
          <t-input
            v-model="sceneDrawer.formData.description"
            maxlength="500"
            placeholder="选填：说明该场景的用途或限制"
          />
        </t-form-item>
        <t-form-item
          class="vicp-form-grid-item--wide"
          label="能力开关"
          help="以下能力开关决定该场景在运行期可用的行为；知识检索与工具调用需要后端对应能力就绪后才生效。"
        >
          <div class="ai-scene-page__toggle-fields">
            <t-checkbox v-model="sceneDrawer.formData.allowReasoning">
              允许深度分析（推理模式）
            </t-checkbox>
            <t-checkbox v-model="sceneDrawer.formData.requireProject">
              必须关联项目才能提问
            </t-checkbox>
            <t-checkbox v-model="sceneDrawer.formData.allowFileUpload">
              允许上传文件
            </t-checkbox>
            <t-checkbox v-model="sceneDrawer.formData.allowKnowledgeSearch">
              允许知识库检索
            </t-checkbox>
            <t-checkbox v-model="sceneDrawer.formData.allowTools">
              允许工具调用
            </t-checkbox>
          </div>
        </t-form-item>
        <t-form-item
          label="回答风格"
          name="temperature"
          help="数值越高回答越有创意、越发散；数值越低回答越严谨、稳定（范围 0-2）；留空使用模型默认值。"
        >
          <t-input-number
            v-model="sceneDrawer.formData.temperature"
            class="ai-scene-page__input-number"
            :max="2"
            :min="0"
            :step="0.1"
            placeholder="默认由模型决定"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="单次回答长度"
          name="maxOutputTokens"
          help="限制该场景单次回复的最大长度（Token），数值越大回答越长；留空使用模型默认值。"
        >
          <t-input-number
            v-model="sceneDrawer.formData.maxOutputTokens"
            class="ai-scene-page__input-number"
            :min="1"
            placeholder="例如 8192"
            theme="column"
          />
        </t-form-item>
        <t-form-item
          label="排序"
          name="sort"
          help="数值越小在场景列表中越靠前。"
        >
          <t-input-number
            v-model="sceneDrawer.formData.sort"
            class="ai-scene-page__input-number"
            placeholder="例如 1"
            theme="column"
          />
        </t-form-item>
        <t-form-item label="状态" name="enabled">
          <t-radio-group v-model="sceneDrawer.formData.enabled" variant="default-filled">
            <t-radio :value="true">
              开放
            </t-radio>
            <t-radio :value="false">
              关闭
            </t-radio>
          </t-radio-group>
        </t-form-item>
      </template>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.ai-scene-page__scene {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-scene-page__scene-head {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.ai-scene-page__scene-name {
  font-weight: 500;
}

.ai-scene-page__scene-desc {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-scene-page__code {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-scene-page__model-cell {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-scene-page__model-provider {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-scene-page__prompt-version {
  padding: 0 var(--td-size-2);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-scene-page__muted {
  color: var(--td-text-color-placeholder);
}

.ai-scene-page__toggle-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-4);
}

.ai-scene-page__input-number {
  width: 100%;
}
</style>