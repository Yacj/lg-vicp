<script setup lang="ts">
import { Building1Icon } from 'tdesign-icons-vue-next'

defineOptions({ name: 'AppLogo' })

defineProps<{
  collapsed?: boolean
  compact?: boolean
  inverse?: boolean
}>()
</script>

<template>
  <div class="app-logo" :class="{ 'is-collapsed': collapsed, 'is-compact': compact, 'is-inverse': inverse }">
    <span class="app-logo__mark" aria-hidden="true">
      <Building1Icon />
    </span>
    <span v-if="!collapsed" class="app-logo__copy">
      <strong>蓝格智配</strong>
    </span>
  </div>
</template>

<style scoped>
.app-logo {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: var(--td-text-color-primary);
}

.app-logo__mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: var(--td-radius-medium);
  color: var(--td-text-color-anti);
  background: var(--td-brand-color);
  font-size: 20px;
}

.app-logo__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  white-space: nowrap;
}

.app-logo__copy strong {
  overflow: hidden;
  font-size: 22px;
  text-overflow: ellipsis;
}

.app-logo__copy small {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
}

.app-logo.is-compact .app-logo__mark {
  width: 32px;
  height: 32px;
  flex-basis: 32px;
  font-size: 18px;
}

.app-logo.is-inverse {
  color: var(--td-text-color-anti);
}

.app-logo.is-inverse .app-logo__mark {
  color: var(--vicp-system-brand-color);
  background: var(--td-text-color-anti);
}

.app-logo.is-inverse .app-logo__copy small {
  color: var(--td-font-white-2);
}

.app-logo.is-collapsed {
  justify-content: center;
}
</style>
