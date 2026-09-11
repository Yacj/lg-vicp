<script setup lang="ts">
import { computed } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { KnowledgeDocumentVersion } from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'
import { knowledgeVersionStatusMetaFor } from '@/utils/professional-status'

const props = defineProps<{
  visible: boolean
  versions: KnowledgeDocumentVersion[]
  currentVersionId?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'select': [version: KnowledgeDocumentVersion]
}>()

const sorted = computed(() => [...props.versions].sort((a, b) => b.version - a.version))

function versionUserLabel(version: KnowledgeDocumentVersion): string {
  if (version.parseStatus === 'FAILED') {
    return knowledgeUserStatusMetaFor('PARSE_FAILED').label
  }
  if (version.parseStatus === 'PARSING' || version.pipelineStatus === 'PARSING' || version.pipelineStatus === 'CHUNKING') {
    return knowledgeUserStatusMetaFor('PARSING').label
  }
  if (version.parseStatus === 'NO_TEXT_LAYER' || version.parseStatus === 'SEARCH_SOURCE_REQUIRED') {
    return knowledgeUserStatusMetaFor('SEARCHABLE_FILE_REQUIRED').label
  }
  if (version.status === 'PUBLISHED') {
    return '已发布'
  }
  if (version.parseStatus === 'PARSED' || version.parseStatus === 'PARTIAL') {
    return knowledgeUserStatusMetaFor('READY_TO_VERIFY').label
  }
  return knowledgeVersionStatusMetaFor(version.status).label
}
</script>

<template>
  <t-drawer
    :footer="false"
    header="历史版本"
    :visible="visible"
    size="400px"
    @close="emit('update:visible', false)"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <ol class="knowledge-versions">
      <li
        v-for="version in sorted"
        :key="version.id"
        class="knowledge-versions__item"
        :class="{ 'is-current': version.id === currentVersionId }"
        @click="emit('select', version)"
      >
        <div>
          <strong>
            {{ version.id === currentVersionId ? '当前版本' : 'v' }}{{ version.id === currentVersionId ? ` v${version.version}` : version.version }}
          </strong>
          <span>{{ formatDate(new Date(version.updatedAt), 'YYYY-MM-DD') }}</span>
        </div>
        <AppStatusTag :label="versionUserLabel(version)" size="small" />
      </li>
    </ol>
  </t-drawer>
</template>

<style scoped>
.knowledge-versions {
  margin: 0;
  padding: 0;
  list-style: none;
}

.knowledge-versions__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--td-comp-paddingTB-m) 0;
  border-bottom: 1px solid var(--td-component-stroke);
  cursor: pointer;
}

.knowledge-versions__item div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.knowledge-versions__item strong {
  color: var(--td-text-color-primary);
}

.knowledge-versions__item span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-versions__item.is-current strong {
  color: var(--td-brand-color);
}
</style>
