<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import type { AiSourceDetail, AiSourceLocatorQuery, ApiEnvelope, DownloadUrlResult } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { fileApi } from '@/api/modules/files'
import ReferencePageViewer from '@/components/ai/ReferencePageViewer.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useReferencePageResource } from '@/composables/useReferencePageResource'
import { openOriginalFile } from '@/services/files/openOriginalFile'
import { useAssistantStore } from '@/store/assistant'
import { normalizeReferencePages, referencePageInitialView } from '@/utils/referencePage'

definePage({
  name: 'knowledge-source',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const toast = useGlobalToast()

const locator = ref<AiSourceLocatorQuery>({})
const fallbackTitle = ref('')
const fallbackPageLabel = ref('')
const fallbackOriginalFileId = ref('')
const fallbackPhysicalPage = ref<number | null>(null)

const assistant = useAssistantStore()
const referenceMessageId = ref('')
const preferred = ref<ReferenceHighlight>()
const initialView = ref<'原始页面' | '页面内容'>('页面内容')
const scrollTarget = ref('')
const context = computed(() => normalizeReferencePages(assistant.messages.find(message => message.id === referenceMessageId.value)?.referencePages)
  .find(page => page.page.pageId === locator.value.pageId && (!locator.value.documentId || page.page.documentId === locator.value.documentId)))
const resource = useReferencePageResource(() => ({ locator: locator.value, context: context.value }), async (query) => {
  const response = await aiApi.getSourceDetail(query).send(true) as ApiEnvelope<AiSourceDetail>
  return response.data
})
const { detail, status, pageImageUrl } = resource
const opening = ref(false)

const documentTitle = computed(() => detail.value?.document.title || fallbackTitle.value || '知识原文')
const pageLabel = computed(() => detail.value?.location.pageLabel || detail.value?.page?.pageLabel || fallbackPageLabel.value || '')
const chapterPath = computed(() => {
  const toc = detail.value?.toc.path
  if (toc?.length) {
    return toc.join(' · ')
  }
  const sectionPath = detail.value?.location.sectionPath
  if (sectionPath?.length) {
    return sectionPath.join(' · ')
  }
  return [detail.value?.location.chapter, detail.value?.location.section].filter(Boolean).join(' · ')
})
const extractedText = computed(() => detail.value?.page?.fullText || detail.value?.extracted.text || '')
const originalFileId = computed(() => detail.value?.original.fileId || fallbackOriginalFileId.value || '')
const physicalPageNumber = computed(() =>
  detail.value?.location.physicalPageNumber
  ?? detail.value?.page?.physicalPageNumber
  ?? fallbackPhysicalPage.value,
)
const canOpenFile = computed(() => Boolean(detail.value?.original.previewUrl || originalFileId.value))
const referencePage = computed<AiReferencePage>(() => ({
  type: 'REFERENCE_PAGE',
  page: {
    documentId: detail.value?.document.id || locator.value.documentId || '',
    pageId: detail.value?.page?.id || locator.value.pageId || '',
    documentTitle: documentTitle.value,
    docNumber: detail.value?.document.docNumber,
    pageLabel: pageLabel.value,
    imageUrl: pageImageUrl.value,
  },
  renderModel: context.value?.renderModel ?? detail.value?.page?.renderModel,
  matches: [
    ...(context.value?.matches || []),
    ...(detail.value?.page?.matches || []),
    ...(detail.value?.page?.referenceHighlight ? [detail.value.page.referenceHighlight] : []),
  ],
}))

function parseLocator(options: Record<string, string | undefined> = {}) {
  locator.value = {
    documentId: options.documentId,
    sectionId: options.sectionId,
    pageId: options.pageId,
    blockId: options.blockId,
    chunkId: options.chunkId,
  }
  fallbackTitle.value = options.title || ''
  fallbackPageLabel.value = options.pageLabel || ''
  fallbackOriginalFileId.value = options.originalFileId || ''
  referenceMessageId.value = options.referenceMessageId || ''
  initialView.value = referencePageInitialView(options.view)
  preferred.value = options.constructionId || options.optionId ? { constructionId: options.constructionId, optionId: options.optionId } : undefined
  const page = Number(options.physicalPageNumber)
  fallbackPhysicalPage.value = Number.isFinite(page) && page > 0 ? page : null
}

function hasLocator() {
  const current = locator.value
  return Boolean(current.documentId || current.sectionId || current.pageId || current.blockId || current.chunkId)
}

async function load() {
  if (!requireLogin({ showToast: false })) {
    status.value = 'error'
    return
  }
  if (!hasLocator()) {
    status.value = originalFileId.value ? 'ready' : 'error'
    return
  }

  await resource.load()
}

async function handleOpenOriginal() {
  if (opening.value) {
    return
  }
  opening.value = true
  try {
    const previewUrl = detail.value?.original.previewUrl
    const url = previewUrl || await resolveDownloadUrl()
    if (!url) {
      throw new Error('empty url')
    }
    await openOriginalFile({
      url,
      physicalPageNumber: physicalPageNumber.value,
    })
  }
  catch {
    toast.error('打开原文失败，请稍后重试')
  }
  finally {
    opening.value = false
  }
}

async function resolveDownloadUrl() {
  const fileId = originalFileId.value
  if (!fileId) {
    return ''
  }
  const response = await fileApi.getDownloadUrl(fileId).send() as ApiEnvelope<DownloadUrlResult>
  return response.data?.url || ''
}

function previewPageImage() {
  if (!pageImageUrl.value) {
    return
  }
  uni.previewImage({
    urls: [pageImageUrl.value],
    current: pageImageUrl.value,
    fail: () => { void resource.recoverImage() },
  })
}

async function locate(id: string) {
  scrollTarget.value = ''
  await nextTick()
  scrollTarget.value = id
}

onLoad((options) => {
  parseLocator((options || {}) as Record<string, string | undefined>)
  void load()
})
onUnload(resource.cancel)
</script>

<template>
  <view class="app-page knowledge-source box-border flex flex-col">
    <wd-navbar
      title="参考页"
      left-arrow
      safe-area-inset-top
      custom-class="!bg-transparent"
      @click-left="goBack"
    />

    <scroll-view scroll-y :scroll-into-view="scrollTarget" scroll-with-animation class="knowledge-source__body min-h-0 flex-1 px-4">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-20">
        <wd-loading size="44rpx" color="var(--app-action-primary)" />
        <text class="app-muted mt-3 text-3">
          正在加载参考页
        </text>
      </view>

      <view v-else-if="status === 'error'" class="flex flex-col items-center px-6 py-20 text-center">
        <wd-icon name="warning" size="64rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          参考页加载失败
        </text>
        <text class="app-muted mt-1 text-2.5">
          请检查网络后重试。若资料仍可打开，也可以直接查看原文件。
        </text>
        <wd-button size="small" custom-class="mt-4!" @click="load">
          重新加载
        </wd-button>
        <wd-button
          v-if="canOpenFile"
          size="small"
          plain
          custom-class="mt-3!"
          :loading="opening"
          @click="handleOpenOriginal"
        >
          打开原文件
        </wd-button>
      </view>

      <view v-else class="app-enter pb-8 pt-3">
        <view class="text-4 font-bold leading-7">
          {{ documentTitle }}
        </view>
        <view v-if="chapterPath" class="app-muted mt-2 text-3 leading-5">
          {{ chapterPath }}
        </view>
        <view v-if="pageLabel" class="app-primary-text mt-2 text-3.5 font-semibold">
          来源：第{{ pageLabel }}页
        </view>
        <view v-if="detail?.document.docNumber" class="app-muted mt-1 text-3">
          图集号：{{ detail.document.docNumber }}
        </view>

        <view
          v-if="canOpenFile"
          class="app-panel-flat app-pressable mt-4 flex items-center justify-between rounded-3 px-3 py-3"
          @click="handleOpenOriginal"
        >
          <view>
            <view class="text-3 font-medium">
              打开原文件
            </view>
            <view class="app-tertiary mt-0.5 text-2.5">
              {{ pageLabel ? `定位到 ${pageLabel}` : '查看知识库上传的正式原文' }}
            </view>
          </view>
          <wd-icon name="arrow-right" size="28rpx" color="var(--app-text-tertiary)" />
        </view>

        <ReferencePageViewer
          v-if="detail?.page || context" class="mt-4" :page="referencePage" :preferred="preferred" :initial-view="initialView" :fallback-text="extractedText" :image-failed="resource.imageFailed.value" :image-revision="resource.imageRevision.value" :refreshing-image="resource.refreshingImage.value"
          @locate="locate" @image-error="resource.recoverImage()" @image-load="resource.imageLoaded" @retry-image="resource.recoverImage(true)" @preview-image="previewPageImage"
        />
        <view v-else-if="extractedText" class="app-panel-flat mt-4 whitespace-pre-wrap rounded-3 p-4 text-3 leading-6">
          {{ extractedText }}
        </view>
        <view v-else-if="!canOpenFile" class="app-muted mt-10 text-center text-3">
          该资料还没有可阅读的页面内容
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.knowledge-source {
  height: var(--app-viewport-height, 100vh);
  min-height: 0;
  background: var(--app-bg-surface);
  padding-bottom: env(safe-area-inset-bottom);
}

.knowledge-source__body {
  height: 0;
}
</style>
