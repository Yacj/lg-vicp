<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import { computed, getCurrentInstance, ref } from 'vue'
import { referenceAnswerPageContent } from '@/utils/aiReferenceAnswer'
import { markdownTagStyle, renderMarkdown } from '@/utils/markdown'
import AiAnswerReferencePage from './AiAnswerReferencePage.vue'

const props = defineProps<{ answer: string, pages: AiReferencePage[] }>()
const emit = defineEmits<{ open: [page: AiReferencePage, match?: ReferenceHighlight] }>()
const expanded = ref(false)
const viewerPrefix = `answer-${getCurrentInstance()?.uid ?? 0}`
const content = computed(() => referenceAnswerPageContent(props.answer, props.pages))
const pageCount = computed(() => content.value.leadingPages.length + content.value.blocks.reduce((count, block) => count + block.pages.length, 0))
const display = computed(() => {
  let used = 0
  const project = (pages: AiReferencePage[]) => pages.flatMap((page) => {
    const index = used++
    return expanded.value || index < 2 ? [{ page, anchorPrefix: `${viewerPrefix}-page-${index}` }] : []
  })
  return { leading: project(content.value.leadingPages), blocks: content.value.blocks.map(block => ({ html: renderMarkdown(block.content), content: block.content, pages: project(block.pages) })) }
})
</script>

<template>
  <view>
    <view v-if="display.leading.length" class="mb-3">
      <view class="app-muted text-2.5">
        参考方案
      </view>
      <AiAnswerReferencePage v-for="item in display.leading" :key="`${item.page.page.documentId}:${item.page.page.pageId}`" :page="item.page" :anchor-prefix="item.anchorPrefix" @open="emit('open', item.page, $event)" />
    </view>
    <view v-for="(block, index) in display.blocks" :key="index">
      <mp-html v-if="block.content.trim()" :content="block.html" :tag-style="markdownTagStyle" scroll-table preview-img container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word; word-break: break-word;" />
      <AiAnswerReferencePage v-for="item in block.pages" :key="`${item.page.page.documentId}:${item.page.page.pageId}`" :page="item.page" :anchor-prefix="item.anchorPrefix" @open="emit('open', item.page, $event)" />
    </view>
    <wd-button v-if="pageCount > 2" size="small" variant="text" @click="expanded = !expanded">
      {{ expanded ? '收起其他参考表格' : `查看其他参考表格（${pageCount - 2} 页）` }}
    </wd-button>
  </view>
</template>
