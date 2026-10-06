<script setup lang="ts">
import type { ProductComparisonView } from '@/utils/aiComparison'
import { splitAnswerLayers } from '@/utils/aiAnswerUx'
import { markdownTagStyle, renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  comparison: ProductComparisonView
  explanation?: string
  explanationHtml?: string
}>()

const gridWidth = computed(() => `${160 + Math.max(props.comparison.products.length, 1) * 200}rpx`)
const thermalExpanded = ref(false)
const explanationExpanded = ref(false)

const explanationText = computed(() => props.explanation || '')
const explanationLayers = computed(() => splitAnswerLayers(explanationText.value))
const summaryHtml = computed(() => {
  if (!explanationText.value) {
    return props.explanationHtml || ''
  }
  return renderMarkdown(explanationLayers.value.summary)
})
const detailsHtml = computed(() => explanationLayers.value.details ? renderMarkdown(explanationLayers.value.details) : '')
</script>

<template>
  <view class="ai-comparison">
    <view class="ai-comparison__intro app-muted text-2.5 leading-4.5">
      {{ comparison.intro }}
    </view>

    <view class="ai-comparison__section mt-3">
      <view class="ai-comparison__title">
        结构化对比
      </view>
      <scroll-view scroll-x class="ai-comparison__scroll mt-2" :show-scrollbar="false">
        <view class="ai-comparison__grid" :style="{ width: gridWidth }">
          <view class="ai-comparison__row ai-comparison__row--head">
            <text class="ai-comparison__label">
              对比项
            </text>
            <text
              v-for="product in comparison.products"
              :key="`head-${product.id}`"
              class="ai-comparison__cell ai-comparison__cell--head"
            >
              {{ product.name }}
            </text>
          </view>
          <view
            v-for="dimension in comparison.dimensions"
            :key="dimension.key"
            class="ai-comparison__row"
          >
            <text class="ai-comparison__label">
              {{ dimension.label }}
            </text>
            <text
              v-for="cell in dimension.cells"
              :key="`${dimension.key}-${cell.productId}`"
              class="ai-comparison__cell"
              :class="cell.insufficient ? 'ai-comparison__cell--missing' : ''"
            >
              {{ cell.display }}
            </text>
          </view>
        </view>
      </scroll-view>
      <view
        v-if="comparison.missingNotes.length"
        class="app-tertiary mt-2 text-2.5 leading-4.5"
      >
        {{ comparison.missingNotes.join('；') }}
      </view>
    </view>

    <view class="ai-comparison__section mt-3">
      <view class="ai-comparison__title">
        热工结果
      </view>
      <view v-if="comparison.showThermal" class="mt-2 space-y-1.5">
        <view v-if="comparison.thermalConclusion" class="text-3 leading-5">
          {{ comparison.thermalConclusion }}
        </view>
        <view
          v-for="(row, index) in comparison.thermalCoreRows"
          :key="`core-${row.label}-${index}`"
          class="ai-comparison__thermal flex items-start justify-between gap-3"
        >
          <text class="app-muted min-w-0 flex-1 text-2.5 leading-4.5">
            {{ row.label }}
          </text>
          <text class="shrink-0 text-2.5 leading-4.5">
            {{ row.value }}
          </text>
        </view>
        <view
          v-if="comparison.thermalDetailRows.length && !thermalExpanded"
          class="app-primary-text mt-1 text-2.5"
          @click="thermalExpanded = true"
        >
          查看详细说明
        </view>
        <view v-else-if="thermalExpanded" class="space-y-1.5">
          <view
            v-for="(row, index) in comparison.thermalDetailRows"
            :key="`detail-${row.label}-${index}`"
            class="ai-comparison__thermal flex items-start justify-between gap-3"
          >
            <text class="app-muted min-w-0 flex-1 text-2.5 leading-4.5">
              {{ row.label }}
            </text>
            <text class="shrink-0 text-2.5 leading-4.5">
              {{ row.value }}
            </text>
          </view>
        </view>
      </view>
      <view v-else class="app-tertiary mt-2 text-2.5 leading-4.5">
        {{ comparison.thermalNote }}
      </view>
    </view>

    <view v-if="summaryHtml || explanation" class="ai-comparison__section mt-3">
      <view class="ai-comparison__title">
        AI说明
      </view>
      <view class="mt-2">
        <mp-html
          v-if="summaryHtml"
          :content="summaryHtml"
          :tag-style="markdownTagStyle"
          scroll-table
          preview-img
          container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word; word-break: break-word;"
        />
        <text v-else class="block text-3.5 leading-5.5">
          {{ explanation }}
        </text>
        <view
          v-if="explanationLayers.collapsible && !explanationExpanded"
          class="app-primary-text mt-1.5 text-2.5"
          @click="explanationExpanded = true"
        >
          查看详细说明
        </view>
        <mp-html
          v-else-if="explanationExpanded && detailsHtml"
          class="mt-2"
          :content="detailsHtml"
          :tag-style="markdownTagStyle"
          scroll-table
          preview-img
          container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word; word-break: break-word;"
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-comparison__title {
  position: relative;
  padding-bottom: 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--app-text-tertiary);
  letter-spacing: 0.08em;
}

.ai-comparison__title::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  content: '';
  background: var(--app-border-default);
}

.ai-comparison__scroll {
  width: 100%;
}

.ai-comparison__grid {
  min-width: 100%;
  border: 1px solid var(--app-border-default);
  border-radius: 16rpx;
  overflow: hidden;
  background: var(--app-bg-surface);
}

.ai-comparison__row {
  display: flex;
  border-top: 1px solid var(--app-border-default);
}

.ai-comparison__row--head {
  border-top: 0;
  background: var(--app-bg-drawer);
}

.ai-comparison__label,
.ai-comparison__cell {
  box-sizing: border-box;
  padding: 16rpx 12rpx;
  font-size: 24rpx;
  line-height: 1.45;
  word-break: break-word;
}

.ai-comparison__label {
  width: 160rpx;
  flex-shrink: 0;
  color: var(--app-text-secondary);
  background: var(--app-bg-drawer);
}

.ai-comparison__cell {
  width: 200rpx;
  flex-shrink: 0;
  color: var(--app-text-primary);
}

.ai-comparison__cell--head {
  font-weight: 600;
}

.ai-comparison__cell--missing {
  color: var(--app-text-tertiary);
}

.ai-comparison__thermal {
  background: var(--app-bg-drawer);
}
</style>
