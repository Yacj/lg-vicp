<script lang="ts">
export type ProductDetailTabKey = 'overview' | 'specs' | 'construction' | 'thermal' | 'nodes' | 'comparison' | 'attachments'
</script>

<script setup lang="ts">
import type { ThermalSet } from '@/types/thermal'
import type { ProductSpec } from '@/types/masterdata'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import ProductRelationPanel, { type ProductRelationLink } from '@/components/business/products/ProductRelationPanel.vue'
import ProductSpecPanel from '@/components/business/products/ProductSpecPanel.vue'
import ProductAttachmentPanel from '@/components/business/products/ProductAttachmentPanel.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { fetchPublishedProductSpecs, fetchProductSeries } from '@/api/modules/masterdata'
import { fetchPublishedThermalSets } from '@/api/modules/thermal'
import { formatDate } from '@/utils/day'
import { mdReviewStatusMetaFor } from '@/utils/professional-status'

/**
 * 产品详情工作台：[基本信息] [规格参数] [构造体系] [热工数据] [节点图] [对比数据] [技术资料]。
 *
 * 后端暂无产品详情聚合 API，全部数据采用既有查询契约投影：
 * - 基本信息：seriesId + code/name 查询参数（列表页跳转携带），并用 keyword 精确回查系列档案；
 * - 规格参数 / 技术资料：seriesId / targetId 过滤的面板；
 * - 热工数据：已发布规格 → fetchPublishedThermalSets(productSpecId)；
 * - 构造 / 节点 / 对比：后端无产品直接关联查询，以受权限控制的入口承载（不做假数据）。
 */
const props = defineProps<{
  seriesId?: string
  specId?: string
  systemId?: string
}>()

const route = useRoute()
const router = useRouter()
const { canAccess } = usePermissionAccess()

const canProduct = computed(() => canAccess({ permissions: ['system:md:product:list'] }))
const canConstruction = computed(() => canAccess({ permissions: ['system:construction:list'] }))
const canThermal = computed(() => canAccess({ permissions: ['system:thermal:list'] }))
const canNodes = computed(() => canAccess({ permissions: ['system:node:list'] }))
const canComparison = computed(() => canAccess({ permissions: ['system:comparison:list'] }))

const activeTab = ref<ProductDetailTabKey>(normalizeTab(route.query.tab))

function normalizeTab(value: unknown): ProductDetailTabKey {
  const allowed: ProductDetailTabKey[] = ['overview', 'specs', 'construction', 'thermal', 'nodes', 'comparison', 'attachments']
  return allowed.includes(value as ProductDetailTabKey) ? value as ProductDetailTabKey : 'overview'
}

watch(() => route.query.tab, (value) => {
  activeTab.value = normalizeTab(value)
})

watch(activeTab, (value) => {
  const current = { ...route.query, tab: value }
  if (route.query.tab !== value) {
    void router.replace({ path: route.path, query: current })
  }
})

// ---- 基本信息投影：keyword=code 精确回查系列档案（不编造详情接口） ----

const seriesCode = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))
const seriesName = computed(() => (typeof route.query.name === 'string' ? route.query.name : ''))

const series = ref<{
  code: string
  description: string | null
  name: string
  status: string
  updatedAt: string
  version: number
} | null>(null)
const seriesLoading = ref(false)

async function loadSeries(): Promise<void> {
  if (!props.seriesId || !seriesCode.value) {
    series.value = null
    return
  }
  seriesLoading.value = true
  try {
    const result = await fetchProductSeries({ page: 1, pageSize: 50, keyword: seriesCode.value })
    series.value = result.items.find(item => item.id === props.seriesId) ?? null
  }
  catch {
    series.value = null
  }
  finally {
    seriesLoading.value = false
  }
}

watch(() => props.seriesId, () => void loadSeries(), { immediate: true })

// ---- 热工数据投影：已发布规格 → 图集热工表 ----

const publishedSpecs = ref<ProductSpec[]>([])
const publishedSpecsLoading = ref(false)
const selectedSpecId = ref('')

