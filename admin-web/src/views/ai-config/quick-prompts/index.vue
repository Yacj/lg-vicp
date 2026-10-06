<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type {
  AiQuickPromptForm,
  AiQuickPromptSearchQuery,
  AiQuickPromptTableRow,
} from '@/composables/useAiQuickPrompts'
import type { AppTableAction } from '@/types/crud'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDrawer from '@/components/business/AppCrudFormDrawer.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import type { AppTableDragSortContext } from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiQuickPrompts } from '@/composables/useAiQuickPrompts'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  getQuickPromptIconMark,
  getQuickPromptPositionLabel,
} from '@/utils/ai'
import {
  QUICK_PROMPT_STOCK_UPDATE_HINT,
  QUICK_PROMPT_SYSTEM_WORDING_HINT,
  QUICK_PROMPT_USER_START_HINT,
  isSystemWordingQuickPrompt,
  systemWordingQuickPromptMessage,
} from '@/utils/ai-quick-prompt'

const {
  applyRecommendedWording,
  applyTemplateToForm,
  applyingRecommended,
  deleteAction,
  pageLegacyCount,
  persistDragSort,
  promptDrawer,
  promptList,
  recommendedTemplates,
  stats,
  toggleEnabled,
} = useAiQuickPrompts()
const { canAccess } = usePermissionAccess()

const rows = promptList.data
const current = promptList.current
const pageSize = promptList.pageSize
const total = promptList.total
const tableStatus = promptList.tableStatus
const searchQuery = promptList.query as AiQuickPromptSearchQuery
const drawerVisible = promptDrawer.visible
const drawerMode = promptDrawer.mode
const drawerSubmitting = promptDrawer.isSubmitting

const canAdd = computed(() => canAccess({ permissions: ['system:ai:quick-prompt:create'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:ai:quick-prompt:update'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:ai:quick-prompt:delete'] }))

const positionFilterOptions = [
  { label: '全部位置', value: 'all' },
  { label: '筑小格首页', value: 'AI_HOME' },
  { label: '项目AI', value: 'PROJECT_AI' },
]

const enabledFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'true' },
  { label: '停用', value: 'false' },
]

const rules: FormRules<AiQuickPromptForm> = {
  title: [
    { message: '请输入标题', required: true },
    { max: 80, message: '标题不能超过 80 个字符' },
  ],
  content: [
    { message: '请输入提问内容', required: true },
    { max: 2000, message: '提问内容不能超过 2000 个字符' },
    {
      message: '请改成用户会说的自然问题，不要写成系统指令。',
      validator: value => !systemWordingQuickPromptMessage(String(value ?? '')),
    },
  ],
  positions: [{
    message: '请选择显示位置',
    validator: value => Array.isArray(value) && value.length > 0,
  }],
}

const errorDescription = computed(() => promptList.error.value
  ? normalizeFeedbackError(promptList.error.value).message
  : '请检查网络连接后重试')

const usageSummary = computed(() =>
  `当前启用 ${stats.enabledCount} 个 · 筑小格首页 ${stats.homeCount} 个 · 项目AI ${stats.projectCount} 个`)

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const item = row as AiQuickPromptTableRow
      return h('div', { class: 'ai-quick-prompt-page__prompt-cell' }, [
        h('span', { class: 'ai-quick-prompt-page__title' }, [
          item.title,
          isSystemWordingQuickPrompt(item.content)
            ? h(AppStatusTag, { label: '需改成用户问题', status: 'warning' })
            : null,
        ]),
        h('span', { class: 'ai-quick-prompt-page__summary' }, item.content),
        h('div', { class: 'ai-quick-prompt-page__tags' }, [
          h(AppStatusTag, {
            label: getQuickPromptPositionLabel(item.position),
            status: 'default',
          }),
        ]),
      ])
    },
    colKey: 'prompt',
    minWidth: 280,
    title: '快捷提问',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: (row as AiQuickPromptTableRow).enabled ? '启用' : '停用',
      status: (row as AiQuickPromptTableRow).enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    width: 88,
    title: '状态',
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  const item = row as AiQuickPromptTableRow
  const actions: AppTableAction[] = []
  if (canEdit.value) {
    actions.push({ key: 'config', label: '配置', handler: () => promptDrawer.openEdit(item) })
    actions.push({
      key: 'toggle',
      label: item.enabled ? '停用' : '启用',
      handler: () => void toggleEnabled(item),
    })
  }
  if (canRemove.value) {
    actions.push({
      handler: () => deleteAction.run(item),
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
    })
  }
  return actions
}

function onDragSort(context: AppTableDragSortContext): void {
  if (context.sort !== 'row' || context.currentIndex === context.targetIndex) {
    return
  }
  void persistDragSort(context.newData as AiQuickPromptTableRow[])
}
</script>

