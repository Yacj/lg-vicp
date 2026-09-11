<script setup lang="ts">
import type { AiSourceDetail, AiSourceLocatorQuery, ApiEnvelope, DownloadUrlResult } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { fileApi } from '@/api/modules/files'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { openOriginalFile } from '@/services/files/openOriginalFile'

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

const detail = ref<AiSourceDetail | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('loading')
const opening = ref(false)
let requestSequence = 0

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
const pageImageUrl = computed(() => detail.value?.original.pageImageUrl || detail.value?.page?.pageImageUrl || '')
const extractedText = computed(() => detail.value?.page?.fullText || detail.value?.extracted.text || '')
const highlightText = computed(() => detail.value?.highlights[0]?.text || '')
const originalFileId = computed(() => detail.value?.original.fileId || fallbackOriginalFileId.value || '')
const physicalPageNumber = computed(() =>
  detail.value?.location.physicalPageNumber
  ?? detail.value?.page?.physicalPageNumber
  ?? fallbackPhysicalPage.value,
)
const canOpenFile = computed(() => Boolean(detail.value?.original.previewUrl || originalFileId.value))

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

  const sequence = ++requestSequence
  status.value = 'loading'
  try {
    const response = await aiApi.getSourceDetail(locator.value).send() as ApiEnvelope<AiSourceDetail>
    if (sequence !== requestSequence) {
      return
    }
    detail.value = response.data
    status.value = 'ready'
  }
  catch {
    if (sequence !== requestSequence) {
      return
    }
    status.value = 'error'
  }
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
  void openOriginalFile({ url: pageImageUrl.value })
}

onLoad((options) => {
  parseLocator((options || {}) as Record<string, string | undefined>)
  void load()
})
</script>

<template>
  <view class="app-page knowledge-source box-border flex flex-col">
    <wd-navbar
      title="查看原文"
      left-arrow
      safe-area-inset-top
      custom-class="!bg-transparent"
      @click-left="goBack"
    />

    <scroll-view scroll-y class="knowledge-source__body min-h-0 flex-1 px-4">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-20">
        <wd-loading size="44rpx" color="var(--app-action-primary)" />
        <text class="app-muted mt-3 text-3">
          正在加载原文
        </text>
      </view>

      <view v-else-if="status === 'error'" class="flex flex-col items-center px-6 py-20 text-center">
        <wd-icon name="warning" size="64rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          原文加载失败
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
          {{ pageLabel }}
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

        <image
          v-if="pageImageUrl"
          class="knowledge-source__image mt-4 w-full"
          :src="pageImageUrl"
          mode="widthFix"
          @click="previewPageImage"
        />

        <view v-if="highlightText" class="ai-quote app-panel-flat mt-4 rounded-3 px-3 py-3">
          <view class="app-tertiary text-2.5">
            引用摘要
          </view>
          <view class="mt-1 text-3 leading-5">
            “{{ highlightText }}”
          </view>
        </view>

        <view v-if="extractedText" class="mt-4 text-3.5 leading-6">
          <text class="whitespace-pre-wrap break-words">
            {{ extractedText }}
          </text>
        </view>

        <view v-else-if="!pageImageUrl && !canOpenFile" class="app-muted mt-10 text-center text-3">
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

.knowledge-source__image {
  border-radius: 24rpx;
  border: 1px solid var(--app-border-default);
  background: var(--app-bg-elevated);
}

.ai-quote {
  background: var(--app-bg-elevated);
}
</style>
