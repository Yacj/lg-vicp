<script setup lang="ts">
import type { CreateShareResult } from '@/api/types'
import { shareApi } from '@/api/modules/shares'

const props = defineProps<{
  modelValue: boolean
  messageIds: string[]
  defaultTitle: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [share: CreateShareResult]
}>()

const { info: toastInfo } = useGlobalToast()
const { loading: showLoading, close: hideLoading } = useGlobalLoading()

const title = ref('')
const creating = ref(false)
const share = ref<CreateShareResult | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      title.value = props.defaultTitle
      share.value = null
      creating.value = false
    }
  },
)

async function create() {
  const content = title.value.trim()
  if (!content) {
    toastInfo('请输入分享标题')
    return
  }
  if (!props.messageIds.length) {
    return
  }

  creating.value = true
  showLoading('正在生成分享链接')
  try {
    const response = await shareApi
      .create({
        targetType: 'AI_MESSAGES',
        messageIds: props.messageIds,
        title: content,
      })
      .send() as ApiEnvelope<CreateShareResult>
    share.value = response.data
    emit('success', response.data)
    hideLoading()
    // #ifdef H5
    copyLink()
    // #endif
  }
  catch (error) {
    toastInfo(error instanceof Error ? error.message : '创建分享失败，请重试')
  }
  finally {
    creating.value = false
    hideLoading()
  }
}

function copyLink() {
  // #ifdef H5
  if (!share.value) {
    return
  }
  const url = `${location.origin}${location.pathname}#/pages/share/index?token=${share.value.share.token}`
  uni.setClipboardData({
    data: url,
    success: () => toastInfo('链接已复制'),
  })
  // #endif
}

function close() {
  visible.value = false
}
</script>

<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="2000"
    :close-on-click-modal="false"
    custom-class="ai-share-panel"
    @close="close"
  >
    <view class="ai-share-panel__body">
      <view class="ai-share-panel__header">
        <text class="ai-share-panel__title">
          分享对话
        </text>
        <view class="ai-share-panel__close" @click="close">
          <wd-icon name="close" size="32rpx" color="var(--app-text-tertiary)" />
        </view>
      </view>

      <template v-if="!share">
        <view class="ai-share-panel__field">
          <text class="ai-share-panel__label">
            分享标题
          </text>
          <input
            v-model="title"
            class="ai-share-panel__input"
            :maxlength="160"
            placeholder="给这次分享起个标题"
            placeholder-class="ai-share-panel__placeholder"
          >
        </view>
        <text class="ai-share-panel__hint">
          已选择 {{ messageIds.length }} 条消息，分享后任何人可通过链接查看
        </text>
        <button class="ai-share-panel__primary" :disabled="creating" @click="create">
          {{ creating ? '生成中...' : '生成分享链接' }}
        </button>
      </template>

      <template v-else>
        <view class="ai-share-panel__card">
          <text class="ai-share-panel__card-title">
            {{ share.share.title }}
          </text>
          <text class="ai-share-panel__card-meta">
            {{ share.message }}
          </text>
        </view>

        <!-- #ifdef MP-WEIXIN -->
        <button class="ai-share-panel__primary" open-type="share">
          分享给微信好友
        </button>
        <!-- #endif -->

        <!-- #ifdef H5 -->
        <button class="ai-share-panel__primary" @click="copyLink">
          复制链接
        </button>
        <!-- #endif -->
      </template>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
:deep(.ai-share-panel) {
  border-radius: 32rpx 32rpx 0 0;
  overflow: hidden;
  background: var(--app-bg-surface);
}

.ai-share-panel__body {
  padding: 32rpx 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.ai-share-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28rpx;
}

.ai-share-panel__title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text-primary);
}

.ai-share-panel__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
}

.ai-share-panel__field {
  padding: 24rpx;
  border-radius: 20rpx;
  background: var(--app-bg-drawer);
  border: 1px solid var(--app-border-default);
}

.ai-share-panel__label {
  display: block;
  margin-bottom: 16rpx;
  font-size: 24rpx;
  color: var(--app-text-tertiary);
}

.ai-share-panel__input {
  width: 100%;
  font-size: 28rpx;
  color: var(--app-text-primary);
}

.ai-share-panel__placeholder {
  color: var(--app-text-disabled);
}

.ai-share-panel__hint {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--app-text-tertiary);
}

.ai-share-panel__card {
  padding: 28rpx 24rpx;
  border-radius: 20rpx;
  background: var(--app-bg-drawer);
  border: 1px solid var(--app-border-default);
}

.ai-share-panel__card-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text-primary);
  word-break: break-all;
}

.ai-share-panel__card-meta {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--app-text-tertiary);
}

.ai-share-panel__primary {
  width: 100%;
  margin-top: 28rpx;
  padding: 0;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 88rpx;
  color: var(--app-text-inverse);
  text-align: center;
  border: none;
  border-radius: 999rpx;
  background: var(--app-action-primary);
}

.ai-share-panel__primary::after {
  border: none;
}

.ai-share-panel__primary[disabled] {
  opacity: 0.6;
}
</style>
