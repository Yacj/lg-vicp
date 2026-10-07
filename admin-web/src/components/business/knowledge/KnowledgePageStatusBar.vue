<script setup lang="ts">
import { computed } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { KnowledgeWorkspace } from '@/types/knowledge'
import { knowledgeTextParsingMeta } from '@/utils/knowledge-user'

const props = defineProps<{ workspace: KnowledgeWorkspace | null }>()

const textMeta = computed(() => {
  const parsing = props.workspace?.parsing
  if (parsing?.textParsing) {
    return knowledgeTextParsingMeta(parsing.textParsing)
  }
  // 文本通道尚未回写时：整份 PARSE_FAILED 才视为失败，其余按就绪态推断
  const userStatus = props.workspace?.currentVersion?.userStatus
  if (userStatus === 'PARSE_FAILED') {
    return knowledgeTextParsingMeta('FAILED')
  }
  if (userStatus === 'READY' || userStatus === 'READY_TO_VERIFY') {
    return knowledgeTextParsingMeta('READY')
  }
  return knowledgeTextParsingMeta(null)
})

const pageCount = computed(() => props.workspace?.summary.pageCount ?? 0)
const pageStatus = computed(() => pageCount.value > 0
  ? { label: `已上传 ${pageCount.value} 页`, status: 'success' as const }
  : { label: '等待页面图片', status: 'warning' as const })
</script>

<template>
  <section class="knowledge-page-status">
    <div class="knowledge-page-status__row">
      <div class="knowledge-page-status__item">
        <span class="knowledge-page-status__label">文本解析</span>
        <AppStatusTag :label="textMeta.label" :status="textMeta.status" />
      </div>
      <div class="knowledge-page-status__item">
        <span class="knowledge-page-status__label">页面生成</span>
        <AppStatusTag :label="pageStatus.label" :status="pageStatus.status" />
      </div>
      <div class="knowledge-page-status__item">
        <span class="knowledge-page-status__label">共 {{ pageCount }} 页</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.knowledge-page-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding: 12px 16px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-page-status__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.knowledge-page-status__item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.knowledge-page-status__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-page-status__actions {
  margin-left: auto;
}

.knowledge-page-status__hint {
  margin: 0;
  font-size: var(--td-font-size-body-small);
}

.knowledge-page-status__hint.is-processing {
  color: var(--td-brand-color);
}

.knowledge-page-status__hint.is-error {
  color: var(--td-error-color);
}
</style>
