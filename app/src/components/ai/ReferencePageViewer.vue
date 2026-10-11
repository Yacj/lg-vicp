<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import { computed, nextTick, ref, watch } from 'vue'
import { useReferencePageHighlight } from '@/composables/useReferencePageHighlight'
import { formatReferenceNumber, hasPageRenderModel, referencePageHeading } from '@/utils/referencePage'
import ThermalPageTable from './ThermalPageTable.vue'

const props = defineProps<{ page: AiReferencePage, preferred?: ReferenceHighlight, imageFailed?: boolean, imageRevision?: number, refreshingImage?: boolean, fallbackText?: string, inline?: boolean, anchorPrefix?: string, initialView?: '原始页面' | '页面内容' }>()
const emit = defineEmits<{ locate: [id: string], imageError: [], imageLoad: [], retryImage: [], previewImage: [], openSource: [match?: ReferenceHighlight] }>()
const model = computed(() => hasPageRenderModel(props.page.renderModel) ? props.page.renderModel : null)
const heading = computed(() => referencePageHeading(model.value))
const tableFullscreen = ref(false)
const fullscreenTarget = ref('')
const highlight = useReferencePageHighlight(() => ({ model: model.value, pageId: props.page.page.pageId, matches: props.page.matches, preferred: props.preferred, anchorPrefix: props.anchorPrefix, initialView: props.initialView }), (id) => {
  if (tableFullscreen.value)
    fullscreenTarget.value = id
  else if (!props.inline)
    emit('locate', id)
})
const activeLabel = computed(() => {
  const construction = model.value?.constructions.find(item => item.constructionId === highlight.active.value?.constructionId)
  const option = construction?.options.find(item => item.optionId === highlight.active.value?.optionId)
  return construction ? `${construction.constructionCode || construction.title || '参考构造'}${option ? ` · ${formatReferenceNumber(option.thicknessMm)}mm` : ''}` : ''
})
async function toggleTableFullscreen() {
  tableFullscreen.value = !tableFullscreen.value
  fullscreenTarget.value = ''
  await nextTick()
  const active = highlight.active.value
  const constructionIndex = model.value?.constructions.findIndex(construction => construction.constructionId === active?.constructionId) ?? -1
  if (constructionIndex < 0)
    return
  const optionIndex = model.value!.constructions[constructionIndex]!.options.findIndex(option => option.optionId === active?.optionId)
  const target = highlight.anchor(constructionIndex, optionIndex >= 0 ? optionIndex : undefined)
  if (tableFullscreen.value)
    fullscreenTarget.value = target
  else emit('locate', target)
}
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
      <view v-for="(paragraph, index) in model.paragraphs" :key="`paragraph-${index}`" class="mt-3 text-3 leading-5">
        {{ paragraph }}
      </view>
      <view v-if="!inline" class="app-muted my-3 text-2.5">
        完整表格可左右滑动。构造简图请查看原始页面。
      </view>
      <view v-if="inline" class="reference-page-viewer__actions">
        <view class="min-w-0 flex-1">
          <wd-button block size="small" type="primary" variant="plain" :round="false" @click="emit('openSource', highlight.active.value)">
            查看参考页
          </wd-button>
        </view>
        <view class="min-w-0 flex-1">
          <wd-button block size="small" type="primary" variant="base" :round="false" @click="toggleTableFullscreen">
            全屏看表格
          </wd-button>
        </view>
      </view>
      <wd-button v-else size="small" variant="plain" custom-class="mb-3!" @click="toggleTableFullscreen">
        全屏看表格
      </wd-button>
      <ThermalPageTable v-if="!tableFullscreen" :constructions="model.constructions" :matches="highlight.matches.value" :highlight-enabled="highlight.enabled.value" :active="highlight.active.value" :anchor-prefix="anchorPrefix" />
      <view v-else class="reference-page-viewer__fullscreen">
        <view class="flex items-center justify-between gap-2 px-4 py-3">
          <text class="text-3.5 font-semibold">
            完整参考表格
          </text>
          <wd-button size="small" variant="text" @click="toggleTableFullscreen">
            关闭
          </wd-button>
        </view>
        <view v-if="!inline && activeLabel" class="app-primary-text px-4 pb-2 text-3 font-semibold">
          当前引用：{{ activeLabel }}
        </view>
        <view v-if="!inline" class="flex flex-wrap gap-2 px-4 pb-2">
          <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="plain" @click="highlight.navigate(-1)">
            上一处
          </wd-button>
          <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="plain" @click="highlight.navigate(1)">
            下一处
          </wd-button>
          <wd-button v-if="highlight.matches.value.length" size="small" variant="text" @click="highlight.toggle">
            {{ highlight.enabled.value ? '取消高亮' : '重新显示' }}
          </wd-button>
        </view>
        <view class="app-muted px-4 pb-3 text-2.5">
          左右滑动查看全部列。
        </view>
        <scroll-view scroll-y :scroll-into-view="fullscreenTarget" scroll-with-animation class="min-h-0 flex-1">
          <ThermalPageTable :constructions="model.constructions" :matches="highlight.matches.value" :highlight-enabled="highlight.enabled.value" :active="highlight.active.value" :anchor-prefix="anchorPrefix" />
        </scroll-view>
      </view>
      <template v-for="construction in model.constructions" :key="construction.constructionId">
        <view v-for="(note, index) in construction.notes" :key="index" class="app-muted mt-3 text-3 leading-5">
          {{ construction.constructionCode || construction.title }}：{{ note }}
        </view>
      </template>
      <view v-for="(note, index) in model.notes" :key="`note-${index}`" class="app-muted mt-3 text-3 leading-5">
        {{ note }}
      </view>
      <view v-if="model.warnings?.length" class="app-muted mt-3 text-3 leading-5">
        识别参数可能存在异常，请以原始页面为准。
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
          完整原页包含构造简图，点击可全屏查看。
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
.reference-page-viewer__actions { display: flex; gap: var(--app-space-2); margin: var(--app-space-3) 0; --wot-button-height-small: 72rpx; --wot-button-radius-main: var(--app-radius-sm); --wot-button-primary-bg: var(--app-action-primary); --wot-button-primary-plain-border: var(--app-action-primary); --wot-button-primary-color: var(--app-action-primary); }
.reference-page-viewer__image { width: 100%; height: 900rpx; background: var(--app-bg-canvas); border: 1px solid var(--app-border-default); }
.reference-page-viewer__fullscreen { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; background: var(--app-bg-surface); padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
</style>