async function loadPublishedSpecs(): Promise<void> {
  if (!props.seriesId) {
    publishedSpecs.value = []
    return
  }
  publishedSpecsLoading.value = true
  try {
    const result = await fetchPublishedProductSpecs({ seriesId: props.seriesId })
    publishedSpecs.value = result.items
    if (!selectedSpecId.value && result.items.length > 0) {
      selectedSpecId.value = result.items[0]!.id
    }
  }
  catch {
    publishedSpecs.value = []
  }
  finally {
    publishedSpecsLoading.value = false
  }
}

const specOptions = computed(() => publishedSpecs.value.map((item) => ({
  label: `${item.specCode}（${item.thicknessMm}mm）`,
  value: item.id,
})))

const thermalSets = ref<ThermalSet[]>([])
const thermalSetsLoading = ref(false)
const thermalSetsError = ref(false)

async function loadThermalSets(): Promise<void> {
  if (!selectedSpecId.value) {
    thermalSets.value = []
    return
  }
  thermalSetsLoading.value = true
  thermalSetsError.value = false
  try {
    const result = await fetchPublishedThermalSets({ productSpecId: selectedSpecId.value })
    thermalSets.value = result.items
  }
  catch {
    thermalSetsError.value = true
    thermalSets.value = []
  }
  finally {
    thermalSetsLoading.value = false
  }
}

watch([selectedSpecId, activeTab], ([specId, tab]) => {
  if (tab === 'thermal' && specId) {
    void loadThermalSets()
  }
}, { immediate: true })

watch([activeTab, () => props.seriesId], ([tab, seriesId]) => {
  if (tab === 'thermal' && seriesId && publishedSpecs.value.length === 0 && !publishedSpecsLoading.value) {
    void loadPublishedSpecs()
  }
}, { immediate: true })

// ---- 构造 / 节点 / 对比：受权限控制的任务入口 ----

const constructionLinks = computed<ProductRelationLink[]>(() => [
  {
    description: '保温系统档案与审核发布',
    label: '保温系统',
    path: '/construction/systems',
    permission: 'system:construction:list',
  },
  {
    description: '构造方案（基层 + 构造层 + 产品选项）与结构校验',
    label: '构造方案',
    path: '/construction/schemes',
    permission: 'system:construction:list',
  },
])

const nodeLinks = computed<ProductRelationLink[]>(() => [
  {
    description: props.systemId
      ? '按保温系统筛选节点大样图'
      : '节点大样图库（可按保温系统筛选）',
    label: '节点大样图',
    path: props.systemId ? `/nodes/drawings?systemId=${encodeURIComponent(props.systemId)}` : '/nodes/drawings',
    permission: 'system:node:list',
  },
])

const comparisonLinks = computed<ProductRelationLink[]>(() => [
  {
    description: '竞品对比规则与维度配置',
    label: '对比规则',
    path: '/comparison/versions',
    permission: 'system:comparison:list',
  },
])

const statusMeta = computed(() => (series.value ? mdReviewStatusMetaFor(series.value.status) : null))

const tabs = computed(() => {
  const items: { key: ProductDetailTabKey, label: string }[] = [{ key: 'overview', label: '基本信息' }]
  if (canProduct.value) {
    items.push(
      { key: 'specs', label: '规格参数' },
      { key: 'attachments', label: '技术资料' },
    )
  }
  if (canConstruction.value) {
    items.push({ key: 'construction', label: '构造体系' })
  }
  if (canThermal.value) {
    items.push({ key: 'thermal', label: '热工数据' })
  }
  if (canNodes.value) {
    items.push({ key: 'nodes', label: '节点图' })
  }
  if (canComparison.value) {
    items.push({ key: 'comparison', label: '对比数据' })
  }
  return items
})

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })
</script>

