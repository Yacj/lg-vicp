<script setup lang="ts">
import type { AiSourceRef } from '@/api/types'
import { canOpenOriginal, sourceChapterPath, sourcePageLabel, sourceQuote } from '@/utils/aiSource'

const props = withDefaults(defineProps<{
  sources: AiSourceRef[]
  defaultVisible?: number
}>(), {
  defaultVisible: 2,
})

const emit = defineEmits<{
  open: [source: AiSourceRef]
}>()

const expanded = ref(false)

const visibleSources = computed(() => {
  if (expanded.value || props.sources.length <= props.defaultVisible) {
    return props.sources
  }
  return props.sources.slice(0, props.defaultVisible)
})

const hiddenCount = computed(() => Math.max(0, props.sources.length - visibleSources.value.length))

const displayItems = computed(() => visibleSources.value.map(source => ({
  title: source.title,
  chapter: sourceChapterPath(source).join(' · '),
  pageLabel: sourcePageLabel(source),
  quote: sourceQuote(source),
  canOpen: canOpenOriginal(source),
  source,
})))

function handleOpen(item: { canOpen: boolean, source: AiSourceRef }) {
  if (item.canOpen) {
    emit('open', item.source)
  }
}
</script>

<template>
  <view v-if="sources.length" class="ai-sources mt-1.5">
    <view class="app-muted text-2.5">
      参考资料（{{ sources.length }}）
    </view>

    <view
      v-for="(item, index) in displayItems"
      :key="`${item.source.documentId || item.title}-${index}`"
      class="ai-source-card app-panel-flat mt-1.5 rounded-xl px-3 py-2.5"
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

    <view
      v-if="hiddenCount"
      class="app-primary-text mt-1.5 inline-flex items-center text-2.5"
      @click="expanded = true"
    >
      查看全部
    </view>
  </view>
</template>
