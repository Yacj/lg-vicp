<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { createThermalRow, deleteThermalRow, fetchThermalSetRows, updateThermalRow } from '@/api/modules/thermal'
import { fetchConstructionSchemes, fetchInsulationSystems } from '@/api/modules/construction'
import { fetchPublishedProductSpecs, fetchProductSeries } from '@/api/modules/masterdata'
import { fetchCatalogProducts } from '@/api/modules/catalog-products'
import { fetchKnowledgeDocuments } from '@/api/modules/knowledge'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import KnowledgeSourcePagePicker from '@/components/business/knowledge/KnowledgeSourcePagePicker.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import type { ThermalRow, ThermalRowInput, ThermalSet } from '@/types/thermal'
import type { ConstructionScheme, InsulationSystem } from '@/types/construction'
import type { ProductSpec, ProductSeries } from '@/types/masterdata'
import type { CatalogProduct } from '@/types/catalog-product'
import type { KnowledgeDocument, KnowledgePage } from '@/types/knowledge'

const props = withDefaults(defineProps<{ set: ThermalSet, editable?: boolean }>(), { editable: true })
const { canAccess } = usePermissionAccess()
const canEdit = computed(() => props.editable && canAccess({ permissions: ['system:thermal:edit'] }))
const rows = ref<ThermalRow[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<unknown>(null)
const rowsVisible = ref(true)
const editorVisible = ref(false)
const editing = ref<ThermalRow | null>(null)
const form = ref<ThermalRowInput>(emptyForm())
const schemes = ref<ConstructionScheme[]>([])
const systems = ref<InsulationSystem[]>([])
const specs = ref<ProductSpec[]>([])
const series = ref<ProductSeries[]>([])
const catalogProducts = ref<CatalogProduct[]>([])
const documents = ref<KnowledgeDocument[]>([])
const selectedDocumentId = ref<string | null>(null)
const selectedPageId = ref<string | null>(null)

function emptyForm(): ThermalRowInput {
  return { schemeId: '', productSpecId: '', thicknessMm: 0, productThermalResistance: 0, totalThermalResistance: 0, kValue: 0, rawThickness: '', rawProductResistance: '', rawTotalResistance: '', rawKValue: '', evidenceSource: '', evidenceRef: '', evidenceLevel: 'A', catalogProductId: null, sourceDocumentId: null, sourcePageId: null, sourcePageLabel: null, sortOrder: 0 }
}
const schemeOptions = computed(() => schemes.value.map(item => ({ label: `${item.schemeCode} · ${item.name} · ${item.substrateMaterial}`, value: item.id })))
const specOptions = computed(() => specs.value.map(item => ({ label: `${series.value.find(s => s.id === item.seriesId)?.name ?? '产品'} · ${item.specCode} · ${item.specClass}型`, value: item.id })))
const catalogProductOptions = computed(() => catalogProducts.value.map(item => ({ label: item.name, value: item.id })))
function schemeOf(id: string): ConstructionScheme | undefined { return schemes.value.find(row => row.id === id) }
function specOf(id: string): ProductSpec | undefined { return specs.value.find(row => row.id === id) }
function systemName(id: string): string { const scheme = schemeOf(id); const system = scheme ? systems.value.find(row => row.id === scheme.systemId) : undefined; return system?.name ?? '—' }
function schemeCode(id: string): string { return schemeOf(id)?.schemeCode ?? '—' }
function substrateMaterial(id: string): string { return schemeOf(id)?.substrateMaterial ?? '—' }
function productName(id: string): string { const spec = specOf(id); return (spec ? series.value.find(s => s.id === spec.seriesId)?.name : undefined) ?? '—' }
function specLabel(id: string): string { const spec = specOf(id); return spec ? `${spec.specCode} · ${spec.specClass}型` : '—' }

async function load(): Promise<void> {
  loading.value = true; error.value = null
  try { const result = await fetchThermalSetRows(props.set.id, { page: 1, pageSize: 100 }); rows.value = result.items; total.value = result.total }
  catch (cause) { error.value = cause }
  finally { loading.value = false }
}
async function loadOptions(): Promise<void> {
  try {
    const [schemeResult, systemResult, specResult, seriesResult, catalogResult, documentResult] = await Promise.all([
      fetchConstructionSchemes({ page: 1, pageSize: 100 }),
      fetchInsulationSystems({ page: 1, pageSize: 100 }),
      fetchPublishedProductSpecs({ page: 1, pageSize: 100 }),
      fetchProductSeries({ page: 1, pageSize: 100 }),
      fetchCatalogProducts({ page: 1, pageSize: 100, status: 'ACTIVE' }),
      fetchKnowledgeDocuments({ page: 1, pageSize: 100, status: 'ACTIVE' }),
    ])
    schemes.value = schemeResult.items; systems.value = systemResult.items; specs.value = specResult.items; series.value = seriesResult.items; catalogProducts.value = catalogResult.items; documents.value = documentResult.items
  } catch { /* 选择器为空时仍允许维护已有数据 */ }
}
watch(() => props.set.id, () => void load())
onMounted(() => { void load(); void loadOptions() })
function open(): void { rowsVisible.value = true; void load() }
function openCreate(): void { editing.value = null; form.value = emptyForm(); selectedDocumentId.value = null; selectedPageId.value = null; editorVisible.value = true }
function openEdit(row: ThermalRow): void {
  editing.value = row; form.value = { schemeId: row.schemeId, productSpecId: row.productSpecId, thicknessMm: row.thicknessMm, productThermalResistance: row.productThermalResistance, totalThermalResistance: row.totalThermalResistance, kValue: row.kValue, rawThickness: row.rawThickness, rawProductResistance: row.rawProductResistance, rawTotalResistance: row.rawTotalResistance, rawKValue: row.rawKValue, evidenceSource: row.evidenceSource, evidenceRef: row.evidenceRef, evidenceLevel: row.evidenceLevel, catalogProductId: row.catalogProductId, sourceDocumentId: row.sourceDocumentId, sourcePageId: row.sourcePageId, sourcePageLabel: row.sourcePageLabel, sortOrder: row.sortOrder }
  selectedDocumentId.value = row.sourceDocumentId ?? null; selectedPageId.value = row.sourcePageId ?? null; editorVisible.value = true
}
function onSelectPage(page: KnowledgePage | null): void { form.value.sourcePageId = page?.id ?? null; form.value.sourcePageLabel = page?.pageLabel ?? (page ? String(page.physicalPageNumber) : null) }
function onCatalogProductChange(value: unknown): void { form.value.catalogProductId = typeof value === 'string' && value ? value : null }
watch(selectedDocumentId, value => { form.value.sourceDocumentId = value || null })
async function save(): Promise<void> {
  if (!form.value.schemeId || !form.value.productSpecId || !form.value.thicknessMm || !form.value.productThermalResistance || !form.value.totalThermalResistance || !form.value.kValue) { MessagePlugin.warning('请完整填写构造方案、产品规格和热工数值'); return }
  const payload: ThermalRowInput = {
    ...form.value,
    catalogProductId: form.value.catalogProductId || null,
    rawThickness: form.value.rawThickness || String(form.value.thicknessMm),
    rawProductResistance: form.value.rawProductResistance || String(form.value.productThermalResistance),
    rawTotalResistance: form.value.rawTotalResistance || String(form.value.totalThermalResistance),
    rawKValue: form.value.rawKValue || String(form.value.kValue),
  }
  try { if (editing.value) await updateThermalRow(editing.value.id, payload); else await createThermalRow(props.set.id, payload); MessagePlugin.success('参考方案已保存'); editorVisible.value = false; await load() }
  catch (cause) { MessagePlugin.error(normalizeFeedbackError(cause).message) }
}
const deleteAction = useConfirmedCrudAction<ThermalRow, unknown>({ action: row => deleteThermalRow(row.id), confirm: row => ({ title: '删除参考方案', content: `确认删除厚度 ${row.thicknessMm}mm 的参考方案吗？`, danger: true }), successMessage: '已删除', onSuccess: () => load() })
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'systemId', title: '体系', minWidth: 170, cell: (_, { row }) => systemName((row as ThermalRow).schemeId) },
  { colKey: 'schemeId', title: '构造编号', width: 100, cell: (_, { row }) => schemeCode((row as ThermalRow).schemeId) },
  { colKey: 'substrateMaterial', title: '基层', minWidth: 110, cell: (_, { row }) => substrateMaterial((row as ThermalRow).schemeId) },
  { colKey: 'productName', title: '产品', minWidth: 110, cell: (_, { row }) => productName((row as ThermalRow).productSpecId) },
  { colKey: 'productSpecId', title: '型号', minWidth: 130, cell: (_, { row }) => specLabel((row as ThermalRow).productSpecId) },
  { colKey: 'thicknessMm', title: '厚度', width: 80, cell: (_, { row }) => `${(row as ThermalRow).thicknessMm} mm` },
  { colKey: 'productThermalResistance', title: '产品层 R', width: 110 },
  { colKey: 'totalThermalResistance', title: '总 R', width: 100 },
  { colKey: 'kValue', title: 'K', width: 90 },
  { colKey: 'evidenceSource', title: '来源资料', minWidth: 150, cell: (_, { row }) => (row as ThermalRow).evidenceSource || '—' },
  { colKey: 'sourcePageLabel', title: '来源页', width: 120, cell: (_, { row }) => (row as ThermalRow).sourcePageLabel || '未关联原始页面' },
]
</script>

