<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { ConstructionScheme, InsulationSystem } from '@/types/construction'
import type { KnowledgePage } from '@/types/knowledge'
import type { ProductSeries, ProductSpec } from '@/types/masterdata'
import type { ThermalRow, ThermalSet } from '@/types/thermal'
import { computed, h, onMounted, ref, watch } from 'vue'
import { fetchConstructionSchemes, fetchInsulationSystems } from '@/api/modules/construction'
import { fetchVersionPages } from '@/api/modules/knowledge'
import { fetchProductSeries, fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { fetchThermalSetRows, fetchThermalSets } from '@/api/modules/thermal'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import { businessUserError } from '@/utils/business-error'
import { knowledgePageLabel } from '@/utils/knowledge-user'
import { mdReviewStatusMetaFor } from '@/utils/professional-status'

interface StructuredRowView {
  id: string
  systemName: string
  schemeCode: string
  substrateMaterial: string
  productName: string
  specLabel: string
  thicknessMm: number
  productThermalResistance: number
  totalThermalResistance: number
  kValue: number
  sourcePageLabel: string
  sourcePageId: string | null
  physicalPageNumber: number | null
  statusLabel: string
  setName: string
}

const props = defineProps<{
  documentId: string
  versionId: string | null
}>()

const emit = defineEmits<{
  openSourcePage: [payload: { physicalPageNumber: number | null, pageId: string | null }]
}>()

const rows = ref<StructuredRowView[]>([])
const loading = ref(false)
const error = ref<unknown>(null)

async function loadDictionary<T>(loader: () => Promise<{ items: T[] }>): Promise<T[]> {
  try {
    return (await loader()).items
  }
  catch {
    return []
  }
}

async function loadAllPages(versionId: string): Promise<KnowledgePage[]> {
  const first = await fetchVersionPages(versionId, 1, 100)
  const items = [...first.items]
  for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
    items.push(...(await fetchVersionPages(versionId, page, 100)).items)
  }
  return items
}

async function loadAllThermalRows(setId: string): Promise<ThermalRow[]> {
  try {
    const first = await fetchThermalSetRows(setId, { page: 1, pageSize: 100 })
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchThermalSetRows(setId, { page, pageSize: 100 })).items)
    }
    return items
  }
  catch {
    return []
  }
}

function openSource(row: StructuredRowView): void {
  if (!row.sourcePageId && row.physicalPageNumber == null) {
    return
  }
  emit('openSourcePage', {
    physicalPageNumber: row.physicalPageNumber,
    pageId: row.sourcePageId,
  })
}

