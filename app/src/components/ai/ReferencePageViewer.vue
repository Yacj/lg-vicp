<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import { computed, watch } from 'vue'
import { useReferencePageHighlight } from '@/composables/useReferencePageHighlight'
import { readableReferenceAnnotations } from '@/utils/referenceAnnotations'
import { formatReferenceNumber, hasPageRenderModel, referencePageHeading } from '@/utils/referencePage'
import { constructionLabel, thermalColumnHeader, thermalGroupHeader } from '@/utils/thermalSourceLabels'
import ThermalPageTable from './ThermalPageTable.vue'

const props = defineProps<{ page: AiReferencePage, preferred?: ReferenceHighlight, imageFailed?: boolean, imageRevision?: number, refreshingImage?: boolean, fallbackText?: string, inline?: boolean, anchorPrefix?: string, initialView?: '原始页面' | '页面内容' }>()
const emit = defineEmits<{ locate: [id: string], imageError: [], imageLoad: [], retryImage: [], previewImage: [], openSource: [match?: ReferenceHighlight], openTable: [match: ReferenceHighlight | undefined, highlightEnabled: boolean] }>()
const model = computed(() => hasPageRenderModel(props.page.renderModel) ? props.page.renderModel : null)
const heading = computed(() => referencePageHeading(model.value))
const paragraphs = computed(() => readableReferenceAnnotations(model.value?.paragraphs))
const notes = computed(() => readableReferenceAnnotations(model.value?.notes))
const warnings = computed(() => readableReferenceAnnotations(model.value?.warnings))
const highlight = useReferencePageHighlight(() => ({ model: model.value, pageId: props.page.page.pageId, matches: props.page.matches, preferred: props.preferred, anchorPrefix: props.anchorPrefix, initialView: props.initialView }), (id) => {
  if (!props.inline)
    emit('locate', id)
})
const activeLabel = computed(() => {
  const construction = model.value?.constructions.find(item => item.constructionId === highlight.active.value?.constructionId)
  const option = construction?.options.find(item => item.optionId === highlight.active.value?.optionId)
  return construction ? `${constructionLabel(construction)}${option ? ` · ${formatReferenceNumber(option.thicknessMm)}mm` : ''}` : ''
})
watch(model, (value, previous) => {
  if (!value)
    highlight.tab.value = '原始页面'
  else if (!previous)
    highlight.tab.value = props.initialView || '页面内容'
}, { immediate: true })
</script>

