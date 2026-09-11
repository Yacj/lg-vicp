<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type {
  AiContentFilterForm,
  AiContentFilterSearchQuery,
  AiContentFilterTableRow,
} from '@/composables/useAiContentFilters'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiContentFilters } from '@/composables/useAiContentFilters'
import { confirmAndRun } from '@/composables/useAppConfirm'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { AI_SCENE_OPTIONS, getAiSceneLabel } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const { filterDrawer, filterList, remove, toggleEnabled } = useAiContentFilters()
const { canAccess } = usePermissionAccess()

const rows = filterList.data
const current = filterList.current
const pageSize = filterList.pageSize
const total = filterList.total
const tableStatus = filterList.tableStatus
const searchLoading = filterList.isLoading
const searchQuery = filterList.query as AiContentFilterSearchQuery

const canAddFilter = computed(() => canAccess({ permissions: ['system:ai:filter:add'] }))
const canEditFilter = computed(() => canAccess({ permissions: ['system:ai:filter:edit'] }))
const canRemoveFilter = computed(() => canAccess({ permissions: ['system:ai:filter:remove'] }))

const matchTypeOptions = [
  { label: '全部匹配方式', value: 'all' },
  { label: '包含匹配', value: 'CONTAINS' },
  { label: '正则匹配', value: 'REGEX' },
]

const enabledFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'true' },
  { label: '停用', value: 'false' },
]

/** 匹配方式列：CONTAINS 为包含匹配（默认），REGEX 为正则匹配。 */
function matchTypeTag(row: AiContentFilterTableRow) {
  const isRegex = row.matchType === 'REGEX'
  return h(AppStatusTag, {
    label: isRegex ? '正则匹配' : '包含匹配',
    status: isRegex ? 'warning' : 'default',
  })
}

/** 生效场景列：sceneCodes 为空表示所有场景生效。 */
function sceneCell(row: AiContentFilterTableRow) {
  if (!row.sceneCodes || row.sceneCodes.length === 0) {
    return h('span', { class: 'ai-filter-page__muted' }, '所有场景')
  }
  return h('div', { class: 'ai-filter-page__scenes' }, row.sceneCodes.map(code =>
    h('span', { class: 'ai-filter-page__scene-tag' }, getAiSceneLabel(code)),
  ))
}

function openEdit(row: TableRowData): void {
  filterDrawer.openEdit(row as AiContentFilterTableRow)
}

function confirmRemove(row: TableRowData): void {
  const item = row as AiContentFilterTableRow
  void confirmAndRun({
    title: '删除围栏词条',
    content: `确认删除词条「${item.keyword}」吗？删除后该敏感词将不再拦截对话。`,
    confirmText: '删除',
    danger: true,
  }, () => remove(item))
}

function toggleRow(row: TableRowData): void {
  void toggleEnabled(row as AiContentFilterTableRow)
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const item = row as AiContentFilterTableRow
      return h('div', { class: 'ai-filter-page__keyword-cell' }, [
        h('code', { class: 'ai-filter-page__keyword' }, item.keyword),
        item.hitMessage
          ? h('span', { class: 'ai-filter-page__hit-message' }, `命中提示：${item.hitMessage}`)
          : null,
      ])
    },
    colKey: 'keyword',
    minWidth: 220,
    title: '关键词',
  },
  {
    cell: (_h, { row }) => matchTypeTag(row as AiContentFilterTableRow),
    colKey: 'matchType',
    minWidth: 110,
    title: '匹配方式',
  },
  {
    cell: (_h, { row }) => sceneCell(row as AiContentFilterTableRow),
    colKey: 'sceneCodes',
    minWidth: 220,
    title: '生效场景',
  },
  {
    cell: (_h, { row }) => {
      const item = row as AiContentFilterTableRow
      return h(AppStatusTag, {
        label: item.enabled ? '启用' : '停用',
        status: item.enabled ? 'success' : 'disabled',
      })
    },
    colKey: 'enabled',
    minWidth: 90,
    title: '状态',
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as AiContentFilterTableRow).updatedAt)),
    colKey: 'updatedAt',
    minWidth: 170,
    title: '更新时间',
  },
]

const rules: FormRules<AiContentFilterForm> = {
  keyword: [
    { message: '请输入关键词', required: true },
    {
      message: '关键词不能超过 100 个字符',
      validator: value => value === undefined || value === null || String(value).length <= 100,
    },
    {
      message: '正则表达式格式不正确',
      validator: (value) => {
        const form = filterDrawer.formData
        if (form.matchType !== 'REGEX' || !value) {
          return true
        }
        try {
          new RegExp(String(value), 'iu')
          return true
        }
        catch {
          return false
        }
      },
    },
  ],
  hitMessage: [{
    message: '命中提示语不能超过 200 个字符',
    validator: value => value === undefined || value === null || value === '' || String(value).length <= 200,
  }],
}

