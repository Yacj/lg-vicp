<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppPage from '@/components/ui/AppPage.vue'
import { compareCatalogProducts, fetchCatalogProducts } from '@/api/modules/catalog-products'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import type { CatalogProduct, CatalogProductCompareResult } from '@/types/catalog-product'
import {
  buildCompareProductIds,
  PRODUCT_COMPARE_AI_DISCLAIMER,
  PRODUCT_COMPARE_THERMAL_UNAVAILABLE,
  projectProductCompareWorkbench,
} from '@/utils/product-compare'

const feedback = useAppFeedback()
const products = ref<CatalogProduct[]>([])
const loading = ref(false)
const comparing = ref(false)
const ownerProductId = ref('')
const compareProductIds = ref<string[]>([])
const explainWithAi = ref(true)
const result = ref<CatalogProductCompareResult | null>(null)
const errorMessage = ref('')

const ownerOptions = computed(() => products.value.map(item => ({ label: item.name, value: item.id })))
const compareOptions = computed(() => products.value
  .filter(item => item.id !== ownerProductId.value)
  .map(item => ({ label: item.name, value: item.id })))

const selectedProductIds = computed(() => buildCompareProductIds(ownerProductId.value, compareProductIds.value))
const projected = computed(() => result.value ? projectProductCompareWorkbench(result.value) : null)

const tableColumns = computed(() => {
  if (!projected.value) {
    return []
  }
  return [
    { colKey: 'dimension', ellipsis: true, title: '对比维度', width: 180 },
    ...projected.value.products.map((product, index) => ({
      colKey: `p${index}`,
      ellipsis: true,
      minWidth: 160,
      title: product.name,
    })),
  ]
})

const tableData = computed(() => {
  if (!projected.value) {
    return []
  }
  return projected.value.dimensions.map((dimension) => {
    const row: Record<string, string> = { dimension: dimension.label }
    dimension.cells.forEach((cell, index) => {
      row[`p${index}`] = cell.display
    })
    return row
  })
})

async function loadProducts(): Promise<void> {
  loading.value = true
  try {
    const page = await fetchCatalogProducts({ page: 1, pageSize: 100, status: 'ACTIVE' })
    products.value = page.items
  }
  catch (cause) {
    errorMessage.value = normalizeFeedbackError(cause).message
  }
  finally {
    loading.value = false
  }
}

function onOwnerChange(): void {
  compareProductIds.value = compareProductIds.value.filter(id => id !== ownerProductId.value)
  result.value = null
}

watch(ownerProductId, onOwnerChange)

async function runCompare(): Promise<void> {
  if (selectedProductIds.value.length < 2 || comparing.value) {
    await feedback.message('warning', '请选择甲方产品和至少一个对比产品')
    return
  }
  comparing.value = true
  try {
    result.value = await compareCatalogProducts({
      explainWithAi: explainWithAi.value,
      productIds: selectedProductIds.value,
    })
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
  finally {
    comparing.value = false
  }
}

onMounted(() => {
  void loadProducts()
})
</script>

<template>
  <AppPage
    description="管理员查看、验证系统当前可以形成的结构化对比信息，以及 C 端最终会得到什么结果。本页不是用户选型页，也不提供固定评分或权重。"
    title="产品对比"
  >
    <t-card title="选择产品">
      <t-form label-width="100px">
        <t-form-item label="甲方产品">
          <t-select
            v-model="ownerProductId"
            :loading="loading"
            :options="ownerOptions"
            placeholder="请选择甲方产品"
          />
        </t-form-item>
        <t-form-item label="对比产品">
          <t-select
            v-model="compareProductIds"
            :disabled="!ownerProductId"
            :loading="loading"
            :max="9"
            :min-collapsed-num="3"
            multiple
            :options="compareOptions"
            placeholder="请选择一个或多个对比产品"
          />
        </t-form-item>
        <t-form-item label="AI 对比说明">
          <t-switch v-model="explainWithAi" />
        </t-form-item>
        <t-form-item>
          <t-button :disabled="selectedProductIds.length < 2" :loading="comparing" theme="primary" @click="runCompare">
            开始对比
          </t-button>
        </t-form-item>
      </t-form>
      <p v-if="errorMessage" class="compare-error">{{ errorMessage }}</p>
    </t-card>

    <t-card v-if="projected" class="mt-4" title="对比结果">
      <t-table
        :columns="tableColumns"
        :data="tableData"
        row-key="dimension"
        size="small"
      />

      <section v-if="projected.missingNotes.length > 0" class="compare-notes">
        <h3>资料说明</h3>
        <ul>
          <li v-for="note in projected.missingNotes" :key="note">{{ note }}</li>
        </ul>
      </section>

      <section class="compare-ai">
        <h3>AI 对比说明</h3>
        <t-alert :message="PRODUCT_COMPARE_AI_DISCLAIMER" theme="info" />
        <p v-if="projected.aiExplanation">{{ projected.aiExplanation }}</p>
        <p v-else class="compare-muted">当前未生成 AI 对比说明。</p>
      </section>

      <section class="compare-sources">
        <h3>来源依据</h3>
        <ul v-if="projected.sources.length > 0">
          <li v-for="source in projected.sources" :key="`${source.type}:${source.id}`">
            {{ source.label }}
            <span class="compare-muted">（{{ source.type }}）</span>
          </li>
        </ul>
        <p v-else class="compare-muted">暂无额外来源依据。</p>
      </section>

      <section class="compare-thermal">
        <h3>热工数据</h3>
        <template v-if="projected.showThermalResults">
          <pre class="compare-json">{{ JSON.stringify(projected.thermalResults, null, 2) }}</pre>
        </template>
        <p v-else class="compare-muted">{{ PRODUCT_COMPARE_THERMAL_UNAVAILABLE }}</p>
      </section>
    </t-card>
  </AppPage>
</template>

<style scoped>
.compare-error,
.compare-ai p,
.compare-sources p,
.compare-thermal p,
.compare-notes li,
.compare-sources li {
  margin: var(--td-size-3) 0 0;
  color: var(--td-text-color-secondary);
}

.compare-ai h3,
.compare-sources h3,
.compare-thermal h3,
.compare-notes h3 {
  margin: var(--td-size-5) 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.compare-notes ul,
.compare-sources ul {
  margin: 0;
  padding-left: var(--td-size-5);
}

.compare-muted {
  color: var(--td-text-color-placeholder);
}

.compare-json {
  overflow: auto;
  margin: var(--td-size-3) 0 0;
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
}
</style>
