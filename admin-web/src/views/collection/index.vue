<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CollectionAutoPanel from '@/components/business/collection/CollectionAutoPanel.vue'
import CollectionDashboardPanel from '@/components/business/collection/CollectionDashboardPanel.vue'
import CollectionManualPanel from '@/components/business/collection/CollectionManualPanel.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { COLLECTION_PERMISSIONS } from '@/types/collection'

defineOptions({ name: 'CollectionCenter' })

type CollectionTabKey = 'manual' | 'auto' | 'dashboard'

const route = useRoute()
const router = useRouter()
const { canAccess } = usePermissionAccess()

const canManual = computed(() => canAccess({
  permissions: [
    COLLECTION_PERMISSIONS.LIST,
    COLLECTION_PERMISSIONS.TASK_VIEW,
    COLLECTION_PERMISSIONS.MANUAL_CREATE,
  ],
}))
const canAuto = computed(() => canAccess({
  permissions: [
    COLLECTION_PERMISSIONS.AUTO_LIST,
    COLLECTION_PERMISSIONS.AUTO_CREATE,
    COLLECTION_PERMISSIONS.AUTO_UPDATE,
    COLLECTION_PERMISSIONS.AUTO_TOGGLE,
  ],
}))
const canDashboard = computed(() => canAccess({
  permissions: [
    COLLECTION_PERMISSIONS.DASHBOARD,
    COLLECTION_PERMISSIONS.RECORD_LIST,
  ],
}))

const tabs = computed(() => [
  ...(canManual.value ? [{ key: 'manual' as const, label: '手动采集' }] : []),
  ...(canAuto.value ? [{ key: 'auto' as const, label: '自动采集' }] : []),
  ...(canDashboard.value ? [{ key: 'dashboard' as const, label: '采集看板' }] : []),
])

function tabFromQuery(value: unknown): CollectionTabKey | null {
  return value === 'manual' || value === 'auto' || value === 'dashboard' ? value : null
}

const activeTab = ref<CollectionTabKey>(
  tabFromQuery(route.query.tab) ?? (canManual.value ? 'manual' : canAuto.value ? 'auto' : 'dashboard'),
)

watch(tabs, (value) => {
  if (value.length > 0 && !value.some(tab => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })

watch(() => route.query.tab, (tab) => {
  const next = tabFromQuery(tab)
  if (next && tabs.value.some(item => item.key === next)) {
    activeTab.value = next
  }
})

function openKnowledge(documentId: string): void {
  void router.push({ name: 'KnowledgeDocumentDetail', params: { id: documentId } })
}
</script>

<template>
  <AppPage description="获取外部候选资料，确认后进入知识库解析与发布。" title="采集管理">
    <AppWorkspaceTabs v-if="tabs.length > 0" v-model="activeTab" :tabs="tabs">
      <template #manual>
        <CollectionManualPanel @open-knowledge="openKnowledge" />
      </template>
      <template #auto>
        <CollectionAutoPanel @open-knowledge="openKnowledge" />
      </template>
      <template #dashboard>
        <CollectionDashboardPanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>
