<script setup lang="ts">
import { NotificationIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import { useNotifications } from '@/composables/useNotifications'
import { useUserStore } from '@/stores/user'

defineProps<{
  greeting: string
  todayText: string
}>()

const userStore = useUserStore()

const userName = computed(() => userStore.profile?.displayName.trim() || '管理员')

const primaryDepartment = computed(() =>
  userStore.departments.find(department => department.isPrimary)?.name
  ?? userStore.departments[0]?.name
  ?? '',
)

// 未读数为模块级共享状态，由 Header 通知中心统一轮询，这里只读展示
const canNotify = computed(() => userStore.hasPermission('system:notification:list'))
const { unreadCount, hasUnread } = useNotifications()
const showUnread = computed(() => canNotify.value && hasUnread.value)
</script>

<template>
  <section class="dashboard-welcome">
    <div class="dashboard-welcome__intro">
      <h2>{{ greeting }}，{{ userName }}</h2>
      <p class="dashboard-welcome__meta">
        <span>{{ todayText }}</span>
        <span v-if="primaryDepartment">{{ primaryDepartment }}</span>
      </p>
    </div>
    <t-tooltip v-if="showUnread" content="请在页面右上角铃铛中查看通知" placement="bottom">
      <t-tag class="dashboard-welcome__unread" size="small" theme="warning" variant="light">
        <NotificationIcon />
        {{ unreadCount }} 条未读通知
      </t-tag>
    </t-tooltip>
  </section>
</template>

<style scoped>
.dashboard-welcome {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-6);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.dashboard-welcome__intro {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
}

.dashboard-welcome h2 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-large);
  font-weight: 600;
}

.dashboard-welcome__meta {
  display: flex;
  margin: 0;
  align-items: center;
  gap: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.dashboard-welcome__unread {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-1);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dashboard-welcome {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-3);
  }
}
</style>