<template>
  <AppPage
    :title="series?.name || seriesName || '产品详情'"
    :description="series?.description || '产品档案任务视图：规格、热工、构造与资料从对应工作区按 ID 投影。'"
  >
    <template #navigation>
      <t-button variant="text" @click="router.back()">
        返回
      </t-button>
    </template>

    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #overview>
        <section class="vicp-pd-overview">
          <t-loading :loading="seriesLoading">
            <t-descriptions v-if="series" bordered :column="2" size="medium">
              <t-descriptions-item label="系列名称">{{ series.name }}</t-descriptions-item>
              <t-descriptions-item label="系列编码">{{ series.code }}</t-descriptions-item>
              <t-descriptions-item label="版本">v{{ series.version }}</t-descriptions-item>
              <t-descriptions-item label="状态">
                <AppStatusTag v-if="statusMeta" :label="statusMeta.label" :status="statusMeta.status" />
              </t-descriptions-item>
              <t-descriptions-item label="更新时间">{{ formatDate(new Date(series.updatedAt)) }}</t-descriptions-item>
              <t-descriptions-item label="系列 ID">
                <code class="vicp-pd-mono">{{ props.seriesId }}</code>
              </t-descriptions-item>
              <t-descriptions-item label="描述" :span="2">{{ series.description || '暂无描述' }}</t-descriptions-item>
            </t-descriptions>
            <t-alert v-else-if="!seriesLoading" message="未查询到系列档案快照；可通过产品系列列表重新进入详情。" theme="info" />
          </t-loading>
        </section>
      </template>

      <template #specs>
        <ProductSpecPanel v-if="props.seriesId" :locked-series-id="props.seriesId" />
        <t-alert v-else message="缺少 seriesId 查询参数，请从产品系列列表进入。" theme="warning" />
      </template>

      <template #attachments>
        <ProductAttachmentPanel
          v-if="props.seriesId"
          :locked-target="{ targetType: 'PRODUCT_SERIES', targetId: props.seriesId }"
        />
        <t-alert v-else message="缺少 seriesId 查询参数，请从产品系列列表进入。" theme="warning" />
      </template>

      <template #construction>
        <ProductRelationPanel
          description="产品与构造体系的直接关联查询尚未提供；构造方案通过保温系统与图集热工数据关联，可从以下入口继续任务。"
          :links="constructionLinks"
        />
      </template>

      <template #thermal>
        <section class="vicp-pd-thermal">
          <div class="vicp-pd-thermal__selector">
            <span class="vicp-pd-thermal__label">选择已发布规格</span>
            <t-select
              v-model="selectedSpecId"
              :loading="publishedSpecsLoading"
              :options="specOptions"
              clearable
              placeholder="先发布产品规格后可查看关联热工数据"
            />
          </div>
          <t-table
            :columns="[
              { colKey: 'name', title: '参考表名称', minWidth: 220 },
              { colKey: 'code', title: '编码', minWidth: 140 },
              { colKey: 'status', title: '状态', width: 100 },
              { colKey: 'updatedAt', title: '更新时间', width: 170 },
            ]"
            :data="thermalSets"
            cell-empty-content="—"
            :loading="thermalSetsLoading"
            :empty="thermalSetsError ? '加载失败，可稍后重试' : '该规格暂无已发布的热工参考表'"
            max-height="420"
            row-key="id"
            size="small"
          >
            <template #status="{ row }">
              <AppStatusTag :label="mdReviewStatusMetaFor(row.status).label" :status="mdReviewStatusMetaFor(row.status).status" />
            </template>
            <template #updatedAt="{ row }">
              {{ formatDate(new Date(row.updatedAt)) }}
            </template>
          </t-table>
        </section>
      </template>

      <template #nodes>
        <ProductRelationPanel
          :description="props.systemId
            ? '节点大样图支持按保温系统筛选，当前携带系统上下文进入。'
            : '节点大样图按保温系统组织；产品系列与节点的直接关联查询尚未提供。'"
          :links="nodeLinks"
        />
      </template>

      <template #comparison>
        <ProductRelationPanel
          description="产品与竞品对比数据的直接关联查询尚未提供；对比维度与规则在对比配置中维护。"
          :links="comparisonLinks"
        />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>

<style scoped>
.vicp-pd-overview {
  max-width: 860px;
}
.vicp-pd-mono {
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}
.vicp-pd-thermal {
  display: flex;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}
.vicp-pd-thermal__selector {
  display: flex;
  max-width: 420px;
  align-items: center;
  gap: var(--td-size-3);
}
.vicp-pd-thermal__label {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
