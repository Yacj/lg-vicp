<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ThermalCandidatePanel from '@/components/business/thermal/ThermalCandidatePanel.vue'
import AppPage from '@/components/ui/AppPage.vue'

defineOptions({ name: 'ThermalCandidates' })

/**
 * 支持项目详情「项目条件」任务入口预填：
 * /thermal/candidates?regionCode=…&substrateMaterial=…
 */
const route = useRoute()

function queryText(name: string): string | undefined {
  const value = route.query[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

const defaultRegionCode = computed(() => queryText('regionCode'))
const defaultSubstrateMaterial = computed(() => queryText('substrateMaterial'))
const defaultSchemeId = computed(() => queryText('schemeId'))
const defaultProductSpecId = computed(() => queryText('productSpecId'))
const defaultThicknessMm = computed(() => {
  const value = Number(queryText('thicknessMm'))
  return Number.isFinite(value) && value > 0 && value <= 1000 ? value : undefined
})
</script>

<template>
  <AppPage
    description="查询已发布图集参考值。可组合热工指标、厚度和构造规格条件；接近候选仅供比较，不代表符合硬条件。"
    title="参考方案查询"
  >
    <ThermalCandidatePanel
      :key="`${defaultRegionCode ?? ''}-${defaultSubstrateMaterial ?? ''}-${defaultSchemeId ?? ''}-${defaultProductSpecId ?? ''}-${defaultThicknessMm ?? ''}`"
      :default-region-code="defaultRegionCode"
      :default-substrate-material="defaultSubstrateMaterial"
      :default-scheme-id="defaultSchemeId"
      :default-product-spec-id="defaultProductSpecId"
      :default-thickness-mm="defaultThicknessMm"
    />
  </AppPage>
</template>
