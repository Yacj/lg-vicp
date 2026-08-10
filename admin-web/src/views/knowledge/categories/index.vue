<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
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
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  fetchKnowledgeCategories,
  updateKnowledgeCategory,
} from '@/api/modules/knowledge'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeCategory, KnowledgeCategoryInput } from '@/types/knowledge'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:category:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:knowledge:category:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:category:remove'] }))

const feedback = useAppFeedback()

const categories = ref<KnowledgeCategory[]>([])
const isLoading = ref(false)
const error = ref<unknown>(null)
const keyword = ref('')

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeCategories()
    categories.value = result.items
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

function search(): void {
  void load()
}

function reset(): void {
  keyword.value = ''
  void load()
}

const drawer = useCrudDrawer<KnowledgeCategoryInput, KnowledgeCategory>({
  createForm: () => ({ name: '', code: '', parentId: undefined, sortOrder: 0, description: '' }),
  editForm: (entity) => ({
    name: entity.name,
    code: entity.code,
    parentId: entity.parentId ?? undefined,
    sortOrder: entity.sortOrder,
    description: entity.description ?? '',
  }),
  submit: async ({ mode, data, entity }) => {
    if (mode === 'create') {
      return (await createKnowledgeCategory(data)).category
    }
    return (await updateKnowledgeCategory(entity!.id, data)).category
  },
  onSuccess: () => load(),
})

const deleteAction = useConfirmedCrudAction<KnowledgeCategory, unknown>({
  action: async (row) => {
    await deleteKnowledgeCategory(row.id)
  },
  confirm: (row) => ({ title: '删除分类', content: `确定删除「${row.name}」？分类下存在文档时后端将拒绝。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

async function toggleEnabled(row: KnowledgeCategory): Promise<void> {
  try {
    await updateKnowledgeCategory(row.id, { enabled: !row.enabled })
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

const filtered = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) {
    return categories.value
  }
  return categories.value.filter((item) => item.name.includes(kw) || item.code.includes(kw))
})

function parentName(row: KnowledgeCategory): string {
  if (!row.parentId) {
    return '—'
  }
  return categories.value.find((item) => item.id === row.parentId)?.name ?? row.parentId
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-cat-name' }, row.name),
    h('div', { class: 'vicp-cat-code' }, row.code),
  ]), colKey: 'name', minWidth: 220, title: '分类名称' },
  { cell: (_, { row }) => parentName(row as KnowledgeCategory), colKey: 'parentId', minWidth: 140, title: '父分类' },
  { cell: (_, { row }) => row.sortOrder, colKey: 'sortOrder', minWidth: 80, title: '排序' },
  { cell: (_, { row }) => (row.enabled ? '启用' : '停用'), colKey: 'enabled', minWidth: 70, title: '状态' },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt), 'YYYY-MM-DD'), colKey: 'updatedAt', minWidth: 110, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeCategory
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
  <AppPage title="分类管理" description="知识文档分类树（扁平存储，parentId 关联）；文档挂载分类后随分类调整。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="名称 / 编码" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="filtered"
      empty-description="可新增第一个知识分类"
      empty-title="暂无分类"
      :error-description="errorDescription"
      :operations-width="180"
      :show-pagination="false"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="filtered.length"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon><AddIcon /></template>
          新增分类
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
      :title="drawer.mode.value === 'create' ? '新增分类' : '编辑分类'"
      :visible="drawer.visible.value"
      :width="'min(640px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="分类名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="120" placeholder="如：图集" />
      </t-form-item>
      <t-form-item label="分类编码" name="code" required-mark>
        <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一编码" />
      </t-form-item>
      <t-form-item label="父分类" name="parentId">
        <t-select
          v-model="drawer.formData.parentId"
          :options="categories.filter((item) => item.id !== drawer.entity.value?.id).map((item) => ({ label: item.name, value: item.id }))"
          clearable
          placeholder="无（一级分类）"
        />
      </t-form-item>
      <t-form-item label="排序" name="sortOrder">
        <t-input-number v-model="drawer.formData.sortOrder" :min="0" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="描述" name="description">
        <t-textarea v-model="drawer.formData.description" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="选填" />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-cat-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-cat-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>