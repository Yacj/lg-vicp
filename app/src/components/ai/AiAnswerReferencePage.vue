<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import { computed, ref, watch } from 'vue'
import { formatReferenceNumber, hasPageRenderModel, referenceSolutions } from '@/utils/referencePage'
import ReferencePageViewer from './ReferencePageViewer.vue'

const props = defineProps<{ page: AiReferencePage, anchorPrefix: string }>()
const emit = defineEmits<{ open: [match?: ReferenceHighlight], openTable: [match: ReferenceHighlight | undefined, highlightEnabled: boolean] }>()
const hasTable = computed(() => hasPageRenderModel(props.page.renderModel) && props.page.renderModel.constructions.length > 0)
const solutions = computed(() => referenceSolutions(props.page).slice(0, 2))
const imageFailed = ref(false)
watch(() => props.page.page.imageUrl, () => {
  imageFailed.value = false
})
</script>

<template>
  <view class="answer-reference">
    <ReferencePageViewer v-if="hasTable" :page="page" inline :anchor-prefix="anchorPrefix" @open-source="emit('open', $event)" @open-table="(match, enabled) => emit('openTable', match, enabled)">
      <template #summary>
        <view class="my-3">
          <view v-for="solution in solutions" :key="solution.key" class="text-3 leading-6">
            <text class="font-semibold">
              {{ solution.title }}
            </text>：保温厚度 <text class="font-semibold">
              {{ formatReferenceNumber(solution.option.thicknessMm) }}mm
            </text>，传热系数 <text class="app-primary-text font-semibold">
              {{ formatReferenceNumber(solution.option.kValue, 3) }}
            </text> W/(m²·K)。
          </view>
        </view>
      </template>
    </ReferencePageViewer>
    <template v-else>
      <image v-if="page.page.imageUrl && !imageFailed" class="answer-reference__image" :src="page.page.imageUrl" mode="aspectFit" @click="emit('open')" @error="imageFailed = true" />
      <view class="app-muted mt-2 text-3">
        {{ imageFailed ? '原页暂未加载成功，请打开参考页重试。' : page.page.imageUrl ? '点击查看完整原页。' : '打开参考页查看完整原文。' }}
      </view>
    </template>
    <view class="answer-reference__citation">
      <view class="app-muted text-2.5 leading-5">
        来源：{{ page.page.documentTitle || '参考资料' }}{{ page.page.pageLabel ? ` · 第${page.page.pageLabel}页` : '' }}
      </view>
      <view v-if="page.page.docNumber" class="app-muted text-2.5 leading-5">
        图集号：{{ page.page.docNumber }}
      </view>
      <wd-button v-if="!hasTable" size="small" variant="text" @click="emit('open')">
        查看参考页
      </wd-button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.answer-reference { min-width: 0; margin: var(--app-space-3) 0; }
.answer-reference__image { width: 100%; height: 600rpx; background: var(--app-bg-canvas); }
.answer-reference__citation { margin-top: var(--app-space-2); padding: var(--app-space-2) var(--app-space-3); border-left: 2px solid var(--app-border-strong); background: var(--app-bg-canvas); }
</style>
