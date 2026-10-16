<script setup lang="ts">
import type { ReferenceHighlight } from '@/api/reference-page'
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import ThermalPageTable from '@/components/ai/ThermalPageTable.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useReferencePageHighlight } from '@/composables/useReferencePageHighlight'
import { useAssistantStore } from '@/store/assistant'
import { knowledgeSourceLocation } from '@/utils/aiSource'
import { formatReferenceNumber, hasPageRenderModel, referencePageHeading } from '@/utils/referencePage'
import { resolveReferenceTablePage } from '@/utils/referenceTable'
import { constructionLabel } from '@/utils/thermalSourceLabels'

definePage({
  name: 'reference-table',
  layout: 'default',
  style: { navigationStyle: 'custom', disableScroll: true },
})

const router = useRouter()
const { goBack } = useBackNavigation('assistant')
const { requireLogin, isAuthenticated } = useAuthGate()
const assistant = useAssistantStore()
const instance = getCurrentInstance()
const query = ref<Record<string, string | undefined>>({})
const viewportHeight = ref(uni.getSystemInfoSync().windowHeight)
const viewportWidth = ref(uni.getSystemInfoSync().windowWidth)
const tableHeight = ref(0)
const page = computed(() => isAuthenticated.value ? resolveReferenceTablePage(assistant.messages, assistant.solutionSnapshot, query.value) : undefined)
const model = computed(() => hasPageRenderModel(page.value?.renderModel) ? page.value!.renderModel! : null)
const heading = computed(() => referencePageHeading(model.value))
const preferred = computed<ReferenceHighlight>(() => ({ constructionId: query.value.constructionId, optionId: query.value.optionId }))
const highlight = useReferencePageHighlight(() => ({ model: model.value, pageId: page.value?.page.pageId || '', matches: page.value?.matches || [], preferred: preferred.value, anchorPrefix: 'full-table' }), () => {})
const activeLabel = computed(() => {
  const construction = model.value?.constructions.find(item => item.constructionId === highlight.active.value?.constructionId)
  const option = construction?.options.find(item => item.optionId === highlight.active.value?.optionId)
  return construction ? `${constructionLabel(construction)}${option ? ` · ${formatReferenceNumber(option.thicknessMm)}mm` : ''}` : ''
})
let measurementRevision = 0
async function measureTable() {
  const revision = ++measurementRevision
  await nextTick()
  uni.createSelectorQuery().in(instance?.proxy).select('.reference-table__content').boundingClientRect((rect) => {
    if (revision === measurementRevision && rect && !Array.isArray(rect) && typeof rect.height === 'number')
      tableHeight.value = Math.max(1, rect.height)
  }).exec()
}
function openSource() {
  if (!page.value || !requireLogin())
    return
  router.push(knowledgeSourceLocation({ documentId: page.value.page.documentId, pageId: page.value.page.pageId, referenceMessageId: query.value.referenceMessageId, title: page.value.page.documentTitle, pageLabel: page.value.page.pageLabel, view: 'image' }))
}
onLoad((options) => {
  query.value = (options || {}) as Record<string, string | undefined>
  requireLogin({ showToast: false })
})
onReady(measureTable)
onResize((event) => {
  if (event.size?.windowHeight)
    viewportHeight.value = event.size.windowHeight
  if (event.size?.windowWidth)
    viewportWidth.value = event.size.windowWidth
  void measureTable()
})
watch(page, () => {
  highlight.enabled.value = query.value.highlight !== '0'
  void measureTable()
}, { flush: 'post' })
watch([activeLabel, highlight.enabled], measureTable, { flush: 'post' })
onUnload(() => {
  measurementRevision++
})
</script>

<template>
  <view class="app-page reference-table flex flex-col" :style="{ height: `${viewportHeight}px` }">
    <wd-navbar title="完整表格" left-arrow safe-area-inset-top @click-left="goBack" />
    <template v-if="model && model.constructions.length">
      <view class="reference-table__heading">
        <view v-if="heading.title" class="reference-table__title font-semibold">
          {{ heading.title }}
        </view>
        <view v-if="heading.subtitle" class="reference-table__subtitle app-muted mt-1">
          {{ heading.subtitle }}
        </view>
        <view class="reference-table__source flex items-center justify-between gap-2">
          <text class="reference-table__caption app-muted min-w-0">
            {{ page?.page.pageLabel ? `印刷页码 ${page.page.pageLabel}` : '印刷页码待核' }}
          </text>
          <wd-button size="small" variant="text" icon="share-external" @click="openSource">
            查看参考页
          </wd-button>
        </view>
        <view v-if="highlight.matches.value.length" class="flex flex-wrap items-center gap-2">
          <text v-if="activeLabel" class="reference-table__subtitle app-primary-text">
            {{ activeLabel }}
          </text>
          <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="text" @click="highlight.navigate(-1)">
            上一处
          </wd-button>
          <wd-button v-if="highlight.matches.value.length > 1" size="small" variant="text" @click="highlight.navigate(1)">
            下一处
          </wd-button>
          <wd-button size="small" variant="text" @click="highlight.toggle">
            {{ highlight.enabled.value ? '取消高亮' : '显示高亮' }}
          </wd-button>
        </view>
        <view class="reference-table__caption app-muted mt-1">
          左右滑动查看全部列，上下滑动查看全部行
        </view>
      </view>
      <view class="reference-table__content min-h-0 flex-1">
        <ThermalPageTable v-if="tableHeight" :key="viewportWidth" :constructions="model.constructions" :matches="highlight.matches.value" :highlight-enabled="highlight.enabled.value" :active="highlight.active.value" anchor-prefix="full-table" :viewport-height="tableHeight" />
      </view>
    </template>
    <view v-else class="flex flex-1 flex-col items-center justify-center px-6">
      <wd-empty icon="no-result" tip="表格暂不可用，请返回对话重新打开" />
      <wd-button size="small" custom-class="mt-4!" @click="goBack">
        返回
      </wd-button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.reference-table { min-height: 0; overflow: hidden; box-sizing: border-box; background: var(--app-bg-surface); padding-bottom: env(safe-area-inset-bottom); }
.reference-table__heading { flex-shrink: 0; padding: min(24rpx, 12px) min(24rpx, 12px) min(16rpx, 8px); border-bottom: 1px solid var(--app-border-default); --wot-button-height-small: min(64rpx, 32px); --wot-button-font-size-small: min(24rpx, 12px); --wot-button-padding-small: 0 min(8rpx, 4px); }
.reference-table__title { font-size: min(28rpx, 14px); line-height: 1.5; }
.reference-table__subtitle { font-size: min(24rpx, 12px); line-height: 1.5; }
.reference-table__caption { font-size: min(20rpx, 10px); line-height: 1.5; }
.reference-table__source { margin-top: min(16rpx, 8px); }
.reference-table__content { height: 0; overflow: hidden; }
</style>
