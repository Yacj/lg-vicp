<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ThermalCalcRecordPanel from '@/components/business/thermal/ThermalCalcRecordPanel.vue'
import AppPage from '@/components/ui/AppPage.vue'

defineOptions({ name: 'ThermalCalcRecords' })

/** 支持项目详情「方案选择」任务入口：/thermal/calc-records?projectId=… 锁定项目过滤。 */
const route = useRoute()

const lockedProjectId = computed(() => {
  const value = route.query.projectId
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
})
</script>

<template>
  <AppPage
    title="计算记录"
    description="热工计算历史（只读）；历史结果不随后台参数变化，可完整查看当时的输入与规则。"
  >
    <ThermalCalcRecordPanel :locked-project-id="lockedProjectId" />
  </AppPage>
</template>
