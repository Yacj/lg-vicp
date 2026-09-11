<script setup lang="ts">
import type { AiSourcePageBlock } from '@/types/ai-source'
import type { HighlightRangeInput } from '@/utils/highlight'
import { computed, ref } from 'vue'
import { buildHighlightSegments } from '@/utils/highlight'

/**
 * Wiki 页面内容渲染（纯展示，供阅读器与文档详情阅读视图共用）：
 * - 有内容块时按原顺序渲染标题/段落/表格块；否则渲染整页解析文本；
 * - 命中区域浅色背景高亮，关键词查找失败时只丢失高亮、不隐藏原文；
 * - pageImageUrl 为空时不提供"原页图片"切换，不渲染空图。
 */

interface ReaderHighlight extends HighlightRangeInput {
  blockId?: string | null
}

const props = withDefaults(defineProps<{
  pageNumber: number | null
  fullText: string
  blocks?: Array<Pick<AiSourcePageBlock, 'id' | 'content' | 'contentType'>>
  highlights?: ReaderHighlight[]
  pageImageUrl?: string | null
}>(), {
  blocks: () => [],
  highlights: () => [],
  pageImageUrl: null,
})

const showPageImage = ref(false)
const hasPageImage = computed(() => Boolean(props.pageImageUrl))

const blockHighlightIds = computed(() => {
  const ids = new Set<string>()
  for (const highlight of props.highlights) {
    if (highlight.blockId) {
      ids.add(highlight.blockId)
    }
  }
  return ids
})

function isBlockHighlighted(block: Pick<AiSourcePageBlock, 'id'>): boolean {
  return blockHighlightIds.value.has(block.id)
}

function blockKind(contentType: string): 'heading' | 'table' | 'paragraph' {
  const normalized = contentType.toUpperCase()
  if (normalized === 'TITLE' || normalized === 'HEADING' || normalized === 'SECTION') {
    return 'heading'
  }
  if (normalized === 'TABLE') {
    return 'table'
  }
  return 'paragraph'
}

const textSegments = computed(() =>
  buildHighlightSegments(
    props.fullText,
    props.highlights.map(highlight => ({
      charStart: highlight.charStart,
      charEnd: highlight.charEnd,
      text: highlight.text,
    })),
  ),
)
</script>

<template>
  <div class="ks-page-view">
    <div
      v-if="hasPageImage"
      class="ks-page-view__toolbar"
    >
      <t-radio-group v-model="showPageImage" size="small" variant="default-filled">
        <t-radio-button :value="false">
          文字内容
        </t-radio-button>
        <t-radio-button :value="true">
          页面图片
        </t-radio-button>
      </t-radio-group>
    </div>

    <img
      v-if="hasPageImage && showPageImage"
      class="ks-page-view__image"
      :src="pageImageUrl ?? ''"
      alt="页面图片"
    >

    <template v-else>
      <template v-if="blocks.length > 0">
        <template v-for="block in blocks" :key="block.id">
          <h4 v-if="blockKind(block.contentType) === 'heading'" class="ks-page-view__heading" :class="{ 'is-hit': isBlockHighlighted(block) }">
            {{ block.content }}
          </h4>
          <div v-else-if="blockKind(block.contentType) === 'table'" class="ks-page-view__table" :class="{ 'is-hit': isBlockHighlighted(block) }">
            <pre>{{ block.content }}</pre>
          </div>
          <p v-else class="ks-page-view__paragraph" :class="{ 'is-hit': isBlockHighlighted(block) }">
            {{ block.content }}
          </p>
        </template>
      </template>

      <p v-else class="ks-page-view__paragraph">
        <template v-for="(segment, index) in textSegments" :key="index">
          <mark v-if="segment.highlighted" class="ks-page-view__hit">{{ segment.text }}</mark><template v-else>
            {{ segment.text }}
          </template>
        </template>
      </p>

      <p v-if="blocks.length === 0 && !fullText" class="ks-page-view__empty">
        该页暂无解析文本
      </p>
    </template>
  </div>
</template>

<style scoped>
.ks-page-view {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.ks-page-view__toolbar {
  display: flex;
  justify-content: flex-end;
}

.ks-page-view__image {
  width: 100%;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-small);
}

.ks-page-view__heading {
  margin: var(--td-size-3) 0 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: var(--td-font-weight-medium);
  line-height: 1.6;
}

.ks-page-view__paragraph {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
}

.ks-page-view__table {
  overflow-x: auto;
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-secondarycontainer);
}

.ks-page-view__table pre {
  margin: 0;
  font-family: var(--td-font-family);
  font-size: var(--td-font-size-body-small);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.ks-page-view__empty {
  margin: 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  text-align: center;
}

/* 命中高亮：浅色背景整段标记，可读性优先，不做满页变色 */
.ks-page-view .is-hit,
.ks-page-view :deep(.ks-page-view__hit) {
  background: var(--td-warning-color-1);
  border-radius: 2px;
  box-shadow: 0 0 0 2px var(--td-warning-color-1);
  color: inherit;
}

.ks-page-view__heading.is-hit,
.ks-page-view__paragraph.is-hit,
.ks-page-view__table.is-hit {
  box-shadow: none;
  padding: 2px 4px;
}

mark.ks-page-view__hit {
  color: var(--td-text-color-primary);
}
</style>
