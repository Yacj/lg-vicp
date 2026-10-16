<script setup lang="ts">
import type { AiSourceDetail, AiSourceLocatorQuery, ApiEnvelope, DownloadUrlResult } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { fileApi } from '@/api/modules/files'
import ReferencePageImage from '@/components/ai/ReferencePageImage.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useReferencePageImage } from '@/composables/useReferencePageImage'
import { useReferencePageResource } from '@/composables/useReferencePageResource'
import { openOriginalFile } from '@/services/files/openOriginalFile'
import { useAssistantStore } from '@/store/assistant'
import { normalizeReferencePages, referencePageImageTitle } from '@/utils/referencePage'

definePage({
  name: 'knowledge-source',
  layout: 'default',
  style: { navigationStyle: 'custom' },
})

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const toast = useGlobalToast()
const assistant = useAssistantStore()
const locator = ref<AiSourceLocatorQuery>({})
const fallbackTitle = ref('')
const fallbackOriginalFileId = ref('')
const fallbackPhysicalPage = ref<number | null>(null)
const referenceMessageId = ref('')
const opening = ref(false)
const context = computed(() => normalizeReferencePages(assistant.messages.find(message => message.id === referenceMessageId.value)?.referencePages)
  .find(page => page.page.pageId === locator.value.pageId && (!locator.value.documentId || page.page.documentId === locator.value.documentId)))
const resource = useReferencePageResource(() => ({ locator: locator.value, context: context.value }), async (query) => {
  const response = await aiApi.getSourceDetail(query).send(true) as ApiEnvelope<AiSourceDetail>
  return response.data
})
const { detail, status, errorMessage, pageImageUrl, imageRevision, refreshingImage } = resource
const image = useReferencePageImage()
const { source: imageSource, status: imageStatus } = image
const pageTitle = computed(() => referencePageImageTitle(
  detail.value?.page?.renderModel?.pageTitle
  || detail.value?.location.pageTitle
  || detail.value?.page?.pageTitle
  || context.value?.renderModel?.pageTitle
  || fallbackTitle.value
  || detail.value?.document.title
  || '参考页',
))
const originalFileId = computed(() => detail.value?.original.fileId || fallbackOriginalFileId.value || '')
const physicalPageNumber = computed(() => detail.value?.location.physicalPageNumber ?? detail.value?.page?.physicalPageNumber ?? fallbackPhysicalPage.value)
const canOpenFile = computed(() => Boolean(detail.value?.original.previewUrl || originalFileId.value))
watch(() => context.value?.renderModel?.confirmedRevision, (revision, previous) => {
  if (previous && revision !== previous) {
    resource.cancel()
    image.cancel()
    image.failed()
    errorMessage.value = '来源确认版本已变化，请返回对话重新查询'
    status.value = 'error'
  }
})

watch([pageImageUrl, imageRevision], async ([url]) => {
  if (await image.load(url, detail.value?.page?.id ? { pageId: detail.value.page.id, confirmedRevision: detail.value.page.renderModel?.confirmedRevision } : undefined) === 'error')
    void resource.recoverImage()
})

async function load() {
  if (!requireLogin({ showToast: false })) {
    errorMessage.value = '请登录后查看参考页'
    status.value = 'error'
    return
  }
  const current = locator.value
  if (!current.documentId && !current.sectionId && !current.pageId && !current.blockId && !current.chunkId) {
    errorMessage.value = originalFileId.value ? '' : '缺少来源定位信息，请返回对话重新打开参考页'
    status.value = originalFileId.value ? 'ready' : 'error'
    return
  }
  await resource.load()
}

async function handleOpenOriginal() {
  if (opening.value)
    return
  opening.value = true
  try {
    let url = ''
    if (originalFileId.value) {
      const response = await fileApi.getDownloadUrl(originalFileId.value).send(true) as ApiEnvelope<DownloadUrlResult>
      url = response.data?.url || ''
    }
    else {
      await resource.load()
      url = detail.value?.original.previewUrl || ''
    }
    if (!url)
      throw new Error('empty url')
    await openOriginalFile({ url, physicalPageNumber: physicalPageNumber.value })
  }
  catch {
    toast.error('打开原文失败，请稍后重试')
  }
  finally {
    opening.value = false
  }
}

function previewPageImage() {
  const url = imageSource.value
  if (!url)
    return
  uni.previewImage({ urls: [url], current: url, fail: handleImageError })
}

function handleImageError() {
  image.failed()
  void resource.recoverImage()
}

onLoad((options) => {
  const query = (options || {}) as Record<string, string | undefined>
  locator.value = { documentId: query.documentId, sectionId: query.sectionId, pageId: query.pageId, blockId: query.blockId, chunkId: query.chunkId }
  fallbackTitle.value = query.title || ''
  fallbackOriginalFileId.value = query.originalFileId || ''
  referenceMessageId.value = query.referenceMessageId || ''
  const page = Number(query.physicalPageNumber)
  fallbackPhysicalPage.value = Number.isFinite(page) && page > 0 ? page : null
  void load()
})
onUnload(() => {
  resource.cancel()
  image.cancel()
})
</script>

<template>
  <view class="app-page knowledge-source box-border flex flex-col">
    <wd-navbar title="参考页" left-arrow safe-area-inset-top custom-class="!bg-transparent" @click-left="goBack" />
    <scroll-view scroll-y class="knowledge-source__body min-h-0 flex-1">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-20">
        <wd-loading size="44rpx" color="var(--app-action-primary)" />
        <text class="app-muted mt-3 text-3">
          正在加载参考页
        </text>
      </view>
      <view v-else-if="status === 'error'" class="px-6 py-20">
        <wd-empty icon="no-result" tip="参考页加载失败">
          <template #bottom>
            <view class="flex flex-col items-center text-center">
              <text class="app-muted mt-2 text-2.5">
                {{ errorMessage || '请稍后重试' }}
              </text>
              <wd-button size="small" custom-class="mt-4!" @click="load">
                重新加载
              </wd-button>
              <wd-button v-if="canOpenFile" size="small" variant="plain" custom-class="mt-3!" :loading="opening" @click="handleOpenOriginal">
                打开原文件
              </wd-button>
            </view>
          </template>
        </wd-empty>
      </view>
      <view v-else class="knowledge-source__content">
        <view class="app-muted mb-3 text-3">
          印刷页码 {{ detail?.location.pageLabel || detail?.page?.pageLabel || context?.page.pageLabel || '待核' }} · 原始页面，未进行像素框选
        </view>
        <wd-button v-if="canOpenFile && imageStatus === 'ready'" size="small" variant="plain" custom-class="mb-3!" :loading="opening" @click="handleOpenOriginal">
          打开原文件
        </wd-button>
        <ReferencePageImage :title="pageTitle" :source="imageSource" :status="imageStatus" :refreshing="refreshingImage" :revision="imageRevision" @preview="previewPageImage" @retry="resource.recoverImage(true)" @image-error="handleImageError" @image-load="resource.imageLoaded">
          <template #fallback>
            <wd-button v-if="canOpenFile" size="small" variant="plain" :loading="opening" @click="handleOpenOriginal">
              打开原文件
            </wd-button>
          </template>
        </ReferencePageImage>
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

.knowledge-source__content {
  box-sizing: border-box;
  width: 100%;
  padding: var(--app-space-3) var(--app-page-padding) var(--app-space-8);
}
</style>
