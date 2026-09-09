<script setup lang="ts">
/**
 * 页面级工作区 Tabs 壳层：统一“标题区 + Tabs + 内容面板”的聚合页结构。
 * 面板使用 TDesign t-tab-panel 的 lazy 渲染（首次激活才挂载，之后保留状态），
 * 保证各 Tab 的列表组合式函数只在激活时拉取数据。
 */
defineProps<{
  tabs: readonly { key: string, label: string }[]
}>()

const active = defineModel<string>({ required: true })
</script>

<template>
  <t-tabs v-model="active" class="app-workspace-tabs" theme="normal">
    <t-tab-panel
      v-for="tab in tabs"
      :key="tab.key"
      :label="tab.label"
      :value="tab.key"
      lazy
    >
      <div class="app-workspace-tabs__panel">
        <slot :name="tab.key" />
      </div>
    </t-tab-panel>
  </t-tabs>
</template>

<style scoped>
.app-workspace-tabs {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.app-workspace-tabs :deep(.t-tabs__content) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.app-workspace-tabs__panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
  padding-top: var(--vicp-page-gap);
}
</style>
