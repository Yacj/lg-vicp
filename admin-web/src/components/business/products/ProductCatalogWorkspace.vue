<script lang="ts">
export type ProductCatalogTabKey = 'series' | 'specs' | 'parameters' | 'attachments'
</script>

<script setup lang="ts">
import type { ProductSeries } from '@/types/masterdata'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import ProductAttachmentPanel from '@/components/business/products/ProductAttachmentPanel.vue'
import ProductParameterPanel from '@/components/business/products/ProductParameterPanel.vue'
import ProductSeriesPanel from '@/components/business/products/ProductSeriesPanel.vue'
import ProductSpecPanel from '@/components/business/products/ProductSpecPanel.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 产品管理工作区：聚合 [产品系列] [产品规格] [产品参数] [产品附件] 四个 Tab。
 * 后端菜单保留四个叶子路径（products/series|specs|parameters|attachments），
 * 四条路径都渲染本工作区并通过 initialTab 定位，菜单项与旧链接均可达。
 */
const props = defineProps<{
  initialTab?: ProductCatalogTabKey
}>()

const router = useRouter()
const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:md:product:list'] }))

const tabs = computed(() => canList.value
  ? [
      { key: 'series' as const, label: '产品系列' },
      { key: 'specs' as const, label: '产品规格' },
      { key: 'parameters' as const, label: '产品参数' },
      { key: 'attachments' as const, label: '产品附件' },
    ]
  : [])

const activeTab = ref<ProductCatalogTabKey>(props.initialTab ?? 'series')

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })

function openDetail(series: ProductSeries): void {
  void router.push({
    path: '/products/detail',
    query: { seriesId: series.id, code: series.code, name: series.name },
  })
}
</script>

<template>
  <AppPage
    title="产品管理"
    description="产品系列、规格、性能参数与技术附件的统一维护入口；系列发布后方可挂载规格，性能参数是热工计算的参数来源之一。"
  >
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #series>
        <ProductSeriesPanel @open-detail="openDetail" />
      </template>
      <template #specs>
        <ProductSpecPanel />
      </template>
      <template #parameters>
        <ProductParameterPanel />
      </template>
      <template #attachments>
        <ProductAttachmentPanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>
