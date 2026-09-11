<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiSceneBindingForm, AiSceneBindingTableRow } from '@/composables/useAiSceneBindings'

import { computed, h, onMounted, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiSceneBindings } from '@/composables/useAiSceneBindings'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { AI_SCENE_META, getAiSceneLabel } from '@/utils/ai'

const {
  error,
  load,
  modelOptions,
  promptOptions,
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
const advancedOpen = ref<Array<string | number>>([])
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

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const scene = (row as AiSceneBindingTableRow).scene
      return h('div', { class: 'ai-scene-page__scene' }, [
        h('span', { class: 'ai-scene-page__scene-name' }, getAiSceneLabel(scene)),
        h('span', { class: 'ai-scene-page__scene-desc' }, AI_SCENE_META[scene].description),
      ])
    },
    colKey: 'scene',
    minWidth: 280,
    title: '名称',
  },
  {
    cell: (_h, { row }) => {
      const description = (row as AiSceneBindingTableRow).description
      return description
        ? h('span', {}, description)
        : h('span', { class: 'ai-scene-page__muted' }, AI_SCENE_META[(row as AiSceneBindingTableRow).scene].description)
    },
    colKey: 'description',
    minWidth: 240,
    title: '说明',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiSceneBindingTableRow).enabled ? '已启用' : '已停用',
      status: (row as AiSceneBindingTableRow).enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    minWidth: 100,
    title: '状态',
  },
]

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

function openEdit(row: TableRowData): void {
  advancedOpen.value = []
  sceneDrawer.openEdit(row as AiSceneBindingTableRow)
}
</script>

<template>
  <AppPage
    description="这里调整筑小格在不同能力下如何回答。建议仅由技术管理员修改。"
    title="AI能力配置"
  >
    <t-alert
      class="ai-scene-page__alert"
      message="这些能力由系统内部使用，普通用户不会在筑小格中选择。请谨慎调整启用状态和默认模型。"
      theme="warning"
    />
    <AppDataTable
      :columns="columns"
      :data="rows"
      empty-description="等待加载系统内置能力"
      empty-title="暂无 AI 能力"
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
      :form-data="sceneDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="`配置「${getAiSceneLabel((sceneDrawer.formData as AiSceneBindingForm).scene)}」`"
      :visible="drawerVisible"
      width="min(640px, 92vw)"
      @cancel="sceneDrawer.close"
      @submit="sceneDrawer.submit"
      @update:visible="sceneDrawer.setVisible"
    >
      <template #default="{ readonly }">
        <t-form-item label="名称" name="scene">
          <t-input :model-value="getAiSceneLabel((sceneDrawer.formData as AiSceneBindingForm).scene)" readonly />
        </t-form-item>
        <t-form-item class="vicp-form-grid-item--wide" label="说明" name="description">
          <t-input
            v-model="sceneDrawer.formData.description"
            maxlength="500"
            placeholder="选填：说明该能力的用途"
          />
        </t-form-item>
        <t-form-item label="启用状态" name="enabled">
          <t-radio-group v-model="sceneDrawer.formData.enabled" variant="default-filled">
            <t-radio :value="true">
              启用
            </t-radio>
            <t-radio :value="false">
              停用
            </t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item
          label="默认模型"
          name="primaryModelId"
          help="该能力发起对话时优先使用的模型。"
        >
          <t-select
            v-model="sceneDrawer.formData.primaryModelId"
            :disabled="readonly"
            :options="modelOptions"
            placeholder="选择默认模型"
          />
        </t-form-item>
        <t-form-item
          class="vicp-form-grid-item--wide"
          label="基础指令"
          name="promptTemplateId"
          help="该能力使用的回答规则。建议绑定已发布的基础指令。"
        >
          <t-select
            v-model="sceneDrawer.formData.promptTemplateId"
            :disabled="readonly"
            :options="promptOptions"
            placeholder="选填"
          />
        </t-form-item>
        <t-collapse v-model="advancedOpen" class="vicp-form-grid-item--wide" expand-icon-placement="right">
          <t-collapse-panel header="高级设置" value="advanced">
            <div class="ai-scene-page__advanced">
              <t-form-item
                label="深度思考模型"
                name="reasoningModelId"
                help="用户选择深度思考时使用的模型；未设置则回退到默认模型。"
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
                help="默认模型不可用时切换的模型。"
              >
                <t-select
                  v-model="sceneDrawer.formData.fallbackModelId"
                  :disabled="readonly"
                  :options="modelOptions"
                  placeholder="选填"
                />
              </t-form-item>
              <t-form-item
                label="回答风格"
                name="temperature"
                help="数值越高回答越发散，越低越严谨（范围 0-2）；留空使用模型默认值。"
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
                help="限制单次回复的最大长度；留空使用模型默认值。"
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
                class="vicp-form-grid-item--wide"
                label="允许工具"
                help="以下开关决定该能力在运行期可用的行为。"
              >
                <div class="ai-scene-page__toggle-fields">
                  <t-checkbox v-model="sceneDrawer.formData.allowReasoning">
                    允许深度思考
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
                label="排序"
                name="sort"
                help="数值越小越靠前。"
              >
                <t-input-number
                  v-model="sceneDrawer.formData.sort"
                  class="ai-scene-page__input-number"
                  placeholder="例如 1"
                  theme="column"
                />
              </t-form-item>
            </div>
          </t-collapse-panel>
        </t-collapse>
      </template>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.ai-scene-page__alert {
  margin-bottom: 0;
}

.ai-scene-page__scene {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-scene-page__scene-name {
  font-weight: 500;
}

.ai-scene-page__scene-desc {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-scene-page__muted {
  color: var(--td-text-color-placeholder);
}

.ai-scene-page__advanced {
  display: grid;
  gap: var(--td-size-4);
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