<script setup lang="ts">
import type { Component } from 'vue'
import {
  BookIcon,
  CheckCircleIcon,
  ErrorCircleIcon,
  FolderOpenIcon,
} from 'tdesign-icons-vue-next'
import { AppMetricCard } from '@/components/ui'
import type { DashboardMetricCard } from '../dashboard'

defineProps<{
  cards: readonly DashboardMetricCard[]
  loading: boolean
}>()

const METRIC_ICONS: Record<string, Component> = {
  projects: FolderOpenIcon,
  knowledge: BookIcon,
  review: CheckCircleIcon,
  parsing: ErrorCircleIcon,
}

function metricIcon(id: string): Component | undefined {
  return METRIC_ICONS[id]
}
</script>

<template>
  <section v-if="cards.length > 0" class="dashboard-metrics" aria-label="核心指标">
    <AppMetricCard
      v-for="card in cards"
      :key="card.id"
      clickable
      :icon="metricIcon(card.id)"
      :label="card.label"
      :loading="loading"
      :route="card.path"
      :secondary-text="card.secondaryText"
      :status="card.status"
      :value="card.value"
    />
  </section>
</template>

<style scoped>
.dashboard-metrics {
  display: grid;
  min-width: 0;
  align-items: stretch;
  gap: var(--vicp-page-gap);
  /* 卡片数量随权限变化（2~4 张），auto-fit 让现有卡片均分整行，不留空轨 */
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  /* 同行卡片强制等高，避免有无 secondary 文本导致高度参差 */
  grid-auto-rows: 1fr;
}

/* 工作台指标卡比通用场景更紧凑，避免小数字撑大卡片 */
.dashboard-metrics :deep(.app-metric-card) {
  min-height: calc(var(--vicp-metric-min-height) - var(--td-size-10));
}

@media (max-width: 1100px) {
  .dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .dashboard-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
