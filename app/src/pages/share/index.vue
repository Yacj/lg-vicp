<script setup lang="ts">
import type { ApiEnvelope, PublicShareResult, ShareMessageSnapshot } from '@/api/types'
import { shareApi } from '@/api/modules/shares'
import { markdownStyle, renderMarkdown } from '@/utils/markdown'

definePage({
  name: 'share',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const router = useRouter()

const token = ref('')
const loading = ref(true)
const failed = ref(false)
const share = ref<PublicShareResult | null>(null)
const shareMessages = computed(() => share.value?.payload.messages ?? [])

function resolveShareToken(options?: Record<string, any>): string {
  if (options?.token) {
    return String(options.token)
  }

  let token = ''

  // #ifdef H5
  const query = (location.hash || '').split('?')[1] || ''
  token = new URLSearchParams(query).get('token') || ''
  // #endif

  return token
}

async function loadShare() {
  loading.value = true
  failed.value = false
  share.value = null
  try {
    const response = await shareApi.getPublic(token.value).send() as ApiEnvelope<PublicShareResult>
    share.value = response.data
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

onLoad((options) => {
  token.value = resolveShareToken(options)
  loadShare()
})

function goBack() {
  if (getCurrentPages().length > 1) {
    router.back()
    return
  }
  router.replace({ name: 'index' })
}

function messageHtml(message: ShareMessageSnapshot) {
  return message.role === 'USER' ? '' : renderMarkdown(message.content)
}
</script>

<template>
  <view class="app-page share-page">
    <wd-navbar
      :title="share?.title || '分享'"
      left-arrow
      safe-area-inset-top
      custom-class="share-page__navbar"
      @click-left="goBack"
    />

    <view class="share-page__body">
      <view v-if="loading" class="share-page__state">
        <wd-loading size="44rpx" color="var(--app-action-primary)" />
      </view>

      <view v-else-if="failed" class="share-page__state">
        <wd-icon name="warning" size="88rpx" color="var(--app-text-disabled)" />
        <text class="share-page__state-text">
          分享链接不存在或已失效
        </text>
      </view>

      <template v-else-if="share">
        <view class="share-page__banner">
          <text class="share-page__banner-title">
            {{ share.title }}
          </text>
          <text class="share-page__banner-meta">
            {{ shareMessages.length }} 条对话消息
          </text>
        </view>

        <view class="share-page__messages space-y-5">
          <view
            v-for="message in shareMessages"
            :key="message.id"
            class="flex gap-2.5"
            :class="message.role === 'USER' ? 'justify-end' : 'items-start'"
          >
            <view v-if="message.role !== 'USER'" class="share-avatar flex shrink-0 items-center justify-center rounded-full">
              <image class="share-avatar__logo" src="/static/my-icons/logo.svg" mode="aspectFit" />
            </view>

            <view
              v-if="message.role === 'USER'"
              class="share-message__user inline-block max-w-[82%] rounded-3 px-3.5 py-3 text-3.5 leading-5"
            >
              <text class="whitespace-pre-wrap break-words">
                {{ message.content }}
              </text>
            </view>

            <view v-else class="share-message__assistant flex-1 px-3.5 py-3">
              <mp-html
                :content="messageHtml(message)"
                :extern-style="markdownStyle"
                container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word;"
              />
            </view>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.share-page {
  min-height: 100vh;
  background: var(--app-bg-canvas);
}

.share-page__navbar {
  background: var(--app-bg-surface);
}

.share-page__body {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 24rpx 32rpx 64rpx;
}

.share-page__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  min-height: 480rpx;
}

.share-page__state-text {
  font-size: 28rpx;
  color: var(--app-text-tertiary);
}

.share-page__banner {
  padding: 32rpx;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-default);
}

.share-page__banner-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--app-text-primary);
  word-break: break-all;
}

.share-page__banner-meta {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--app-text-tertiary);
}

.share-page__messages {
  padding-bottom: 24rpx;
}

.share-avatar {
  width: 56rpx;
  height: 56rpx;
  margin-top: 4rpx;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}

.share-avatar__logo {
  width: 38rpx;
  height: 38rpx;
}

.share-message__user {
  color: var(--app-text-inverse);
  background: var(--app-action-primary);
  border-bottom-right-radius: 8rpx;
}

.share-message__assistant {
  max-width: calc(100% - 72rpx);
  border-radius: 8rpx 28rpx 28rpx;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}
</style>
