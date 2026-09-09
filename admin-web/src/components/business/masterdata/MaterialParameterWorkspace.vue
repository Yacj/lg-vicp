<script lang="ts">
export type MaterialWorkspaceTabKey = 'materials' | 'versions'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import MaterialLibraryPanel from '@/components/business/masterdata/MaterialLibraryPanel.vue'
import MaterialParameterVersionPanel from '@/components/business/masterdata/MaterialParameterVersionPanel.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

const props = defineProps<{
  initialTab?: MaterialWorkspaceTabKey
}>()

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:md:material:list'] }))

const tabs = computed(() => canList.value
  ? [
      { key: 'materials' as const, label: '材料库' },
      { key: 'versions' as const, label: '参数版本' },
    ]
  : [])

const activeTab = ref<MaterialWorkspaceTabKey>(props.initialTab ?? 'materials')

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })
</script>

<template>
  <AppPage
    title="材料与参数"
    description="保温材料档案与性能参数；材料参数版本是确定性热工计算的唯一参数来源。"
  >
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #materials>
        <MaterialLibraryPanel />
      </template>
      <template #versions>
        <MaterialParameterVersionPanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>
