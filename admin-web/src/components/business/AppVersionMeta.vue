<script setup lang="ts">
import { computed } from 'vue'

/**
 * 版本元信息：版本号 + 变更说明（变更说明过长时截断并保留 title）。
 */
const props = withDefaults(defineProps<{
  version?: number | null
  changeNote?: string | null
  /** 无版本信息时是否显示占位符 */
  showEmpty?: boolean
}>(), {
  version: null,
  changeNote: null,
  showEmpty: true,
})

const versionText = computed(() => (props.version == null ? '' : `v${props.version}`))

const hasNote = computed(() => Boolean(props.changeNote?.trim()))

const empty = computed(() => props.showEmpty && !versionText.value && !hasNote.value)
</script>

<template>
  <span v-if="empty" class="app-version-meta__empty">--</span>
  <span v-else class="app-version-meta">
    <span v-if="versionText" class="app-version-meta__badge">{{ versionText }}</span>
    <span
      v-if="hasNote"
      class="app-version-meta__note"
      :title="changeNote ?? undefined"
    >{{ changeNote }}</span>
  </span>
</template>

<style scoped>
.app-version-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-2);
  max-width: 100%;
}

.app-version-meta__badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--td-size-1);
  border-radius: var(--td-radius-small);
  background: var(--td-brand-color-1);
  color: var(--td-brand-color);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
  white-space: nowrap;
}

.app-version-meta__note {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-version-meta__empty {
  color: var(--td-text-color-placeholder);
}
</style>