async function load(): Promise<void> {
  if (!props.documentId) {
    rows.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const [sets, schemes, systems, specs, series, pages] = await Promise.all([
      loadDictionary<ThermalSet>(() => fetchThermalSets({ page: 1, pageSize: 100 })),
      loadDictionary<ConstructionScheme>(() => fetchConstructionSchemes({ page: 1, pageSize: 100 })),
      loadDictionary<InsulationSystem>(() => fetchInsulationSystems({ page: 1, pageSize: 100 })),
      loadDictionary<ProductSpec>(() => fetchPublishedProductSpecs({ page: 1, pageSize: 100 })),
      loadDictionary<ProductSeries>(() => fetchProductSeries({ page: 1, pageSize: 100 })),
      props.versionId ? loadAllPages(props.versionId).catch(() => [] as KnowledgePage[]) : Promise.resolve([] as KnowledgePage[]),
    ])
    const pageById = new Map(pages.map(page => [page.id, page]))
    const relatedSets = sets.filter(set => set.atlasDocumentId === props.documentId)
    const setPool = relatedSets.length > 0 ? relatedSets : sets
    const collected: ThermalRow[] = []
    for (const set of setPool) {
      const setRows = await loadAllThermalRows(set.id)
      for (const row of setRows) {
        if (row.sourceDocumentId === props.documentId || set.atlasDocumentId === props.documentId) {
          collected.push(row)
        }
      }
    }
    const setMap = new Map(setPool.map(set => [set.id, set]))
    rows.value = collected.filter(row => row.sourcePageId != null && pageById.get(row.sourcePageId)?.recognitionStatus === 'CONFIRMED').map((row) => {
      const scheme = schemes.find(item => item.id === row.schemeId)
      const system = scheme ? systems.find(item => item.id === scheme.systemId) : undefined
      const spec = specs.find(item => item.id === row.productSpecId)
      const productSeries = spec ? series.find(item => item.id === spec.seriesId) : undefined
      const page = row.sourcePageId ? pageById.get(row.sourcePageId) : undefined
      const set = setMap.get(row.setId)
      return {
        id: row.id,
        systemName: system?.name ?? '—',
        schemeCode: scheme?.schemeCode ?? '—',
        substrateMaterial: scheme?.substrateMaterial ?? '—',
        productName: productSeries?.name ?? '—',
        specLabel: spec ? `${spec.specCode} · ${spec.specClass}型` : '—',
        thicknessMm: row.thicknessMm,
        productThermalResistance: row.productThermalResistance,
        totalThermalResistance: row.totalThermalResistance,
        kValue: row.kValue,
        sourcePageLabel: knowledgePageLabel(row.sourcePageLabel, page?.physicalPageNumber ?? null),
        sourcePageId: row.sourcePageId,
        physicalPageNumber: page?.physicalPageNumber ?? null,
        statusLabel: set ? mdReviewStatusMetaFor(set.status).label : '—',
        setName: set?.name ?? '—',
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

watch(() => [props.documentId, props.versionId], () => void load())
onMounted(() => void load())

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'systemName', title: '体系', minWidth: 150 },
  { colKey: 'schemeCode', title: '构造编号', width: 100 },
  { colKey: 'substrateMaterial', title: '基层', minWidth: 110 },
  { colKey: 'productName', title: '产品', minWidth: 110 },
  { colKey: 'specLabel', title: '型号', minWidth: 120 },
  { colKey: 'thicknessMm', title: '厚度', width: 80, cell: (_, { row }) => `${(row as StructuredRowView).thicknessMm} mm` },
  { colKey: 'productThermalResistance', title: '产品层 R', width: 100 },
  { colKey: 'totalThermalResistance', title: '总 R', width: 90 },
  { colKey: 'kValue', title: 'K', width: 80 },
  {
    colKey: 'sourcePageLabel',
    title: '来源页',
    width: 120,
    cell: (_, { row }) => {
      const item = row as StructuredRowView
      if (!item.sourcePageId && item.physicalPageNumber == null) {
        return '未关联原始页面'
      }
      return h('button', {
        type: 'button',
        class: 'knowledge-structured__page-link',
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          openSource(item)
        },
      }, item.sourcePageLabel)
    },
  },
  { colKey: 'statusLabel', title: '状态', width: 100 },
])
</script>

<template>
  <section class="knowledge-structured">
    <header class="knowledge-structured__header">
      <div>
        <h2>已确认热工数据</h2>
        <p>仅展示当前版本已确认页面关联的热工参考数据；参考集的审核和发布状态见下表。点击来源页可查看原图。</p>
      </div>
    </header>
    <AppDataTable
      :columns="columns"
      :current="1"
      :data="rows"
      empty-title="还没有已确认热工数据"
      empty-description="请先核对识别结果，并将热工数据同步到参考集。"
      :error-description="businessUserError(error)"
      row-key="id"
      :total="rows.length"
      :page-size="200"
      :show-pagination="false"
      :status="loading ? 'loading' : error ? 'error' : 'ready'"
      @refresh="load"
      @retry="load"
    />
  </section>
</template>

<style scoped>
.knowledge-structured {
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-structured__header {
  margin-bottom: 16px;
}

.knowledge-structured__header h2 {
  margin: 0 0 6px;
  color: var(--td-text-color-primary);
  font-size: 18px;
}

.knowledge-structured__header p {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

:deep(.knowledge-structured__page-link) {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--td-brand-color);
  cursor: pointer;
  font: inherit;
}

:deep(.knowledge-structured__page-link:hover) {
  text-decoration: underline;
}
</style>
