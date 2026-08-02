<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type {
  DictionaryForm,
} from '@/composables/useDictionaryManagement'
import { useDictionaryManagement } from '@/composables/useDictionaryManagement'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { SystemDictionary } from '@/types/system-management'
import { formatDate } from '@/utils/day'

const {
  dictionaryDeleteAction,
  dictionaryDrawer,
  dictionaryList,
  dictionaryStatusAction,
} = useDictionaryManagement()
const { canAccess } = usePermissionAccess()
const router = useRouter()

const dictionaryRows = dictionaryList.data
const dictionaryCurrent = dictionaryList.current
const dictionaryPageSize = dictionaryList.pageSize
const dictionaryTotal = dictionaryList.total
const dictionaryTableStatus = dictionaryList.tableStatus
const dictionaryLoading = dictionaryList.isLoading
const dictionaryDrawerVisible = dictionaryDrawer.visible
const dictionaryDrawerMode = dictionaryDrawer.mode
const dictionaryDrawerSubmitting = dictionaryDrawer.isSubmitting
const dictionaryStatusRunning = dictionaryStatusAction.running
const dictionaryDeleteRunning = dictionaryDeleteAction.running

const canAddDictionary = computed(() => canAccess({ permissions: ['system:dict:add'] }))
const canEditDictionary = computed(() => canAccess({ permissions: ['system:dict:edit'] }))
const canRemoveDictionary = computed(() => canAccess({ permissions: ['system:dict:remove'] }))

const enabledOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const dictionaryRules: FormRules<DictionaryForm> = {
  code: [
    { message: '请输入字典编码', required: true },
    { message: '编码应以小写字母开头，仅包含小写字母、数字、点、下划线或连字符', pattern: /^[a-z][a-z0-9_.-]{1,79}$/ },
  ],
  description: [{ max: 1000, message: '描述不能超过 1000 个字符' }],
  name: [
    { message: '请输入字典名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
}

const dictionaryColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 180, title: '字典名称' },
  { colKey: 'code', minWidth: 180, title: '字典编码' },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.enabled ? '启用' : '停用',
      status: row.enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 100,
  },
  { colKey: 'description', ellipsis: true, minWidth: 220, title: '描述' },
  {
    cell: (_h, { row }) => formatDate(new Date(row.updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

const dictionaryErrorDescription = computed(() => dictionaryList.error.value
  ? normalizeFeedbackError(dictionaryList.error.value).message
  : '请检查网络连接后重试')

function getDictionaryActions(row: TableRowData): AppTableAction[] {
  const dictionary = row as SystemDictionary
  const actions: AppTableAction[] = [{
    handler: () => {
      void router.push({
        name: 'SystemDictItems',
        params: { id: dictionary.id },
        query: { name: dictionary.name },
      })
    },
    key: 'items',
    label: '字典项',
  }]
  if (canEditDictionary.value) {
    actions.push(
      {
        handler: () => dictionaryDrawer.openEdit(dictionary),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => dictionaryStatusAction.run({
          dictionary,
          enabled: !dictionary.enabled,
        }),
        key: 'status',
        label: dictionary.enabled ? '停用' : '启用',
        loading: dictionaryStatusRunning.value,
        theme: dictionary.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveDictionary.value) {
    actions.push({
      handler: () => dictionaryDeleteAction.run(dictionary),
      key: 'remove',
      label: '删除',
      loading: dictionaryDeleteRunning.value,
      theme: 'danger',
    })
  }
  return actions
}
</script>

<template>
  <AppPage
  >
    <template #search>
      <AppSearchPanel
        :loading="dictionaryLoading"
        @reset="dictionaryList.reset"
        @search="dictionaryList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="dictionaryList.query.keyword"
            clearable
            placeholder="字典名称、编码或描述"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="dictionaryList.query.enabled" :options="enabledOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="dictionaryColumns"
      :current="dictionaryCurrent"
      :data="dictionaryRows"
      empty-description="可新增第一个动态字典"
      empty-title="暂无字典"
      :error-description="dictionaryErrorDescription"
      :page-size="dictionaryPageSize"
      row-key="id"
      :status="dictionaryTableStatus"
      :total="dictionaryTotal"
      @page-change="dictionaryList.changePage"
      @refresh="dictionaryList.refresh"
      @retry="dictionaryList.retry"
    >
      <template v-if="canAddDictionary" #toolbar>
        <t-button theme="primary" @click="dictionaryDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增字典
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getDictionaryActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :description="dictionaryDrawerMode === 'create' ? '字典编码创建后不可修改。' : '编辑字典名称、描述和状态。'"
      :form-data="dictionaryDrawer.formData"
      :mode="dictionaryDrawerMode"
      :rules="dictionaryRules"
      :submitting="dictionaryDrawerSubmitting"
      :title="dictionaryDrawerMode === 'create' ? '新增字典' : '编辑字典'"
      :visible="dictionaryDrawerVisible"
      @cancel="dictionaryDrawer.close"
      @submit="dictionaryDrawer.submit"
      @update:visible="dictionaryDrawer.setVisible"
    >
      <t-form-item label="字典名称" name="name">
        <t-input v-model="dictionaryDrawer.formData.name" maxlength="120" placeholder="请输入字典名称" />
      </t-form-item>
      <t-form-item label="字典编码" name="code">
        <t-input
          v-model="dictionaryDrawer.formData.code"
          :readonly="dictionaryDrawerMode === 'edit'"
          maxlength="80"
          placeholder="例如 system_status"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-switch v-model="dictionaryDrawer.formData.enabled" :label="['启用', '停用']" />
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="描述" name="description">
        <t-textarea
          v-model="dictionaryDrawer.formData.description"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="1000"
          placeholder="选填，说明字典用途"
        />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>