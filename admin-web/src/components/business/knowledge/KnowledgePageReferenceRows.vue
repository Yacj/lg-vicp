<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { onMounted, ref, watch } from 'vue'
import { fetchConstructionSchemes, fetchInsulationSystems } from '@/api/modules/construction'
import { fetchPageReferenceRows } from '@/api/modules/knowledge'
import { fetchProductSeries, fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { fetchThermalSetRows } from '@/api/modules/thermal'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { ConstructionScheme, InsulationSystem } from '@/types/construction'
import type { ProductSeries, ProductSpec } from '@/types/masterdata'
import type { ThermalRow } from '@/types/thermal'

/**
 * 知识页面已关联的热工参考方案（只读结构化投影）。
 * reference-rows 契约只返回行 id / setId / 厚度 / R / K，
 * 体系、构造编号、基层、产品、型号通过热工参考行与构造/产品字典富化；
 * 字典接口无权限或失败时降级为仅展示数值字段，不阻断页面预览。
 */
interface PageReferenceRowView {
  id: string
  systemName: string | null
  schemeCode: string | null
  substrateMaterial: string | null
  productName: string | null
  specLabel: string | null
  thicknessMm: number
  productThermalResistance: number
  totalThermalResistance: number
  kValue: number
}

const props = defineProps<{ versionId: string | null, physicalPageNumber: number | null }>()

const items = ref<PageReferenceRowView[]>([])
const loading = ref(false)
const error = ref<unknown>(null)

async function loadDictionary<T>(loader: () => Promise<{ items: T[] }>): Promise<T[]> {
  try {
    return (await loader()).items
  }
  catch {
    // 字典接口按权限降级：缺失时仅展示 reference-rows 返回的数值字段
    return []
  }
}

async function load(): Promise<void> {
  if (!props.versionId || props.physicalPageNumber === null) {
    items.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const result = await fetchPageReferenceRows(props.versionId, props.physicalPageNumber)
    if (result.items.length === 0) {
      items.value = []
      return
    }
    const setIds = [...new Set(result.items.map(item => item.setId))]
    const rowMap = new Map<string, ThermalRow>()
    const setRows = await Promise.all(setIds.map(setId => loadDictionary(() => fetchThermalSetRows(setId, { page: 1, pageSize: 100 }))))
    for (const rows of setRows) {
      for (const row of rows) rowMap.set(row.id, row)
    }
    const [schemes, systems, specs, series] = await Promise.all([
      loadDictionary<ConstructionScheme>(() => fetchConstructionSchemes({ page: 1, pageSize: 100 })),
      loadDictionary<InsulationSystem>(() => fetchInsulationSystems({ page: 1, pageSize: 100 })),
      loadDictionary<ProductSpec>(() => fetchPublishedProductSpecs({ page: 1, pageSize: 100 })),
      loadDictionary<ProductSeries>(() => fetchProductSeries({ page: 1, pageSize: 100 })),
    ])
    items.value = result.items.map((item) => {
      const row = rowMap.get(item.id)
      const scheme = row ? schemes.find(entry => entry.id === row.schemeId) : undefined
      const system = scheme ? systems.find(entry => entry.id === scheme.systemId) : undefined
      const spec = row ? specs.find(entry => entry.id === row.productSpecId) : undefined
      const specSeries = spec ? series.find(entry => entry.id === spec.seriesId) : undefined
      return {
        id: item.id,
        systemName: system?.name ?? null,
        schemeCode: scheme?.schemeCode ?? null,
        substrateMaterial: scheme?.substrateMaterial ?? null,
        productName: specSeries?.name ?? null,
        specLabel: spec ? `${spec.specCode} · ${spec.specClass}型` : null,
        thicknessMm: item.thicknessMm,
        productThermalResistance: item.productThermalResistance,
        totalThermalResistance: item.totalThermalResistance,
        kValue: item.kValue,
      }
    })
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    loading.value = false
  }
}

watch(() => [props.versionId, props.physicalPageNumber], () => void load())
onMounted(() => void load())

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'systemName', title: '体系', minWidth: 150, cell: (_, { row }) => (row as PageReferenceRowView).systemName ?? '—' },
  { colKey: 'schemeCode', title: '构造编号', width: 100, cell: (_, { row }) => (row as PageReferenceRowView).schemeCode ?? '—' },
  { colKey: 'substrateMaterial', title: '基层', minWidth: 110, cell: (_, { row }) => (row as PageReferenceRowView).substrateMaterial ?? '—' },
  { colKey: 'productName', title: '产品', minWidth: 110, cell: (_, { row }) => (row as PageReferenceRowView).productName ?? '—' },
  { colKey: 'specLabel', title: '型号', minWidth: 120, cell: (_, { row }) => (row as PageReferenceRowView).specLabel ?? '—' },
  { colKey: 'thicknessMm', title: '厚度', width: 80, cell: (_, { row }) => `${(row as PageReferenceRowView).thicknessMm} mm` },
  { colKey: 'productThermalResistance', title: '产品层 R', width: 100 },
  { colKey: 'totalThermalResistance', title: '总 R', width: 90 },
  { colKey: 'kValue', title: 'K', width: 80 },
]
</script>

<template>
  <section class="page-reference-rows">
    <header class="page-reference-rows__header">
      <h3>关联参考方案</h3>
    </header>
    <t-loading v-if="loading" text="正在加载参考方案" />
    <t-alert v-else-if="error" theme="error" :message="normalizeFeedbackError(error).message" closeable @close="load" />
    <t-table
      v-else-if="items.length"
      :columns="columns"
      :data="items"
      bordered
      row-key="id"
      size="small"
      :pagination="undefined"
    />
    <p v-else class="page-reference-rows__empty">当前页面未关联参考方案</p>
  </section>
</template>

<style scoped>
.page-reference-rows { margin-top:16px; }
.page-reference-rows__header h3 { margin:0 0 10px; color:var(--td-text-color-primary); font-size:15px; }
.page-reference-rows__empty { margin:0; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
</style>
