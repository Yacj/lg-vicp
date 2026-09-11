<script setup lang="ts">
import type { AiSourceRef } from '@/types/ai-source'
import { computed, ref } from 'vue'
import { resolveAiSourceLocator } from '@/types/ai-source'
import { knowledgePageLabel } from '@/utils/knowledge-user'
import KnowledgeSourceReader from './KnowledgeSourceReader.vue'

/**
 * 层级检索命中卡（查询测试 / AI 引用测试 / 引用溯源共用）：
 * 按体系 → 文档 → 章节 → 页面 → 内容块 展示完整检索路径；
 * [查看完整原文] 打开 Wiki 阅读器回到完整页；Chunk 等技术字段只出现在"调试信息"折叠区。
 */

const props = withDefaults(defineProps<{
  source: AiSourceRef
  index?: number
  /** 只有具备知识高级调试权限时才显示技术字段。 */
  debugEnabled?: boolean
  /** 追加展示在调试折叠区的技术字段（如命中原因、排序分） */
  debug?: Record<string, unknown> | null
}>(), {
  index: undefined,
  debug: null,
  debugEnabled: false,
})

const readerVisible = ref(false)

const locator = computed(() => resolveAiSourceLocator(props.source))
const canOpenReader = computed(() => locator.value !== null)

const evidenceTheme = computed(() => (props.source.evidenceLevel === 'A' ? 'primary' : 'default'))

const pathSegments = computed(() => {
  const segments: string[] = []
  if (props.source.chapter) {
    segments.push(props.source.chapter)
  }
  if (props.source.sectionPath && props.source.sectionPath.length > 0) {
    segments.push(...props.source.sectionPath)
  }
  else if (props.source.section) {
    segments.push(props.source.section)
  }
  return segments
})

const pageText = computed(() => knowledgePageLabel(
  props.source.pageLabel,
  props.source.physicalPageNumber ?? props.source.pageStart ?? props.source.pageNumber ?? null,
))

const hitExcerpt = computed(() => {
  const text = props.source.snippet || props.source.matchedText || ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized
})

const evidenceLabel = computed(() => {
  const level = props.source.evidenceLevel
  if (!level) {
    return null
  }
  return { A: '权威依据', B: '推荐依据', C: '参考依据' }[level] ?? level
})

const debugEntries = computed(() => {
  const entries: Array<{ label: string, value: string }> = []
  const push = (label: string, value: unknown): void => {
    if (value !== undefined && value !== null && value !== '') {
      entries.push({ label, value: String(value) })
    }
  }
  push('来自', props.source.retrievalUnit === 'SECTION' ? '章节' : props.source.retrievalUnit === 'PAGE' ? '页面' : props.source.retrievalUnit ? '内容' : null)
  push('资料编号', props.source.documentId)
  push('版本编号', props.source.versionId)
  push('章节编号', props.source.sectionId)
  push('页面编号', props.source.pageId)
  push('匹配程度', props.source.score)
  if (props.source.matchedText) {
    entries.push({ label: '引用内容', value: props.source.matchedText })
  }
  if (props.debug) {
    for (const [key, value] of Object.entries(props.debug)) {
      push(key, value)
    }
  }
  return entries
})

function openReader(): void {
  if (!canOpenReader.value) {
    return
  }
  readerVisible.value = true
}
</script>

<template>
  <div class="ks-hit-card">
    <div class="ks-hit-card__head">
      <span v-if="index !== undefined" class="ks-hit-card__index">[资料{{ index }}]</span>
      <span class="ks-hit-card__title">{{ source.title }}</span>
      <t-tag v-if="evidenceLabel" size="small" variant="light" :theme="evidenceTheme">
        {{ evidenceLabel }}
      </t-tag>
    </div>

    <div class="ks-hit-card__path">
      <template v-if="pathSegments.length > 0">
        <span class="ks-hit-card__path-item">{{ source.title }}</span>
        <span v-for="(segment, idx) in pathSegments" :key="`${idx}-${segment}`" class="ks-hit-card__path-item">
          {{ segment }}
        </span>
      </template>
      <span v-if="pageText" class="ks-hit-card__path-item is-page">{{ pageText }}</span>
      <span v-if="source.citationAnchor" class="ks-hit-card__path-item">{{ source.citationAnchor }}</span>
    </div>

    <p v-if="hitExcerpt" class="ks-hit-card__excerpt">
      {{ hitExcerpt }}
    </p>

    <div class="ks-hit-card__actions">
      <t-button
        v-if="canOpenReader"
        size="small"
        theme="primary"
        variant="text"
        @click="openReader"
      >
        查看完整原文
      </t-button>
    </div>

    <t-collapse v-if="debugEnabled && debugEntries.length > 0" class="ks-hit-card__debug" expand-icon-placement="right">
      <t-collapse-panel value="debug" header="更多信息">
        <div class="ks-hit-card__debug-list">
          <div v-for="entry in debugEntries" :key="entry.label" class="ks-hit-card__debug-item">
            <span>{{ entry.label }}</span>
            <code>{{ entry.value }}</code>
          </div>
        </div>
      </t-collapse-panel>
    </t-collapse>

    <t-drawer
      v-model:visible="readerVisible"
      attach="body"
      header="原文阅读"
      placement="right"
      :prevent-scroll-through="true"
      size="min(760px, 96vw)"
      :footer="false"
    >
      <KnowledgeSourceReader v-if="locator && readerVisible" :locator="locator" />
    </t-drawer>
  </div>
</template>

<style scoped>
.ks-hit-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
  transition: border-color 0.2s;
}

.ks-hit-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.ks-hit-card__index {
  flex: 0 0 auto;
  color: var(--td-brand-color);
  font-weight: var(--td-font-weight-medium);
  white-space: nowrap;
}

.ks-hit-card__title {
  min-width: 0;
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}

.ks-hit-card__path {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ks-hit-card__path-item {
  display: inline-flex;
  align-items: center;
}

.ks-hit-card__path-item + .ks-hit-card__path-item::before {
  margin: 0 var(--td-size-2);
  color: var(--td-text-color-placeholder);
  content: '/';
}

.ks-hit-card__path-item.is-page {
  color: var(--td-brand-color);
}

.ks-hit-card__excerpt {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.7;
}

.ks-hit-card__actions {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.ks-hit-card__debug :deep(.t-collapse-panel__content) {
  color: var(--td-text-color-secondary);
}

.ks-hit-card__debug-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ks-hit-card__debug-item {
  display: flex;
  flex-direction: column;
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
}

.ks-hit-card__debug-item span {
  color: var(--td-text-color-placeholder);
}

.ks-hit-card__debug-item code {
  font-family: var(--td-font-family-mono);
}
</style>
