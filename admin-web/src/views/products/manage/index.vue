<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { createCatalogProduct, deleteCatalogProduct, fetchCatalogProducts, updateCatalogProduct } from '@/api/modules/catalog-products'
import { fetchKnowledgeDocuments } from '@/api/modules/knowledge'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useCrudDelete } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { CatalogProduct, CatalogProductInput, CatalogProductStatus } from '@/types/catalog-product'
import { catalogProductStatusMeta } from '@/utils/catalog-product'
import { formatDate } from '@/utils/day'

interface ProductForm extends Record<string, unknown> {
  name: string
  summary: string
  status: CatalogProductStatus
  knowledgeDocumentIds: string[]
  productType: string
  specClass: 'I' | 'II' | 'III' | ''
  thermalConductivity: number | undefined
  correctionFactor: number | undefined
  thicknessInput: string
  thicknessOptionsMm: number[]
}

const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()
const canAdd = computed(() => canAccess({ permissions: ['system:md:product:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:product:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:product:remove'] }))
const canListKnowledge = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))
const knowledgeOptions = ref<Array<{ label: string, value: string }>>([])
const list = useCrudList<CatalogProduct, { keyword: string, status: CatalogProductStatus | '' }>({
  createQuery: () => ({ keyword: '', status: '' }),
  fetcher: ({ query, page, pageSize, signal }) => fetchCatalogProducts({ keyword: query.keyword.trim() || undefined, page, pageSize, status: query.status || undefined }, signal),
  immediate: true, rowKey: 'id',
})
const drawer = useCrudDrawer<ProductForm, CatalogProduct, { message: string, product: CatalogProduct }>({
  createForm: () => ({ correctionFactor: undefined, knowledgeDocumentIds: [], name: '', productType: '', specClass: '', status: 'ACTIVE', summary: '', thermalConductivity: undefined, thicknessInput: '', thicknessOptionsMm: [] }),
  editForm: entity => ({ correctionFactor: entity.correctionFactor ?? undefined, knowledgeDocumentIds: [...(entity.knowledgeDocumentIds ?? [])], name: entity.name, productType: entity.productType ?? '', specClass: entity.specClass ?? '', status: entity.status, summary: entity.summary ?? '', thermalConductivity: entity.thermalConductivity ?? undefined, thicknessInput: '', thicknessOptionsMm: [...(entity.thicknessOptionsMm ?? [])] }),
  onError: cause => void feedback.messageError(cause),
  onSuccess: async result => { await feedback.message('success', result.message); await list.refresh() },
  submit: ({ data, entity, mode }) => {
    const input: CatalogProductInput = { knowledgeDocumentIds: data.knowledgeDocumentIds ?? [], name: data.name.trim(), productType: data.productType.trim() || null, specClass: data.specClass || null, thermalConductivity: data.thermalConductivity ?? null, correctionFactor: data.correctionFactor ?? null, thicknessOptionsMm: [...new Set(data.thicknessOptionsMm ?? [])].sort((a, b) => a - b), status: data.status, summary: data.summary.trim() || null }
    return mode === 'create' ? createCatalogProduct(input) : updateCatalogProduct(entity!.id, input)
  },
})
const deleteAction = useCrudDelete<CatalogProduct, { message: string }>({ action: product => deleteCatalogProduct(product.id), confirm: product => ({ content: `确认删除产品「${product.name}」吗？`, confirmText: '删除', danger: true, title: '删除产品' }), onSuccess: async () => list.refresh(), successMessage: (_product, result) => result.message })
const formRules: FormRules<ProductForm> = { name: [{ required: true, message: '请输入产品名称' }, { max: 160, message: '产品名称不能超过 160 个字符' }], summary: [{ max: 2000, message: '简介不能超过 2000 个字符' }] }
function addThickness(): void { const value = Number(drawer.formData.thicknessInput); if (!Number.isFinite(value) || value <= 0) { void feedback.message('error', '厚度必须为大于 0 的数字'); return }; drawer.formData.thicknessOptionsMm = [...new Set([...(drawer.formData.thicknessOptionsMm ?? []), value])].sort((a, b) => a - b); drawer.formData.thicknessInput = '' }
function removeThickness(value: number): void { drawer.formData.thicknessOptionsMm = (drawer.formData.thicknessOptionsMm ?? []).filter(item => item !== value) }
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', ellipsis: true, minWidth: 180, title: '产品名称' },
  { colKey: 'productType', minWidth: 110, title: '产品类型', cell: (_, { row }) => (row as CatalogProduct).productType || '—' },
  { colKey: 'specClass', minWidth: 100, title: '规格分类', cell: (_, { row }) => (row as CatalogProduct).specClass ? `${(row as CatalogProduct).specClass}型` : '未指定' },
  { colKey: 'thermalConductivity', minWidth: 130, title: '导热系数 λ', cell: (_, { row }) => String((row as CatalogProduct).thermalConductivity ?? '—') },
  { colKey: 'correctionFactor', minWidth: 120, title: '修正系数 α', cell: (_, { row }) => String((row as CatalogProduct).correctionFactor ?? '—') },
  { colKey: 'thicknessOptionsMm', minWidth: 130, title: '可选厚度', cell: (_, { row }) => ((row as CatalogProduct).thicknessOptionsMm ?? []).join('、') || '—' },
  { colKey: 'knowledgeDocumentIds', minWidth: 120, title: '关联资料', cell: (_, { row }) => { const count = (row as CatalogProduct).knowledgeDocumentIds?.length ?? 0; return count > 0 ? `${count} 份` : '—' } },
  { colKey: 'status', title: '状态', width: 100, cell: (_, { row }) => h(AppStatusTag, catalogProductStatusMeta[(row as CatalogProduct).status]) },
  { colKey: 'updatedAt', minWidth: 170, title: '更新时间', cell: (_, { row }) => formatDate(new Date((row as CatalogProduct).updatedAt)) },
]
function getActions(row: TableRowData): AppTableAction[] { const product = row as CatalogProduct; const actions: AppTableAction[] = []; if (canEdit.value) actions.push({ handler: () => drawer.openEdit(product), key: 'edit', label: '编辑' }); if (canRemove.value) actions.push({ handler: () => deleteAction.run(product), key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger' }); return actions }
const errorDescription = computed(() => list.error.value ? normalizeFeedbackError(list.error.value).message : '请检查网络连接后重试')
const knowledgeSelectOptions = computed(() => { const known = new Map(knowledgeOptions.value.map(item => [item.value, item])); for (const id of drawer.formData.knowledgeDocumentIds ?? []) if (!known.has(id)) known.set(id, { label: id, value: id }); return [...known.values()] })
async function loadKnowledgeOptions(): Promise<void> { if (!canListKnowledge.value) return; try { const page = await fetchKnowledgeDocuments({ page: 1, pageSize: 100, status: 'ACTIVE' }); knowledgeOptions.value = page.items.map(item => ({ label: item.title, value: item.id })) } catch { knowledgeOptions.value = [] } }
onMounted(() => void loadKnowledgeOptions())
</script>

<template>
  <AppPage description="维护甲方产品、对比产品及其已确认结构化数据、产品资料和关联知识资料。" title="产品管理">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search"><t-form-item label="关键词"><t-input v-model="list.query.keyword" clearable placeholder="产品名称" /></t-form-item><t-form-item label="状态"><t-select v-model="list.query.status" :options="[{ label: '全部状态', value: '' }, { label: '启用', value: 'ACTIVE' }, { label: '停用', value: 'DISABLED' }]" clearable placeholder="全部状态" /></t-form-item></AppSearchPanel>
    <AppDataTable class="mt-3" :columns="columns" :current="list.current.value" :data="list.data.value" empty-description="可新增第一个产品" empty-title="暂无产品" :error-description="errorDescription" :page-size="list.pageSize.value" row-key="id" :status="list.tableStatus.value" :total="list.total.value" @page-change="list.changePage" @refresh="list.refresh" @retry="list.retry">
      <template #toolbar><t-button v-if="canAdd" theme="primary" @click="drawer.openCreate"><template #icon><AddIcon /></template>新增产品</t-button></template><template #operations="{ row }"><AppTableActions :actions="getActions(row)" /></template>
    </AppDataTable>
    <AppCrudFormDialog :description="drawer.mode.value === 'create' ? '填写产品基础参数与热工基础参数' : '修改已确认字段'" :form-data="drawer.formData" :mode="drawer.mode.value" :rules="formRules" :submitting="drawer.isSubmitting.value" :title="drawer.mode.value === 'create' ? '新增产品' : '编辑产品'" :visible="drawer.visible.value" @cancel="drawer.close" @submit="drawer.submit" @update:visible="drawer.setVisible">
      <t-form-item label="产品名称" name="name"><t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入产品名称" /></t-form-item>
      <t-form-item label="产品类型" name="productType"><t-input v-model="drawer.formData.productType" maxlength="80" placeholder="如保温材料" /></t-form-item>
      <t-form-item label="规格分类" name="specClass"><t-select v-model="drawer.formData.specClass" :options="[{ label: '未指定', value: '' }, { label: 'I型', value: 'I' }, { label: 'II型', value: 'II' }, { label: 'III型', value: 'III' }]" placeholder="未指定" /></t-form-item>
      <t-form-item label="导热系数 λ" name="thermalConductivity"><t-input-number v-model="drawer.formData.thermalConductivity" :min="0" :decimal-places="6" placeholder="选填" /></t-form-item>
      <t-form-item label="修正系数 α（可空）" name="correctionFactor"><t-input-number v-model="drawer.formData.correctionFactor" :min="0" :decimal-places="6" placeholder="选填" /></t-form-item>
      <t-form-item class="vicp-form-wide" label="可选厚度（mm）" name="thicknessOptionsMm"><div class="vicp-thickness-input"><t-input v-model="drawer.formData.thicknessInput" placeholder="输入大于 0 的数值" @enter="addThickness" /><t-button variant="outline" @click="addThickness">添加</t-button></div><t-space class="vicp-thickness-tags" break-line><t-tag v-for="value in drawer.formData.thicknessOptionsMm" :key="value" closable @close="removeThickness(value)">{{ value }} mm</t-tag><span v-if="drawer.formData.thicknessOptionsMm.length === 0" class="vicp-thickness-empty">暂无可选厚度</span></t-space></t-form-item>
      <t-form-item label="简介" name="summary"><t-textarea v-model="drawer.formData.summary" :autosize="{ minRows: 3, maxRows: 6 }" maxlength="2000" placeholder="选填" /></t-form-item>
      <t-form-item label="关联知识资料" name="knowledgeDocumentIds"><t-select v-model="drawer.formData.knowledgeDocumentIds" filterable :min-collapsed-num="2" multiple :options="knowledgeSelectOptions" placeholder="选择已有知识资料，可留空" /></t-form-item>
      <t-form-item label="状态" name="status"><t-radio-group v-model="drawer.formData.status"><t-radio-button value="ACTIVE">启用</t-radio-button><t-radio-button value="DISABLED">停用</t-radio-button></t-radio-group></t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-thickness-input { display:flex; gap:8px; width:100%; }.vicp-thickness-input :deep(.t-input) { flex:1; }.vicp-thickness-tags { margin-top:8px; }.vicp-thickness-empty { color:var(--td-text-color-placeholder); font-size:var(--td-font-size-body-small); }
</style>
