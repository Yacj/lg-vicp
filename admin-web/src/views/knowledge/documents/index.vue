<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppEvidenceColumnHeader from '@/components/business/AppEvidenceColumnHeader.vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  fetchKnowledgeCategories,
  fetchKnowledgeDocuments,
  updateKnowledgeDocument,
} from '@/api/modules/knowledge'
import type { AppTableAction } from '@/types/crud'
import {
  knowledgeDocTypes,
  type KnowledgeCategory,
  type KnowledgeDocType,
  type KnowledgeDocument,
  type KnowledgeDocumentInput,
} from '@/types/knowledge'
import type { EvidenceLevel } from '@/types/professional'
import { evidenceLevelLabels, knowledgeVersionStatusMeta } from '@/utils/professional-status'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const router = useRouter()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:doc:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:knowledge:doc:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:doc:remove'] }))
const canViewDetail = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))

const keyword = ref('')
const docType = ref<KnowledgeDocType | undefined>(undefined)
const status = ref<'ACTIVE' | 'DISABLED' | undefined>(undefined)
const query = reactive({ page: 1, pageSize: 20 })
const documents = ref<KnowledgeDocument[]>([])
const categories = ref<KnowledgeCategory[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeDocuments({
      page: query.page,
      pageSize: query.pageSize,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(docType.value ? { docType: docType.value } : {}),
      ...(status.value ? { status: status.value } : {}),
    })
    documents.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

async function loadCategories(): Promise<void> {
  try {
    const result = await fetchKnowledgeCategories()
    categories.value = result.items
  }
  catch {
    categories.value = []
  }
}

function search(): void {
  query.page = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  docType.value = undefined
  status.value = undefined
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

const drawer = useCrudDrawer<KnowledgeDocumentInput, KnowledgeDocument>({
  createForm: () => ({ title: '', docType: 'OTHER', allowedPurposes: ['检索'] }),
  editForm: (entity) => ({
    title: entity.title,
    docType: entity.docType,
    docNumber: entity.docNumber ?? undefined,
    sourceOrg: entity.sourceOrg ?? undefined,
    issueDate: entity.issueDate ?? undefined,
    effectiveDate: entity.effectiveDate ?? undefined,
    evidenceLevel: entity.evidenceLevel ?? undefined,
    allowedPurposes: entity.allowedPurposes,
    categoryId: entity.categoryId ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    if (mode === 'create') {
      return (await createKnowledgeDocument(data)).document
    }
    return (await updateKnowledgeDocument(entity!.id, data)).document
  },
  onSuccess: () => load(),
})

const deleteAction = useConfirmedCrudAction<KnowledgeDocument, unknown>({
  action: async (row) => {
    await deleteKnowledgeDocument(row.id)
  },
  confirm: (row) => ({ title: '删除文档', content: `确定删除「${row.title}」？关联版本与解析内容将一并清理。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const docTypeLabel: Record<KnowledgeDocType, string> = {
  SPECIFICATION: '产品规范',
  DETAIL_ATLAS: '图集',
  STANDARD: '标准',
  APPLICATION_GUIDE: '应用指南',
  MATERIAL_COMPARISON: '材料对比',
  COMPANY_PROFILE: '企业资料',
  THERMAL_FORMULA: '热工公式',
  OTHER: '其他',
}

function categoryName(id: string | null): string {
  if (!id) {
    return '—'
  }
  return categories.value.find((item) => item.id === id)?.name ?? id
}

function versionStatusCell(row: KnowledgeDocument) {
  if (!row.currentVersion) {
    return h('span', { class: 'vicp-no-version' }, '未上传版本')
  }
  const meta = knowledgeVersionStatusMeta[row.currentVersion.status]
  return h('div', [
    h(AppStatusTag, { label: meta.label, status: meta.status }),
    h('div', { class: 'vicp-version-meta' }, `v${row.currentVersion.version} · ${row.currentVersion.pageCount != null ? `${row.currentVersion.pageCount} 页` : '未解析'}`),
  ])
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-doc-title' }, row.title),
    h('div', { class: 'vicp-doc-meta' }, [
      docTypeLabel[row.docType as KnowledgeDocType] ?? row.docType,
      row.docNumber ? ` · ${row.docNumber}` : '',
      row.sourceOrg ? ` · ${row.sourceOrg}` : '',
    ]),
  ]), colKey: 'title', minWidth: 300, title: '文档' },
  { cell: (_, { row }) => categoryName((row as KnowledgeDocument).categoryId), colKey: 'categoryId', minWidth: 120, title: '分类' },
  { cell: (_, { row }) => versionStatusCell(row as KnowledgeDocument), colKey: 'currentVersion', minWidth: 160, title: '当前版本' },
  { cell: (_, { row }) => (row.evidenceLevel ? evidenceLevelLabels[row.evidenceLevel as EvidenceLevel] : '—'), colKey: 'evidenceLevel', minWidth: 130, title: () => h(AppEvidenceColumnHeader, { title: '资料可信度' }) },
  { cell: (_, { row }) => (row.status === 'ACTIVE' ? '启用' : '停用'), colKey: 'status', minWidth: 70, title: '状态' },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt), 'YYYY-MM-DD'), colKey: 'updatedAt', minWidth: 110, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeDocument
  const actions: AppTableAction[] = []
  if (canViewDetail.value) {
    actions.push({
      key: 'detail',
      label: '版本管理',
      handler: () => router.push({ name: 'KnowledgeDocumentDetail', params: { id: entity.id } }),
    })
  }
  if (canEdit.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  if (canRemove.value) {
    actions.push({
      key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}

onMounted(() => {
  void loadCategories()
  void load()
})
</script>

<template>
  <AppPage title="文档资料" description="知识文档库：规范、图集、标准等资料及版本管理；版本上传、解析、审核与发布在「版本管理」详情页完成。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="标题 / 编号 / 来源" />
        </t-form-item>
        <t-form-item label="文档类型">
          <t-select
            v-model="docType"
            :options="knowledgeDocTypes.map((value) => ({ label: docTypeLabel[value], value }))"
            clearable
            placeholder="全部"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select
            v-model="status"
            :options="[{ label: '启用', value: 'ACTIVE' }, { label: '停用', value: 'DISABLED' }]"
            clearable
            placeholder="全部"
          />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="documents"
      empty-description="可新增第一个知识文档"
      empty-title="暂无文档"
      :error-description="errorDescription"
      :operations-width="220"
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
          新增文档
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
      :title="drawer.mode.value === 'create' ? '新增文档' : '编辑文档'"
      :visible="drawer.visible.value"
      :width="'min(640px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="标题" name="title" required-mark>
        <t-input v-model="drawer.formData.title" maxlength="200" placeholder="如：外墙外保温工程技术标准" />
      </t-form-item>
      <t-form-item label="文档类型" name="docType">
        <t-select
          v-model="drawer.formData.docType"
          :options="knowledgeDocTypes.map((value) => ({ label: docTypeLabel[value], value }))"
        />
      </t-form-item>
      <t-form-item label="文档编号" name="docNumber">
        <t-input v-model="drawer.formData.docNumber" maxlength="80" placeholder="如：JGJ 144" />
      </t-form-item>
      <t-form-item label="来源机构" name="sourceOrg">
        <t-input v-model="drawer.formData.sourceOrg" maxlength="120" placeholder="如：住建部" />
      </t-form-item>
      <t-form-item label="发布/施行日期" name="issueDate">
        <t-date-picker v-model="drawer.formData.issueDate" clearable style="width: 100%" />
      </t-form-item>
      <t-form-item label="资料可信度" name="evidenceLevel">
        <t-select
          v-model="drawer.formData.evidenceLevel"
          :options="(Object.keys(evidenceLevelLabels) as (keyof typeof evidenceLevelLabels)[]).map((value) => ({ label: evidenceLevelLabels[value], value }))"
          clearable
          placeholder="未标注"
        />
      </t-form-item>
      <t-form-item label="分类" name="categoryId">
        <t-select
          v-model="drawer.formData.categoryId"
          :options="categories.map((item) => ({ label: item.name, value: item.id }))"
          clearable
          placeholder="未分类"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="可用用途" name="allowedPurposes">
        <t-select
          v-model="drawer.formData.allowedPurposes"
          :options="[{ label: '检索', value: '检索' }, { label: '对比', value: '对比' }, { label: '报告引用', value: '报告引用' }]"
          multiple
          placeholder="选择文档可被引用的场景"
        />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-doc-title {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-doc-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-version-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  margin-top: 2px;
}
.vicp-no-version {
  color: var(--td-text-color-placeholder);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>