<template>
  <view class="reference-page-viewer">
    <view v-if="heading.title" class="reference-page-viewer__title">
      {{ heading.title }}
    </view>
    <view v-if="heading.subtitle" class="app-muted mt-1 text-3 leading-5">
      （{{ heading.subtitle }}）
    </view>
    <slot name="summary" />
    <wd-segmented v-if="!inline" v-model:value="highlight.tab.value" :options="['原始页面', '页面内容']" />
    <template v-if="highlight.tab.value === '页面内容' && model">
      <view v-if="!inline" class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <text class="app-muted text-2.5">
          {{ highlight.matches.value.length ? `匹配 ${highlight.matches.value.length} 处 · 当前 ${highlight.index.value + 1}/${highlight.matches.value.length}` : '当前未标注匹配档位' }}
        </text>
        <wd-button size="small" variant="text" @click="inline ? emit('openSource', highlight.active.value) : highlight.tab.value = '原始页面'">
          {{ inline ? '查看参考页' : '查看原始页面' }}
        </wd-button>
      </view>
      <view v-if="!inline && highlight.matches.value.length" class="mt-2 flex flex-wrap gap-2">
        <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="plain" @click="highlight.navigate(-1)">
          上一处
        </wd-button>
        <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="plain" @click="highlight.navigate(1)">
          下一处
        </wd-button>
        <wd-button size="small" variant="text" @click="highlight.toggle">
          {{ highlight.enabled.value ? '取消高亮' : '重新显示' }}
        </wd-button>
      </view>
      <view v-if="!inline && activeLabel" class="app-primary-text mt-2 text-3 font-semibold">
        当前引用：{{ activeLabel }}
      </view>
      <view v-if="page.matches.some(match => match.optionId || match.constructionId) && !highlight.matches.value.length" class="app-muted mt-3 text-3">
        引用档位暂无法定位，请查看原始页面核对。
      </view>
      <view v-for="(paragraph, index) in paragraphs" :key="`paragraph-${index}`" class="mt-3 text-3 leading-5">
        {{ paragraph }}
      </view>
      <view v-if="!inline" class="app-muted my-3 text-2.5">
        完整表格可左右滑动。构造简图请查看原始页面。
      </view>
      <view class="reference-page-viewer__table">
        <view class="reference-page-viewer__actions">
          <text class="app-muted min-w-0 flex-1 text-3">
            {{ model.schemaVersion === 2 ? `完整热工表 · 全部档位（${model.constructions.reduce((count, construction) => count + construction.options.length, 0)} 行）` : '热工参数表' }}
          </text>
          <wd-button v-if="inline" size="small" type="info" variant="text" icon="share-external" @click="emit('openSource', highlight.active.value)">
            查看参考页
          </wd-button>
          <wd-button size="small" type="info" variant="text" icon="fullscreen" @click="emit('openTable', highlight.active.value, highlight.enabled.value)">
            全屏看表格
          </wd-button>
        </view>
        <ThermalPageTable :constructions="model.constructions" :matches="highlight.matches.value" :highlight-enabled="highlight.enabled.value" :active="highlight.active.value" :anchor-prefix="anchorPrefix" />
      </view>
      <template v-for="construction in model.constructions" :key="construction.constructionId">
        <view v-if="construction.sourceColumns?.length" class="app-muted mt-3 text-3 leading-5">
          {{ constructionLabel(construction) }} · 来源栏目：{{ thermalGroupHeader([construction]) }} / {{ thermalColumnHeader([construction], 'totalThermalResistance').label }}（{{ thermalColumnHeader([construction], 'totalThermalResistance').unit }}）。来源名称按原稿保留。
        </view>
        <view v-for="(note, index) in readableReferenceAnnotations(construction.notes)" :key="index" class="app-muted mt-3 text-3 leading-5">
          {{ constructionLabel(construction) }}：{{ note }}
        </view>
      </template>
      <view v-for="(note, index) in notes" :key="`note-${index}`" class="app-muted mt-3 text-3 leading-5">
        {{ note }}
      </view>
      <view v-for="(warning, index) in warnings" :key="`warning-${index}`" class="app-muted mt-3 text-3 leading-5">
        {{ warning }}
      </view>
    </template>
    <template v-else-if="highlight.tab.value === '页面内容'">
      <view class="app-muted mt-4 text-3">
        此来源暂未提供可阅读的参数表。
      </view>
      <wd-button size="small" variant="plain" custom-class="mt-3!" @click="highlight.tab.value = '原始页面'">
        查看原始页面
      </wd-button>
      <view v-if="fallbackText" class="mt-4 text-3 leading-5">
        <text class="whitespace-pre-wrap break-words">
          {{ fallbackText }}
        </text>
      </view>
    </template>
    <template v-else>
      <view v-if="page.page.imageUrl && !imageFailed" class="mt-4">
        <image :key="imageRevision" class="reference-page-viewer__image" :src="page.page.imageUrl" mode="aspectFit" @click="emit('previewImage')" @error="emit('imageError')" @load="emit('imageLoad')" />
        <view class="app-muted mt-2 text-2.5">
          印刷页码 {{ page.page.pageLabel || '待核' }} · 完整原页包含构造简图，点击可全屏查看。缺少坐标证据时仅展示整页。
        </view>
        <wd-button size="small" variant="plain" custom-class="mt-3!" @click="emit('previewImage')">
          全屏查看
        </wd-button>
      </view>
      <view v-else class="app-muted mt-5 text-center text-3">
        {{ refreshingImage ? '正在重新加载原始页面…' : imageFailed ? '原始页面暂未加载成功' : '此来源暂无页面图片' }}<wd-button v-if="imageFailed" size="small" variant="plain" custom-class="mt-3!" :loading="refreshingImage" @click="emit('retryImage')">
          重新加载图片
        </wd-button>
      </view>
    </template>
  </view>
</template>

<style scoped lang="scss">
.reference-page-viewer { min-width: 0; }
.reference-page-viewer__title { font-size: var(--app-font-size-lg); line-height: var(--app-line-height-normal); font-weight: 600; }
.reference-page-viewer__table { margin-top: var(--app-space-3); overflow: hidden; border: 1px solid var(--app-border-default); border-radius: var(--app-radius-sm); background: var(--app-bg-surface); }
.reference-page-viewer__actions {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
  min-height: 80rpx;
  padding: 0 var(--app-space-2);
  border-bottom: 1px solid var(--app-border-default);
  background: var(--app-bg-canvas);
  --wot-button-height-small: 72rpx;
  --wot-button-font-size-small: 24rpx;
  --wot-button-padding-small: 0 8rpx;
  --wot-button-info-color: var(--app-text-secondary);
}
.reference-page-viewer__image { width: 100%; height: 900rpx; background: var(--app-bg-canvas); border: 1px solid var(--app-border-default); }
</style>