<template>
  <AppPage
    :description="`${QUICK_PROMPT_USER_START_HINT} 用户仍然可以自由输入任何问题。`"
    title="快捷提问"
  >
    <template #search>
      <AppSearchPanel :loading="promptList.isLoading.value" @reset="promptList.reset" @search="promptList.search">
        <t-form-item label="关键词">
          <t-input v-model="searchQuery.keyword" clearable placeholder="标题" />
        </t-form-item>
        <t-form-item label="显示位置">
          <t-select v-model="searchQuery.position" :options="positionFilterOptions" />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="searchQuery.enabled" :options="enabledFilterOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <t-alert
      class="ai-quick-prompt-page__alert"
      theme="info"
      :message="QUICK_PROMPT_SYSTEM_WORDING_HINT"
    />
    <t-alert
      v-if="pageLegacyCount > 0"
      class="ai-quick-prompt-page__alert"
      theme="warning"
      :message="QUICK_PROMPT_STOCK_UPDATE_HINT"
    />

    <p class="ai-quick-prompt-page__usage">
      {{ usageSummary }}
    </p>

    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      :drag-sort="canEdit ? 'row-handler' : undefined"
      empty-description="添加快捷提问后，用户可以在筑小格中一键发起常用问题，同时仍可自由输入任何内容。"
      empty-title="还没有快捷提问"
      :error-description="errorDescription"
      :operations-width="96"
      :page-size="pageSize"
      row-key="id"
      :status="tableStatus"
      :total="total"
      @drag-sort="onDragSort"
      @page-change="promptList.changePage"
      @refresh="promptList.refresh"
      @retry="promptList.retry"
    >
      <template #toolbar>
        <t-space>
          <t-button
            v-if="canEdit && pageLegacyCount > 0"
            :loading="applyingRecommended"
            theme="default"
            variant="outline"
            @click="applyRecommendedWording"
          >
            按推荐文案更新
          </t-button>
          <t-button v-if="canAdd" theme="primary" @click="promptDrawer.openCreate">
            <template #icon>
              <AddIcon />
            </template>
            新增快捷提问
          </t-button>
        </t-space>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" :max-visible="1" />
      </template>
    </AppDataTable>

    <AppCrudFormDrawer
      :form-data="promptDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      size="min(520px, 92vw)"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增快捷提问' : '配置快捷提问'"
      :visible="drawerVisible"
      @cancel="promptDrawer.close"
      @submit="promptDrawer.submit"
      @update:visible="promptDrawer.setVisible"
    >
      <t-form-item label="推荐用户问题">
        <div class="ai-quick-prompt-page__templates">
          <t-space break-line>
            <t-button
              v-for="item in recommendedTemplates"
              :key="item.title"
              size="small"
              theme="default"
              variant="outline"
              @click="applyTemplateToForm(item)"
            >
              {{ item.title }}
            </t-button>
          </t-space>
          <p class="ai-quick-prompt-page__templates-hint">
            套用后仍可再改。点击发送的是用户问题，不是系统指令。
          </p>
        </div>
      </t-form-item>
      <t-form-item label="标题" name="title" required-mark>
        <t-input
          v-model="promptDrawer.formData.title"
          maxlength="80"
          placeholder="例如：查询图集"
        />
      </t-form-item>
      <t-form-item label="提问内容" name="content" required-mark>
        <t-textarea
          v-model="promptDrawer.formData.content"
          :autosize="{ minRows: 4, maxRows: 8 }"
          maxlength="2000"
          placeholder="例如：帮我查一下和当前问题相关的图集做法，并告诉我出处。"
          :tips="QUICK_PROMPT_SYSTEM_WORDING_HINT"
        />
      </t-form-item>
      <t-form-item label="显示位置" name="positions" required-mark>
        <t-checkbox-group v-model="promptDrawer.formData.positions">
          <t-checkbox value="AI_HOME">
            筑小格首页
          </t-checkbox>
          <t-checkbox value="PROJECT_AI">
            项目AI
          </t-checkbox>
        </t-checkbox-group>
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-radio-group v-model="promptDrawer.formData.enabled" variant="default-filled">
          <t-radio :value="true">
            启用
          </t-radio>
          <t-radio :value="false">
            停用
          </t-radio>
        </t-radio-group>
      </t-form-item>
      <div class="ai-quick-prompt-page__preview">
        <p class="ai-quick-prompt-page__preview-label">
          C端预览
        </p>
        <div class="ai-quick-prompt-page__preview-chip">
          <span class="ai-quick-prompt-page__preview-mark">
            {{ getQuickPromptIconMark(promptDrawer.formData.icon) }}
          </span>
          <div class="ai-quick-prompt-page__preview-copy">
            <strong>{{ promptDrawer.formData.title.trim() || '标题' }}</strong>
            <span>{{ promptDrawer.formData.content.trim() || '提问内容会显示在标题下方' }}</span>
          </div>
        </div>
      </div>
    </AppCrudFormDrawer>
  </AppPage>
</template>

<style scoped>
.ai-quick-prompt-page__alert {
  margin-bottom: 0;
}

.ai-quick-prompt-page__usage {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-quick-prompt-page__prompt-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
  padding: var(--td-size-1) 0;
}

.ai-quick-prompt-page__title {
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  font-weight: 500;
}

.ai-quick-prompt-page__summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ai-quick-prompt-page__tags {
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: var(--td-size-1);
}

.ai-quick-prompt-page__templates {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
}

.ai-quick-prompt-page__templates-hint {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.ai-quick-prompt-page__preview {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
}

.ai-quick-prompt-page__preview-label {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-quick-prompt-page__preview-chip {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--td-size-3);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.ai-quick-prompt-page__preview-mark {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.ai-quick-prompt-page__preview-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-quick-prompt-page__preview-copy strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}

.ai-quick-prompt-page__preview-copy span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}
</style>
