<script lang="ts">
export type ConstructionWorkspaceTabKey = 'systems' | 'schemes'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import ConstructionSchemePanel from '@/components/business/construction/ConstructionSchemePanel.vue'
import InsulationSystemPanel from '@/components/business/construction/InsulationSystemPanel.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 构造体系工作区：聚合 [保温系统] [构造方案] 两个 Tab。
 * 菜单叶子 /construction/systems、/construction/schemes 都渲染本工作区并定位到对应 Tab。
 */
const props = defineProps<{
  initialTab?: ConstructionWorkspaceTabKey
}>()

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:construction:list'] }))

const tabs = computed(() => canList.value
  ? [
      { key: 'systems' as const, label: '保温系统' },
      { key: 'schemes' as const, label: '构造方案' },
    ]
  : [])

const activeTab = ref<ConstructionWorkspaceTabKey>(props.initialTab ?? 'systems')

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })
</script>

<template>
  <AppPage
    title="构造体系"
    description="保温系统是构造方案的顶层归属；构造方案（基层 + 构造层 + 产品选项）发布后参与候选匹配，提交与发布前强制结构校验。"
  >
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #systems>
        <InsulationSystemPanel />
      </template>
      <template #schemes>
        <ConstructionSchemePanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>
