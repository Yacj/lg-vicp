<script setup lang="ts">
import type { AttentionPriority, DashboardAttentionItem } from '@/types/dashboard'
import { ChevronRightIcon } from 'tdesign-icons-vue-next'
import { AppEmptyState } from '@/components/ui'

defineProps<{
  items: readonly DashboardAttentionItem[]
  loading: boolean
}>()

const emit = defineEmits<{
  open: [item: DashboardAttentionItem]
}>()

const PRIORITY_LABELS: Record<AttentionPriority, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
}
</script>

<template>
  <div class="dashboard-attention">
    <div v-if="loading" class="dashboard-attention__loading">
      <t-skeleton animation="gradient" :row-col="[{ width: '100%' }, { width: '100%' }, { width: '100%' }]" />
    </div>

    <ul v-else-if="items.length > 0" class="dashboard-attention__list">
      <li v-for="item in items" :key="item.id" class="dashboard-attention__item">
        <t-button
          block
          class="dashboard-attention__button"
          theme="default"
          variant="outline"
          @click="emit('open', item)"
        >
          <span class="dashboard-attention__inner">
            <span
              class="dashboard-attention__priority"
              :class="`is-${item.priority}`"
              :aria-label="PRIORITY_LABELS[item.priority]"
            />
            <span class="dashboard-attention__body">
              <span class="dashboard-attention__head">
                <strong>{{ item.title }}</strong>
                <t-tag v-if="item.count" size="small" theme="warning" variant="light">
                  {{ item.count }} 项
                </t-tag>
              </span>
              <span v-if="item.description" class="dashboard-attention__description">
                {{ item.description }}
              </span>
            </span>
            <ChevronRightIcon class="dashboard-attention__chevron" />
          </span>
        </t-button>
      </li>
    </ul>

    <AppEmptyState
      v-else
      description="需要处理的知识资料、审核与解析异常会显示在这里"
      size="small"
      title="暂无待处理事项"
    />
  </div>
</template>

<style scoped>
.dashboard-attention {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dashboard-attention__loading {
  padding: var(--td-size-2) 0;
}

.dashboard-attention__list {
  display: flex;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--td-size-2);
  list-style: none;
}

.dashboard-attention__item {
  display: flex;
  min-width: 0;
}

.dashboard-attention__button {
  height: auto;
  justify-content: flex-start;
  padding: var(--td-size-3);
  border-radius: var(--td-radius-default);
  text-align: left;
  white-space: normal;
}

/* t-button 默认将内容包裹层居中，这里拉满宽度保证左对齐 */
.dashboard-attention__button :deep(.t-button__text) {
  display: flex;
  width: 100%;
  min-width: 0;
}

.dashboard-attention__inner {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.dashboard-attention__priority {
  width: 3px;
  align-self: stretch;
  flex: 0 0 auto;
  border-radius: var(--td-radius-small);
  background: var(--td-text-color-placeholder);
}

.dashboard-attention__priority.is-high {
  background: var(--td-warning-color);
}

.dashboard-attention__priority.is-medium {
  background: var(--td-brand-color);
}

.dashboard-attention__body {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--td-size-1);
}

.dashboard-attention__head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.dashboard-attention__head strong {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-attention__description {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-attention__chevron {
  flex: 0 0 auto;
  color: var(--td-text-color-placeholder);
}
</style>