<template>
  <t-drawer v-model:visible="rowsVisible" attach="body" :header="`参考方案 · ${set.name}`" placement="right" size="min(1180px, 96vw)" :footer="false" @open="open">
    <div class="thermal-rows">
      <div class="thermal-rows__head"><div><strong>{{ set.code }} · {{ set.name }}</strong><p>维护结构化厚度、R、K 与原始资料来源；来源页面允许暂不关联。</p></div><t-button v-if="canEdit" theme="primary" @click="openCreate"><template #icon><AddIcon /></template>新增参考方案</t-button></div>
      <AppDataTable :columns="columns" :current="1" :data="rows" empty-title="暂无参考方案" empty-description="请新增一条结构化参考方案" :error-description="error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'" row-key="id" :total="total" :page-size="200" :status="loading ? 'loading' : error ? 'error' : 'ready'" @refresh="load" @retry="load">
        <template #operations="{ row }"><AppTableActions :actions="canEdit ? [{ key: 'edit', label: '编辑', handler: () => openEdit(row as ThermalRow) }, { key: 'remove', label: '删除', theme: 'danger', loading: deleteAction.running.value, handler: () => deleteAction.run(row as ThermalRow) }] : []" /></template>
      </AppDataTable>
    </div>
  </t-drawer>
  <t-dialog v-model:visible="editorVisible" header="参考方案编辑" :footer="false" destroy-on-close>
    <t-form :data="form" label-align="top">
      <t-form-item label="构造方案" required-mark><t-select v-model="form.schemeId" filterable :options="schemeOptions" placeholder="选择构造方案" /></t-form-item>
      <t-form-item label="产品规格" required-mark><t-select v-model="form.productSpecId" filterable :options="specOptions" placeholder="选择产品规格" /></t-form-item>
      <t-form-item label="目录产品"><t-select :value="form.catalogProductId ?? undefined" clearable filterable :options="catalogProductOptions" placeholder="关联目录产品（可留空）" @change="onCatalogProductChange" /></t-form-item>
      <t-form-item label="厚度（mm）" required-mark><t-input-number v-model="form.thicknessMm" :min="0" /></t-form-item>
      <t-form-item label="产品层热阻 R" required-mark><t-input-number v-model="form.productThermalResistance" :min="0" :decimal-places="6" /></t-form-item>
      <t-form-item label="总热阻 R" required-mark><t-input-number v-model="form.totalThermalResistance" :min="0" :decimal-places="6" /></t-form-item>
      <t-form-item label="K 值" required-mark><t-input-number v-model="form.kValue" :min="0" :decimal-places="6" /></t-form-item>
      <t-form-item label="排序"><t-input-number v-model="form.sortOrder" :min="0" placeholder="数值越小越靠前" /></t-form-item>
      <t-form-item label="来源页面" help="选择知识资料后按页面卡片选择来源页；可暂不关联，后续再补">
        <KnowledgeSourcePagePicker v-model:document-id="selectedDocumentId" v-model:page-id="selectedPageId" :documents="documents" :disabled="!canEdit" @select-page="onSelectPage" />
      </t-form-item>
      <t-form-item label="原始页码 / 条款" required-mark><t-input v-model="form.evidenceRef" placeholder="如 A1、21" /></t-form-item>
      <t-form-item label="来源资料名称" required-mark><t-input v-model="form.evidenceSource" placeholder="如 VICP 热工计算参考表" /></t-form-item>
      <t-space><t-button variant="outline" @click="editorVisible = false">取消</t-button><t-button theme="primary" @click="save">保存</t-button></t-space>
    </t-form>
  </t-dialog>
</template>

<style scoped>
.thermal-rows__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
.thermal-rows__head strong { color:var(--td-text-color-primary); }
.thermal-rows__head p { margin:6px 0 0; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
</style>
