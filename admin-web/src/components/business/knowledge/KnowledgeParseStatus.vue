<script setup lang="ts">
import AppTaskProgress from '@/components/business/AppTaskProgress.vue'
import type { KnowledgeWorkspaceFile, KnowledgeWorkspaceLastJob } from '@/types/knowledge'
import { knowledgeParsingStageLabel } from '@/utils/knowledge-user'

withDefaults(defineProps<{
  progress?: number
  stage?: string | null
  file?: KnowledgeWorkspaceFile | null
  job?: KnowledgeWorkspaceLastJob | null
}>(), {
  progress: 0,
  stage: null,
  file: null,
  job: null,
})
</script>

<template>
  <section class="knowledge-parse-status">
    <div class="knowledge-parse-status__head">
      <span class="knowledge-parse-status__dot" aria-hidden="true" />
      <h2>正在解析</h2>
    </div>
    <p class="knowledge-parse-status__lead">
      正在识别文档章节和内容
    </p>
    <AppTaskProgress :progress="progress" theme="plump" />
    <dl>
      <div>
        <dt>当前阶段</dt>
        <dd>{{ knowledgeParsingStageLabel(stage ?? job?.stage) }}</dd>
      </div>
      <div v-if="file?.name">
        <dt>文件</dt>
        <dd>{{ file.name }}</dd>
      </div>
    </dl>
    <p class="knowledge-parse-status__hint">
      你可以离开此页面，稍后回来查看结果。
    </p>
  </section>
</template>

<style scoped>
.knowledge-parse-status {
  max-width: 640px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-parse-status__head {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
}

.knowledge-parse-status__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--td-radius-circle);
  background: var(--td-brand-color);
}

.knowledge-parse-status h2,
.knowledge-parse-status p,
.knowledge-parse-status dl {
  margin: 0;
}

.knowledge-parse-status h2 {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-medium);
}

.knowledge-parse-status__lead {
  margin: var(--td-size-3) 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
}

.knowledge-parse-status dl {
  display: grid;
  gap: var(--td-size-3);
  margin-top: var(--td-size-5);
}

.knowledge-parse-status dt {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.knowledge-parse-status dd {
  margin: 2px 0 0;
  color: var(--td-text-color-primary);
}

.knowledge-parse-status__hint {
  margin-top: var(--td-size-5);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}
</style>
