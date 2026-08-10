<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  createKnowledgeAlias,
  deleteKnowledgeAlias,
  fetchKnowledgeAliases,
  updateKnowledgeAlias,
} from '@/api/modules/knowledge'
import type { AppTableAction } from '@/types/crud'
import {
  knowledgeTermTypes,
  type KnowledgeAlias,
  type KnowledgeAliasInput,
  type KnowledgeTermType,
} from '@/types/knowledge'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:alias:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:knowledge:alias:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:alias:remove'] }))

const feedback = useAppFeedback()

const keyword = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const aliases = ref<KnowledgeAlias[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeAliases({
      page: query.page,
      pageSize: query.pageSize,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    })
    aliases.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

function search(): void {
  query.page = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  query.page = 1
  void load()
}

function onPageChange(pageInfo: PageInfo): void {
  query.page = pageInfo.current
  if (pageInfo.pageSize) {
    query.pageSize = pageInfo.pageSize
  }
  void load()
}

function onPageSizeChange(pageSize: number): void {
  query.pageSize = pageSize
  query.page = 1
  void load()
}

const drawer = useCrudDrawer<KnowledgeAliasInput, KnowledgeAlias>({
  createForm: () => ({ term: '', alias: '', termType: 'KEYWORD', scope: 'GLOBAL' }),
  editForm: (entity) => ({
    term: entity.term,
    alias: entity.alias,
    termType: entity.termType,
    scope: entity.scope,
  }),
  submit: async ({ mode, data, entity }) => {
    if (mode === 'create') {
      return (await createKnowledgeAlias(data)).alias
    }
    return (await updateKnowledgeAlias(entity!.id, data)).alias
  },
  onSuccess: () => load(),
})

const deleteAction = useConfirmedCrudAction<KnowledgeAlias, unknown>({
  action: async (row) => {
    await deleteKnowledgeAlias(row.id)
  },
  confirm: (row) => ({ title: '删除别名', content: `确定删除「${row.term} → ${row.alias}」？`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

async function toggleEnabled(row: KnowledgeAlias): Promise<void> {
  try {
    await updateKnowledgeAlias(row.id, { enabled: !row.enabled })
    await feedback.message('success', row.enabled ? '已停用' : '已启用')
    await load()
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const termTypeLabel: Record<KnowledgeTermType, string> = {
  KEYWORD: '关键词',
  SYNONYM: '同义词',
  ENTITY: '实体',
  CLAUSE_NO: '条款号',
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => row.term, colKey: 'term', minWidth: 180, title: '术语' },
  { cell: (_, { row }) => h('div', [
    h('div', {}, row.alias),
    h('div', { class: 'vicp-alias-scope' }, row.scope),
  ]), colKey: 'alias', minWidth: 220, title: '别名' },
  { cell: (_, { row }) => termTypeLabel[row.termType as KnowledgeTermType] ?? row.termType, colKey: 'termType', minWidth: 90, title: '类型' },
  { cell: (_, { row }) => (row.enabled ? '启用' : '停用'), colKey: 'enabled', minWidth: 70, title: '状态' },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt), 'YYYY-MM-DD'), colKey: 'updatedAt', minWidth: 110, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeAlias
  const actions: AppTableAction[] = []
  if (canEdit.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
    actions.push({
      key: 'toggle', label: entity.enabled ? '停用' : '启用',
      handler: () => void toggleEnabled(entity),
    })
  }
  if (canRemove.value) {
    actions.push({
      key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}

onMounted(load)
</script>

<template>
  <AppPage title="别名词典" description="术语与别名的归一化映射，检索时用于同义扩展；停用后不参与匹配。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="术语 / 别名" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="aliases"
      empty-description="可新增第一个别名映射"
      empty-title="暂无别名"
      :error-description="errorDescription"
      :operations-width="180"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @page-size-change="onPageSizeChange"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon><AddIcon /></template>
          新增别名
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '新增别名' : '编辑别名'"
      :visible="drawer.visible.value"
      :width="'min(560px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="术语" name="term" required-mark>
        <t-input v-model="drawer.formData.term" maxlength="120" placeholder="标准写法，如：EPS 板" />
      </t-form-item>
      <t-form-item label="别名" name="alias" required-mark>
        <t-input v-model="drawer.formData.alias" maxlength="120" placeholder="检索用别名，如：聚苯乙烯泡沫塑料板" />
      </t-form-item>
      <t-form-item label="类型" name="termType">
        <t-select
          v-model="drawer.formData.termType"
          :options="knowledgeTermTypes.map((value) => ({ label: termTypeLabel[value], value }))"
        />
      </t-form-item>
      <t-form-item label="作用域" name="scope">
        <t-input v-model="drawer.formData.scope" maxlength="80" placeholder="GLOBAL 或项目/模块标识" />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-alias-scope {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>