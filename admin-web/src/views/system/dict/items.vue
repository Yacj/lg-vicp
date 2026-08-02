<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { DictionaryItemForm } from '@/composables/useDictionaryItems'
import { useDictionaryItems } from '@/composables/useDictionaryItems'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { SystemDictionaryItem } from '@/types/system-management'
import { formatDate } from '@/utils/day'
import { parseMetadataText } from '@/utils/system-management'

defineOptions({ name: 'SystemDictItems' })

const route = useRoute()
const router = useRouter()
const dictionaryId = String(route.params.id)
const dictionaryName = typeof route.query.name === 'string' ? route.query.name : ''

const {
  itemDeleteAction,
  itemDrawer,
  itemList,
  itemStatusAction,
} = useDictionaryItems(dictionaryId)
const { canAccess } = usePermissionAccess()

const itemRows = itemList.data
const itemCurrent = itemList.current
const itemPageSize = itemList.pageSize
const itemTotal = itemList.total
const itemTableStatus = itemList.tableStatus
const itemLoading = itemList.isLoading
const itemDrawerVisible = itemDrawer.visible
const itemDrawerMode = itemDrawer.mode
const itemDrawerSubmitting = itemDrawer.isSubmitting
const itemStatusRunning = itemStatusAction.running
const itemDeleteRunning = itemDeleteAction.running
const itemErrorDescription = computed(() => itemList.error.value
  ? normalizeFeedbackError(itemList.error.value).message
  : '请检查网络连接后重试')

const canAddDictionaryItem = computed(() => canAccess({ permissions: ['system:dict:item:add'] }))
const canEditDictionary = computed(() => canAccess({ permissions: ['system:dict:edit'] }))
const canRemoveDictionary = computed(() => canAccess({ permissions: ['system:dict:remove'] }))

const enabledOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const dictionaryItemRules: FormRules<DictionaryItemForm> = {
  label: [
    { message: '请输入字典标签', required: true },
    { max: 120, message: '标签不能超过 120 个字符' },
  ],
  metadata: [{
    validator: (value) => {
      try {
        parseMetadataText(String(value ?? ''))
        return true
      }
      catch (error) {
        return { message: error instanceof Error ? error.message : '元数据格式不正确', result: false }
      }
    },
  }],
  sortOrder: [{ message: '排序值必须是整数', number: true }],
  value: [
    { message: '请输入字典值', required: true },
    { max: 120, message: '字典值不能超过 120 个字符' },
  ],
}

const itemColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'label', minWidth: 160, title: '字典标签' },
  { colKey: 'value', minWidth: 160, title: '字典值' },
  { colKey: 'sortOrder', title: '排序', width: 90 },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.enabled ? '启用' : '停用',
      status: row.enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 100,
  },
  {
    cell: (_h, { row }) => row.metadata ? JSON.stringify(row.metadata) : '—',
    colKey: 'metadata',
    ellipsis: true,
    minWidth: 220,
    title: '元数据',
  },
  {
    cell: (_h, { row }) => formatDate(new Date(row.updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

function getDictionaryItemActions(row: TableRowData): AppTableAction[] {
  const item = row as SystemDictionaryItem
  const actions: AppTableAction[] = []
  if (canEditDictionary.value) {
    actions.push(
      {
        handler: () => itemDrawer.openEdit(item),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => itemStatusAction.run({ enabled: !item.enabled, item }),
        key: 'status',
        label: item.enabled ? '停用' : '启用',
        loading: itemStatusRunning.value,
        theme: item.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveDictionary.value) {
    actions.push({
      handler: () => itemDeleteAction.run(item),
      key: 'remove',
      label: '删除',
      loading: itemDeleteRunning.value,
      theme: 'danger',
    })
  }
  return actions
}

function goBack(): void {
  if (window.history.state?.back) {
    router.back()
  }
  else {
    router.push('/system/dict')
  }
}
</script>

<template>
  <AppPage>
    <template #navigation>
      <t-button  theme="default" variant="outline" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回字典列表
      </t-button>
    </template>

    <template #search>
      <AppSearchPanel
        :loading="itemLoading"
        @reset="itemList.reset"
        @search="itemList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="itemList.query.keyword"
            clearable
            placeholder="字典标签或字典值"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="itemList.query.enabled" :options="enabledOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="itemColumns"
      :current="itemCurrent"
      :data="itemRows"
      empty-description="可为当前字典新增第一个字典项"
      empty-title="暂无字典项"
      :error-description="itemErrorDescription"
      :page-size="itemPageSize"
      row-key="id"
      :status="itemTableStatus"
      :total="itemTotal"
      @page-change="itemList.changePage"
      @refresh="itemList.refresh"
      @retry="itemList.retry"
    >
      <template v-if="canAddDictionaryItem" #toolbar>
        <t-button theme="primary" @click="itemDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增字典项
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getDictionaryItemActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :description="`所属字典：${dictionaryName}`"
      :form-data="itemDrawer.formData"
      :mode="itemDrawerMode"
      :rules="dictionaryItemRules"
      :submitting="itemDrawerSubmitting"
      :title="itemDrawerMode === 'create' ? '新增字典项' : '编辑字典项'"
      :visible="itemDrawerVisible"
      @cancel="itemDrawer.close"
      @submit="itemDrawer.submit"
      @update:visible="itemDrawer.setVisible"
    >
      <t-form-item label="字典标签" name="label">
        <t-input v-model="itemDrawer.formData.label" maxlength="120" placeholder="请输入展示标签" />
      </t-form-item>
      <t-form-item label="字典值" name="value">
        <t-input v-model="itemDrawer.formData.value" maxlength="120" placeholder="请输入持久化值" />
      </t-form-item>
      <t-form-item label="排序" name="sortOrder">
        <t-input-number
          v-model="itemDrawer.formData.sortOrder"
          :decimal-places="0"
          placeholder="数值越小越靠前"
          theme="column"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-switch v-model="itemDrawer.formData.enabled" :label="['启用', '停用']" size="large"/>
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="元数据" name="metadata">
        <t-textarea
          v-model="itemDrawer.formData.metadata"
          :autosize="{ minRows: 4, maxRows: 10 }"
          placeholder="选填，仅支持 JSON 对象，例如 { &quot;color&quot;: &quot;green&quot; }"
        />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>