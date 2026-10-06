<script setup lang="ts">
import type { Component } from 'vue'
import {
  AddIcon,
  BookIcon,
  ChatIcon,
  CheckCircleIcon,
  FileIcon,
  UserIcon,
} from 'tdesign-icons-vue-next'
import { AppEmptyState } from '@/components/ui'
import type { DashboardQuickAction, DashboardQuickIcon } from '../dashboard'

defineProps<{
  actions: readonly DashboardQuickAction[]
}>()

const emit = defineEmits<{
  open: [action: DashboardQuickAction]
}>()

const QUICK_ICONS: Record<DashboardQuickIcon, Component> = {
  add: AddIcon,
  book: BookIcon,
  chat: ChatIcon,
  check: CheckCircleIcon,
  file: FileIcon,
  user: UserIcon,
}
</script>

<template>
  <div class="dashboard-shortcuts">
    <div v-if="actions.length > 0" class="dashboard-shortcuts__grid">
      <t-button
        v-for="action in actions"
        :key="action.id"
        block
        class="dashboard-shortcuts__item"
        theme="default"
        variant="outline"
        @click="emit('open', action)"
      >
        <span class="dashboard-shortcuts__inner">
          <span class="dashboard-shortcuts__icon">
            <component :is="QUICK_ICONS[action.icon]" />
          </span>
          <strong class="dashboard-shortcuts__title">{{ action.title }}</strong>
        </span>
      </t-button>
    </div>
    <AppEmptyState
      v-else
      description="快捷入口按账号权限显示，授权后自动出现"
      size="small"
      title="暂无可用入口"
    />
  </div>
</template>

<style scoped>
.dashboard-shortcuts {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dashboard-shortcuts__grid {
  display: grid;
  min-width: 0;
  gap: var(--td-size-3);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard-shortcuts__item {
  height: auto;
  justify-content: flex-start;
  padding: var(--td-size-3);
  border-radius: var(--td-radius-default);
  text-align: left;
  white-space: normal;
}

/* t-button 默认将内容包裹层居中，这里拉满宽度保证左对齐 */
.dashboard-shortcuts__item :deep(.t-button__text) {
  display: flex;
  width: 100%;
  min-width: 0;
}

.dashboard-shortcuts__inner {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.dashboard-shortcuts__icon {
  display: grid;
  width: var(--td-comp-size-s);
  height: var(--td-comp-size-s);
  flex: 0 0 auto;
  border-radius: var(--td-radius-default);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  place-content: center;
}

.dashboard-shortcuts__title {
  overflow: hidden;
  min-width: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dashboard-shortcuts__grid {
    grid-template-columns: 1fr;
  }
}
</style>
