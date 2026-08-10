<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  confirmStandardReplacement,
  createStandardReplacement,
  deleteStandardReplacement,
  fetchStandardDocuments,
  fetchStandardReplacements,
  rejectStandardReplacement,
} from '@/api/modules/standard'
import type { AppTableAction } from '@/types/crud'
import type { StandardReplacement, StandardReplacementInput } from '@/types/standard'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:standard:add'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:standard:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:standard:approve'] }))

const documentOptions = ref<Array<{ label: string; value: string }>>([])
const documentLoading = ref(false)

async function loadDocumentOptions(): Promise<void> {
  documentLoading.value = true
  try {
    const items = await fetchStandardDocuments({})
    documentOptions.value = items.map((item) => ({
      label: `${item.documentNo} · ${item.title}`,
      value: item.id,
    }))
  }
  finally {
    documentLoading.value = false
  }
}

const list = reactive({
  data: [] as StandardReplacement[],
  isLoading: false,
  error: null as unknown,
  query: reactive({ status: '' }),
  async load(): Promise<void> {
    list.isLoading = true
    list.error = null
    try {
      list.data = await fetchStandardReplacements(list.query.status ? { status: list.query.status as 'PENDING' | 'CONFIRMED' | 'REJECTED' } : {})
    }
    catch (cause) {
      list.error = cause
    }
    finally {
      list.isLoading = false
    }
  },
  async search(): Promise<void> {
    await list.load()
  },
  async reset(): Promise<void> {
    list.query.status = ''
    await list.load()
  },
  retry: () => list.load(),
  refresh: () => list.load(),
})

const drawer = useCrudDrawer<StandardReplacementInput, StandardReplacement>({
  createForm: () => ({
    oldDocumentId: '',
    newDocumentId: '',
    replacementType: 'SUPERSEDE',
    transitionStartAt: '',
    transitionEndAt: '',
    note: '',
  }),
  editForm: () => ({ oldDocumentId: '', newDocumentId: '', replacementType: 'SUPERSEDE' }),
  submit: async ({ data }) => {
    const input = {
      ...data,
      transitionStartAt: data.transitionStartAt || undefined,
      transitionEndAt: data.transitionEndAt || undefined,
      note: data.note || undefined,
    }
    return createStandardReplacement(input)
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<StandardReplacement, unknown>({
  action: (row) => deleteStandardReplacement(row.id),
  confirm: () => ({ title: '删除替代关系', content: '确定删除该替代关系？', danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const confirmAction = useConfirmedCrudAction<StandardReplacement, unknown>({
  action: (row) => confirmStandardReplacement(row.id),
  confirm: () => ({ title: '确认替代', content: '确认后旧标准将标记过期，请谨慎操作。', danger: true }),
  successMessage: '已确认替代',
  onSuccess: () => list.refresh(),
})

const rejectAction = useConfirmedCrudAction<StandardReplacement, unknown>({
  action: (row) => rejectStandardReplacement(row.id),
  confirm: () => ({ title: '拒绝替代', content: '确定拒绝该替代关系？' }),
  successMessage: '已拒绝',
  onSuccess: () => list.refresh(),
})

const errorDescription = computed(() => list.error
  ? normalizeFeedbackError(list.error).message
  : '请检查网络连接后重试')

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待确认', value: 'PENDING' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '已拒绝', value: 'REJECTED' },
]

const statusMeta: Record<string, { label: string; status: 'warning' | 'success' | 'error' }> = {
  PENDING: { label: '待确认', status: 'warning' },
  CONFIRMED: { label: '已确认', status: 'success' },
  REJECTED: { label: '已拒绝', status: 'error' },
}

function documentLabel(id: string): string {
  return documentOptions.value.find((item) => item.value === id)?.label ?? id
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => documentLabel(row.oldDocumentId), colKey: 'oldDocumentId', minWidth: 280, title: '旧标准' },
  { cell: (_, _props) => h('span', { class: 'vicp-replace-arrow' }, '→'), colKey: 'arrow', width: 40 },
  { cell: (_, { row }) => documentLabel(row.newDocumentId), colKey: 'newDocumentId', minWidth: 280, title: '新标准' },
  { cell: (_, { row }) => (row.replacementType === 'SUPERSEDE' ? '替代' : '废止'), colKey: 'replacementType', minWidth: 70, title: '类型' },
  { cell: (_, { row }) => h(AppStatusTag, statusMeta[row.status] ?? { label: row.status, status: 'default' }), colKey: 'status', minWidth: 90, title: '状态' },
  { cell: (_, { row }) => row.confirmedAt ? formatDate(new Date(row.confirmedAt), 'YYYY-MM-DD') : '—', colKey: 'confirmedAt', minWidth: 110, title: '确认时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as StandardReplacement
  const actions: AppTableAction[] = []
  if (canApprove.value && entity.status === 'PENDING') {
    actions.push({
      key: 'confirm', label: '确认', loading: confirmAction.running.value,
      handler: () => confirmAction.run(entity),
    })
    actions.push({
      key: 'reject', label: '拒绝', loading: rejectAction.running.value, theme: 'danger',
      handler: () => rejectAction.run(entity),
    })
  }
  if (canRemove.value && entity.status === 'PENDING') {
    actions.push({
      key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}

onMounted(loadDocumentOptions)
</script>

<template>
  <AppPage title="替代关系" description="新旧标准替代/废止关系；确认后旧标准自动标记过期，替代关系生效期内兼容并存。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading" @reset="list.reset" @search="list.search">
        <t-form-item label="状态">
          <t-select v-model="list.query.status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="list.data"
      empty-description="可新增第一条替代关系"
      empty-title="暂无替代关系"
      :error-description="errorDescription"
      :operations-width="180"
      :show-pagination="false"
      row-key="id"
      :status="list.isLoading ? 'loading' : list.error ? 'error' : 'ready'"
      :total="list.data.length"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon><AddIcon /></template>
          新增替代关系
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
      title="新增替代关系"
      :visible="drawer.visible.value"
      :width="'min(760px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item class="vicp-form-wide" label="旧标准" name="oldDocumentId" required-mark>
        <t-select
          v-model="drawer.formData.oldDocumentId"
          :loading="documentLoading"
          :options="documentOptions"
          filterable
          placeholder="被替代/废止的标准"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="新标准" name="newDocumentId" required-mark>
        <t-select
          v-model="drawer.formData.newDocumentId"
          :loading="documentLoading"
          :options="documentOptions"
          filterable
          placeholder="替代后生效的标准"
        />
      </t-form-item>
      <t-form-item label="关系类型" name="replacementType">
        <t-radio-group
          v-model="drawer.formData.replacementType"
          :options="[
            { label: '替代（SUPERSEDE）', value: 'SUPERSEDE' },
            { label: '废止（REPEAL）', value: 'REPEAL' },
          ]"
        />
      </t-form-item>
      <t-form-item label="过渡期开始" name="transitionStartAt">
        <t-date-picker v-model="drawer.formData.transitionStartAt" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item label="过渡期结束" name="transitionEndAt">
        <t-date-picker v-model="drawer.formData.transitionEndAt" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="说明" name="note">
        <t-textarea v-model="drawer.formData.note" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="选填" />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-replace-arrow {
  color: var(--td-brand-color);
  font-weight: var(--td-font-weight-medium);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>