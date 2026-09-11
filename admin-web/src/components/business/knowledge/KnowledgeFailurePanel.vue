<script setup lang="ts">
import { computed, ref } from 'vue'
import type { KnowledgeWorkspaceFile, KnowledgeWorkspaceLastJob } from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeFailureMessage, knowledgeParsingStageLabel, knowledgeUserMessage } from '@/utils/knowledge-user'

const props = withDefaults(defineProps<{
  file?: KnowledgeWorkspaceFile | null
  job?: KnowledgeWorkspaceLastJob | null
  canRetry?: boolean
  canReplace?: boolean
  canDebug?: boolean
}>(), {
  file: null,
  job: null,
  canRetry: false,
  canReplace: false,
  canDebug: false,
})

const emit = defineEmits<{
  retry: []
  replace: []
}>()

const technicalOpen = ref(false)
const reason = computed(() => knowledgeFailureMessage(props.job))
const processedAt = computed(() => {
  const at = props.job?.finishedAt ?? props.job?.startedAt
  return at ? formatDate(new Date(at), 'YYYY-MM-DD HH:mm') : ''
})
</script>

<template>
  <section class="knowledge-failure">
    <div class="knowledge-failure__head">
      <span aria-hidden="true">✕</span>
      <h2>解析失败</h2>
    </div>
    <p>系统在解析文件时遇到问题。</p>

    <dl>
      <div>
        <dt>失败原因</dt>
        <dd>{{ reason }}</dd>
      </div>
      <div v-if="file?.name">
        <dt>文件</dt>
        <dd>{{ file.name }}</dd>
      </div>
      <div v-if="processedAt">
        <dt>最近处理</dt>
        <dd>{{ processedAt }}</dd>
      </div>
    </dl>

    <div class="knowledge-failure__actions">
      <t-button v-if="canRetry" theme="primary" @click="emit('retry')">
        重新解析
      </t-button>
      <t-button v-if="canReplace" theme="default" variant="outline" @click="emit('replace')">
        更换文件
      </t-button>
    </div>

    <div v-if="canDebug && job" class="knowledge-failure__tech">
      <t-button theme="default" variant="text" @click="technicalOpen = !technicalOpen">
        详细说明 {{ technicalOpen ? '▴' : '▾' }}
      </t-button>
      <dl v-if="technicalOpen">
        <div><dt>任务编号</dt><dd>{{ job.id }}</dd></div>
        <div v-if="job.technical?.parser"><dt>解析方式</dt><dd>{{ job.technical.parser }}</dd></div>
        <div><dt>尝试次数</dt><dd>{{ job.attempts }}</dd></div>
        <div v-if="job.stage"><dt>当前阶段</dt><dd>{{ knowledgeParsingStageLabel(job.stage) }}</dd></div>
        <div v-if="job.technical?.reason"><dt>系统说明</dt><dd>{{ knowledgeUserMessage(job.technical.reason) }}</dd></div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.knowledge-failure {
  max-width: 640px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-error-color-3);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-failure__head {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  color: var(--td-error-color);
}

.knowledge-failure h2,
.knowledge-failure p,
.knowledge-failure dl {
  margin: 0;
}

.knowledge-failure h2 {
  font-size: var(--td-font-size-title-medium);
}

.knowledge-failure > p {
  margin: var(--td-size-3) 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
}

.knowledge-failure dl {
  display: grid;
  gap: var(--td-size-4);
}

.knowledge-failure dt {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.knowledge-failure dd {
  margin: 4px 0 0;
  color: var(--td-text-color-primary);
}

.knowledge-failure__actions {
  display: flex;
  gap: var(--td-size-3);
  margin-top: var(--td-size-6);
}

.knowledge-failure__tech {
  margin-top: var(--td-size-5);
}

.knowledge-failure__tech dl {
  margin-top: var(--td-size-3);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-medium);
  font-family: var(--td-font-family);
  font-size: var(--td-font-size-body-small);
}
</style>
