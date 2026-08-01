<script setup lang="ts">
import { computed } from 'vue'
import { useUserStore } from '@/stores/user'

withDefaults(defineProps<{
  inverse?: boolean
}>(), {
  inverse: false,
})

const userStore = useUserStore()
const displayName = computed(() => userStore.profile?.displayName.trim() || '管理员')
const initial = computed(() => Array.from(displayName.value)[0] ?? '管')
const roleLabel = computed(() => {
  if (userStore.roles.length > 0) {
    return userStore.roles.join('、')
  }
  switch (userStore.profile?.role) {
    case 'SUPER_ADMIN':
      return '平台超级管理员'
    case 'CHANNEL_USER':
      return '渠道管理账号'
    case 'NORMAL_USER':
      return '普通账号'
    default:
      return '管理账号'
  }
})
const departmentLabel = computed(() => (
  userStore.departments.find(department => department.isPrimary)?.name ?? '未分配主部门'
))
</script>

<template>
  <div class="app-user-summary" :class="{ 'is-inverse': inverse }">
    <t-avatar size="40px">
      {{ initial }}
    </t-avatar>
    <div class="app-user-summary__copy">
      <strong>{{ displayName }}</strong>
      <span>{{ roleLabel }}</span>
      <small>{{ departmentLabel }}</small>
    </div>
  </div>
</template>

<style scoped>
.app-user-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-5);
  color: var(--td-text-color-primary);
}

.app-user-summary__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.app-user-summary__copy strong,
.app-user-summary__copy span,
.app-user-summary__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-user-summary__copy strong {
  font-size: var(--td-font-size-body-medium);
}

.app-user-summary__copy span,
.app-user-summary__copy small {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 400;
}

.app-user-summary.is-inverse {
  color: var(--td-text-color-anti);
}

.app-user-summary.is-inverse .app-user-summary__copy span,
.app-user-summary.is-inverse .app-user-summary__copy small {
  color: var(--td-font-white-2);
}
</style>