const errorDescription = computed(() => filterList.error.value
  ? normalizeFeedbackError(filterList.error.value).message
  : '请检查网络连接后重试')

const drawerVisible = filterDrawer.visible
const drawerMode = filterDrawer.mode
const drawerSubmitting = filterDrawer.isSubmitting
</script>

<template>
  <AppPage
    description="拦截不适合进入筑小格的提问内容。这些规则不会展示给普通用户。"
    title="内容安全"
  >
    <AppSearchPanel
      :loading="searchLoading"
      @reset="filterList.reset"
      @search="filterList.search"
    >
      <t-form-item label="关键词" name="keyword">
        <t-input
          v-model="searchQuery.keyword"
          clearable
          placeholder="输入关键词搜索"
        />
      </t-form-item>
      <t-form-item label="匹配方式" name="matchType">
        <t-select
          v-model="searchQuery.matchType"
          :options="matchTypeOptions"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-select
          v-model="searchQuery.enabled"
          :options="enabledFilterOptions"
        />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      empty-description="尚未配置敏感词围栏词条，点击右上角新增"
      empty-title="暂无围栏词条"
      :error-description="errorDescription"
      :page-size="pageSize"
      :total="total"
      row-key="id"
      :status="tableStatus"
      @page-change="filterList.changePage"
      @refresh="filterList.refresh"
      @retry="filterList.retry"
    >
      <template #toolbar>
        <t-button
          v-if="canAddFilter"
          theme="primary"
          @click="filterDrawer.openCreate"
        >
          新增词条
        </t-button>
      </template>
      <template #operations="{ row }">
        <t-button
          v-if="canEditFilter"
          variant="text"
          theme="primary"
          @click="openEdit(row)"
        >
          编辑
        </t-button>
        <t-button
          v-if="canEditFilter"
          variant="text"
          theme="primary"
          @click="toggleRow(row)"
        >
          {{ (row as AiContentFilterTableRow).enabled ? '停用' : '启用' }}
        </t-button>
        <t-button
          v-if="canRemoveFilter"
          variant="text"
          theme="danger"
          @click="confirmRemove(row)"
        >
          删除
        </t-button>
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      description="词条命中后用户消息将被拦截（不发模型请求），并记录审计。匹配方式为正则时，关键词必须是合法正则表达式；生效场景留空表示所有场景生效。"
      :form-data="filterDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      title="敏感词围栏词条"
      :visible="drawerVisible"
      width="min(640px, 92vw)"
      @cancel="filterDrawer.close"
      @submit="filterDrawer.submit"
      @update:visible="filterDrawer.setVisible"
    >
      <template #default="{ readonly }">
        <t-form-item label="关键词" name="keyword">
          <t-input
            v-model="filterDrawer.formData.keyword"
            :disabled="readonly"
            maxlength="100"
            placeholder="输入需要拦截的敏感词"
          />
        </t-form-item>
        <t-form-item
          label="匹配方式"
          name="matchType"
          help="包含匹配：消息中包含关键词即命中；正则匹配：消息满足正则表达式即命中。"
        >
          <t-radio-group v-model="filterDrawer.formData.matchType" variant="default-filled">
            <t-radio value="CONTAINS">
              包含匹配
            </t-radio>
            <t-radio value="REGEX">
              正则匹配
            </t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item
          class="vicp-form-grid-item--wide"
          label="生效场景"
          name="sceneCodes"
          help="留空表示所有场景生效；多选后仅所选场景命中该词条。"
        >
          <t-checkbox-group v-model="filterDrawer.formData.sceneCodes">
            <t-checkbox v-for="option in AI_SCENE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </t-checkbox>
          </t-checkbox-group>
        </t-form-item>
        <t-form-item
          class="vicp-form-grid-item--wide"
          label="命中提示语"
          name="hitMessage"
          help="用户消息被拦截时展示的提示；留空使用默认提示。"
        >
          <t-textarea
            v-model="filterDrawer.formData.hitMessage"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :disabled="readonly"
            maxlength="200"
            placeholder="选填：例如「内容包含敏感词，请调整后重试」"
          />
        </t-form-item>
        <t-form-item label="状态" name="enabled">
          <t-radio-group v-model="filterDrawer.formData.enabled" variant="default-filled">
            <t-radio :value="true">
              启用
            </t-radio>
            <t-radio :value="false">
              停用
            </t-radio>
          </t-radio-group>
        </t-form-item>
      </template>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.ai-filter-page__keyword-cell {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-filter-page__keyword {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
}

.ai-filter-page__hit-message {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-filter-page__scenes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-1);
}

.ai-filter-page__scene-tag {
  padding: 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-component);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-filter-page__muted {
  color: var(--td-text-color-placeholder);
}
</style>
