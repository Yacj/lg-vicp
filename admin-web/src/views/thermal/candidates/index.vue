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
</script>

<template>
  <AppPage
    title="候选方案试算"
    description="按图集参考表查询满足条件的保温构造候选方案；后端会标记最接近目标 K 值的方案，全部候选平等展示，可核对每条方案的图集依据。"
  >
    <ThermalCandidatePanel
      :key="`${defaultRegionCode ?? ''}-${defaultSubstrateMaterial ?? ''}`"
      :default-region-code="defaultRegionCode"
      :default-substrate-material="defaultSubstrateMaterial"
    />
  </AppPage>
</template>
