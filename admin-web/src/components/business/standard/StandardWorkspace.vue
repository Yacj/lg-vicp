<script lang="ts">
export type StandardWorkspaceTabKey = 'documents' | 'indicators' | 'replacements' | 'sources'
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import StandardDocumentPanel from '@/components/business/standard/StandardDocumentPanel.vue'
import StandardIndicatorPanel from '@/components/business/standard/StandardIndicatorPanel.vue'
import StandardReplacementPanel from '@/components/business/standard/StandardReplacementPanel.vue'
import StandardSourcePanel from '@/components/business/standard/StandardSourcePanel.vue'
import ThermalStandardLimitPanel from '@/components/business/thermal/ThermalStandardLimitPanel.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 标准规范工作区：聚合 [标准文件] [结构化指标] [替代关系] [数据来源] 四个 Tab。
 * 结构化指标 = 标准文档下的节能指标 + 热工标准限值（标准限值作为结构化指标的关联内容）。
 * 菜单叶子 /standard/documents、/standard/indicators、/standard/replacements、
 * /standard/sources、/thermal/standard-limits 都渲染本工作区并定位到对应 Tab。
 */
const props = defineProps<{
  initialTab?: StandardWorkspaceTabKey
}>()

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:standard:list'] }))
const canListThermal = computed(() => canAccess({ permissions: ['system:thermal:list'] }))

const tabs = computed(() => {
  const items: { key: StandardWorkspaceTabKey, label: string }[] = []
  if (canList.value) {
    items.push(
      { key: 'documents', label: '标准文件' },
      { key: 'indicators', label: '结构化指标' },
      { key: 'replacements', label: '替代关系' },
      { key: 'sources', label: '数据来源' },
    )
  }
  else if (canListThermal.value) {
    items.push({ key: 'indicators', label: '结构化指标' })
  }
  return items
})

const activeTab = ref<StandardWorkspaceTabKey>(props.initialTab ?? 'documents')

watch(tabs, (value) => {
  if (value.length > 0 && !value.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = value[0]!.key
  }
}, { immediate: true })

const showLimits = computed(() => canListThermal.value && activeTab.value === 'indicators')
</script>

<template>
  <AppPage
    title="标准规范"
    description="地方节能标准文档、结构化指标与替代关系；未经审核的内容不参与正式合规判断，发布后指标同步写入热工限值。"
  >
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #documents>
        <StandardDocumentPanel />
      </template>
      <template #indicators>
        <StandardIndicatorPanel />
        <section v-if="showLimits" class="vicp-standard-limits" aria-label="热工标准限值">
          <header class="vicp-standard-limits__head">
            <strong>热工标准限值</strong>
            <span>标准指标发布后同步写入热工限值，作为确定性计算与合规判定的依据</span>
          </header>
          <ThermalStandardLimitPanel />
        </section>
      </template>
      <template #replacements>
        <StandardReplacementPanel />
      </template>
      <template #sources>
        <StandardSourcePanel />
      </template>
    </AppWorkspaceTabs>
  </AppPage>
</template>

<style scoped>
.vicp-standard-limits {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-standard-limits__head {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--td-size-3);
}
.vicp-standard-limits__head strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}
.vicp-standard-limits__head span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
