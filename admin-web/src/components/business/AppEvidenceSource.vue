<script setup lang="ts">
import { computed } from 'vue'
import type { EvidenceMeta } from '@/types/professional'
import { evidenceLevelLabels } from '@/utils/professional-status'
import { formatDate } from '@/utils/day'

/**
 * 来源与可信度展示：资料来源、页码/条款、可信度等级、生效/失效时间。
 * 可信度等级语义见 types/professional.ts 的 evidenceLevelMeta。
 */
const props = withDefaults(defineProps<{
  evidence?: (Partial<EvidenceMeta> & Record<string, unknown>) | null
}>(), {
  evidence: null,
})

const hasAny = computed(() => {
  const item = props.evidence
  return Boolean(item && (item.evidenceSource || item.evidenceRef || item.evidenceLevel))
})

function formatDay(value: string | null | undefined): string {
  return value ? formatDate(new Date(value), 'YYYY-MM-DD') : ''
}

const periodText = computed(() => {
  const item = props.evidence
  if (!item) {
    return ''
  }
  const start = formatDay(item.effectiveAt)
  const end = formatDay(item.expiresAt)
  if (start && end) {
    return `${start} ~ ${end}`
  }
  if (start) {
    return `生效于 ${start}`
  }
  if (end) {
    return `失效于 ${end}`
  }
  return ''
})
</script>

<template>
  <div v-if="hasAny" class="app-evidence-source">
    <span v-if="evidence?.evidenceSource" class="app-evidence-source__source">
      {{ evidence?.evidenceSource }}
    </span>
    <span v-if="evidence?.evidenceRef" class="app-evidence-source__ref">
      {{ evidence?.evidenceRef }}
    </span>
    <span v-if="evidence?.evidenceLevel" class="app-evidence-source__level">
      {{ evidenceLevelLabels[evidence.evidenceLevel] }}
    </span>
    <span v-if="periodText" class="app-evidence-source__period">{{ periodText }}</span>
  </div>
  <span v-else class="app-evidence-source__empty">--</span>
</template>

<style scoped>
.app-evidence-source {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
}

.app-evidence-source__source {
  color: var(--td-text-color-primary);
}

.app-evidence-source__ref,
.app-evidence-source__level {
  white-space: nowrap;
}

.app-evidence-source__ref {
  color: var(--td-brand-color);
}

.app-evidence-source__level {
  color: var(--td-warning-color);
}

.app-evidence-source__period {
  white-space: nowrap;
}

.app-evidence-source__empty {
  color: var(--td-text-color-placeholder);
}
</style>