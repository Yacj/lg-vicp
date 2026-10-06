<script setup lang="ts">
import type { AiSourceRef } from '@/api/types'
import { canOpenOriginal, sourceChapterPath, sourcePageLabel, sourceQuote } from '@/utils/aiSource'

const props = withDefaults(defineProps<{
  sources: AiSourceRef[]
  defaultExpanded?: boolean
}>(), {
  defaultExpanded: false,
})

const emit = defineEmits<{
  open: [source: AiSourceRef]
}>()

const expanded = ref(props.defaultExpanded)

watch(() => props.defaultExpanded, (value) => {
  if (value) {
    expanded.value = true
  }
})

const displayItems = computed(() => props.sources.map(source => ({
  title: source.title,
  chapter: sourceChapterPath(source).join(' · '),
  pageLabel: sourcePageLabel(source),
  quote: sourceQuote(source),
  canOpen: canOpenOriginal(source),
  source,
})))

function toggle() {
  expanded.value = !expanded.value
}

function handleOpen(item: { canOpen: boolean, source: AiSourceRef }) {
  if (item.canOpen) {
    emit('open', item.source)
  }
}
</script>

<template>
  <view v-if="sources.length" class="ai-sources mt-1.5">
    <view
      class="ai-sources__toggle app-muted inline-flex items-center gap-1 text-2.5"
      @click="toggle"
    >
      <text>参考资料 {{ sources.length }}</text>
      <wd-icon :name="expanded ? 'arrow-up' : 'arrow-down'" size="22rpx" />
    </view>

    <view v-if="expanded" class="mt-1.5 space-y-1.5">
      <view
        v-for="(item, index) in displayItems"
        :key="`${item.source.documentId || item.title}-${index}`"
        class="ai-source-card app-panel-flat rounded-xl px-3 py-2.5"
        :class="item.canOpen ? 'app-pressable' : ''"
        @click="handleOpen(item)"
      >
        <view class="truncate text-3 font-medium">
          {{ item.title }}
        </view>
        <view v-if="item.chapter" class="app-muted mt-1 truncate text-2.5 leading-4">
          {{ item.chapter }}
        </view>
        <view v-if="item.pageLabel" class="app-primary-text mt-1 text-2.5 font-medium">
          {{ item.pageLabel }}
        </view>
        <view v-if="item.quote" class="app-tertiary mt-1 text-2.5 leading-4">
          “{{ item.quote }}”
        </view>
        <view
          v-if="item.canOpen"
          class="app-primary-text mt-2 inline-flex items-center text-2.5"
        >
          查看原文
        </view>
      </view>
    </view>
  </view>
</template>
