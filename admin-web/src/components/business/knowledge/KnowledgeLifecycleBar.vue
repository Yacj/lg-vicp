<script setup lang="ts">
import type { KnowledgePageRecognitionSummary, KnowledgeVersionIndex, KnowledgeWorkspace } from '@/types/knowledge'
import { computed } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { businessUserMessage } from '@/utils/business-error'
import { buildRecognitionChips, knowledgeIndexMeta } from '@/utils/knowledge-lifecycle'

const props = withDefaults(defineProps<{
  workspace: KnowledgeWorkspace | null
  index?: KnowledgeVersionIndex | null
  recognitionSummary?: KnowledgePageRecognitionSummary | null
}>(), {
  index: null,
  recognitionSummary: null,
})

const chips = computed(() => buildRecognitionChips(props.recognitionSummary).filter(chip => chip.value > 0))
const indexMeta = computed(() => knowledgeIndexMeta(props.index))

const published = computed(() => props.workspace?.currentVersion?.status === 'PUBLISHED')
const canPublish = computed(() => Boolean(props.workspace?.summary.canPublish))
const publishLabel = computed(() => {
  if (published.value) {
    return '已发布'
  }
  return canPublish.value ? '可以发布' : '暂不可发布'
})
const publishStatus = computed<'success' | 'warning'>(() => (published.value || canPublish.value ? 'success' : 'warning'))

/** 发布阻断原因：后端给出的人类可读中文，前端只做展示与截断，不自行推断。 */
const publishHint = computed(() => {
  if (!props.workspace || canPublish.value) {
    return ''
  }
  const blockers = props.workspace.summary.publishBlockers ?? []
  if (!blockers.length) {
    return ''
  }
  return `下一步：${businessUserMessage(blockers[0])}${blockers.length > 1 ? `；另有 ${blockers.length - 1} 项待完成` : ''}`
})
</script>

<template>
  <section class="knowledge-lifecycle-bar">
    <div class="knowledge-lifecycle-bar__row">
      <template v-if="workspace?.summary.contentSource !== 'ORIGINAL_FILE' && chips.length">
        <div v-for="chip in chips" :key="chip.key" class="knowledge-lifecycle-bar__item">
          <span class="knowledge-lifecycle-bar__label">{{ chip.label }}</span>
          <AppStatusTag :label="String(chip.value)" :status="chip.status" />
        </div>
      </template>
      <div v-else-if="workspace?.summary.contentSource !== 'ORIGINAL_FILE'" class="knowledge-lifecycle-bar__item">
        <span class="knowledge-lifecycle-bar__label">页面处理</span>
        <AppStatusTag :label="recognitionSummary?.total ? '页面状态正在更新' : '还没有资料页面'" status="default" />
      </div>

      <div class="knowledge-lifecycle-bar__item">
        <span class="knowledge-lifecycle-bar__label">问答内容</span>
        <AppStatusTag :label="indexMeta.label" :status="indexMeta.status" />
      </div>

      <div class="knowledge-lifecycle-bar__item">
        <span class="knowledge-lifecycle-bar__label">发布</span>
        <AppStatusTag :label="publishLabel" :status="publishStatus" />
      </div>

      <div v-if="$slots.actions" class="knowledge-lifecycle-bar__actions">
        <slot name="actions" />
      </div>
    </div>

    <p v-if="indexMeta.hint" class="knowledge-lifecycle-bar__hint">
      {{ indexMeta.hint }}
    </p>
    <p v-if="publishHint" class="knowledge-lifecycle-bar__hint is-warning">
      {{ publishHint }}
    </p>
  </section>
</template>

<style scoped>
.knowledge-lifecycle-bar {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin-bottom: var(--td-size-3);
  padding: var(--td-size-3) var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-lifecycle-bar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2) var(--td-size-4);
}

.knowledge-lifecycle-bar__item {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.knowledge-lifecycle-bar__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-lifecycle-bar__value {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}

.knowledge-lifecycle-bar__actions {
  margin-left: auto;
}

.knowledge-lifecycle-bar__hint {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-lifecycle-bar__hint.is-warning {
  color: var(--td-warning-color);
}
</style>
