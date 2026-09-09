<script lang="ts">
export type ThermalWorkspaceTabKey = 'sets' | 'calc-rules'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import ThermalCalcRulePanel from '@/components/business/thermal/ThermalCalcRulePanel.vue'
import ThermalSetPanel from '@/components/business/thermal/ThermalSetPanel.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 热工数据工作区：聚合 [图集热工表] [计算规则] 两个 Tab。
 * 菜单叶子 /thermal/sets、/thermal/calc-rules 都渲染本工作区并定位到对应 Tab。
 */
const props = defineProps<{
  initialTab?: ThermalWorkspaceTabKey
}>()

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:thermal:list'] }))

const tabs = computed(() => canList.value
  ? [
      { key: 'sets' as const, label: '图集热工表' },
      { key: 'calc-rules' as const, label: '计算规则' },
    ]
  : [])

const activeTab = ref<ThermalWorkspaceTabKey>(props.initialTab ?? 'sets')

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })
</script>

<template>
  <AppPage
    title="热工数据"
    description="图集节能计算参考选用表是确定性热工计算的优先数据源；图集无结果且计算规则已发布时才允许按公式计算，历史结果保持不变。"
  >
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #sets>
        <ThermalSetPanel />
      </template>
      <template #calc-rules>
        <ThermalCalcRulePanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>
