<script setup lang="ts">
import type { ClientQuickPrompt } from '@/api/types'
import { resolveQuickPromptIcon } from '@/constants/aiQuickPrompt'

const props = defineProps<{
  prompts?: ClientQuickPrompt[]
  loading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  suggest: [content: string]
}>()

let sending = false

function handleSuggest(content: string) {
  if (props.disabled || !content.trim() || sending) {
    return
  }
  sending = true
  emit('suggest', content)
  setTimeout(() => {
    sending = false
  }, 800)
}
</script>

<template>
  <view v-if="loading || prompts?.length" class="ai-quick-prompt-rail-wrap">
    <scroll-view
      scroll-x
      :show-scrollbar="false"
      enable-flex
      class="ai-quick-prompt-rail"
    >
      <view v-if="loading" class="ai-quick-prompt-rail__row">
        <view v-for="index in 4" :key="index" class="ai-quick-prompt-chip is-skeleton">
          <wd-skeleton animation="gradient" :row-col="[{ width: '120rpx', height: '28rpx' }]" />
        </view>
      </view>
      <view v-else class="ai-quick-prompt-rail__row">
        <view
          v-for="prompt in prompts"
          :key="prompt.id"
          class="ai-quick-prompt-chip app-pressable"
          :class="disabled ? 'is-disabled' : ''"
          @click="handleSuggest(prompt.content)"
        >
          <wd-icon :name="resolveQuickPromptIcon(prompt.icon)" size="28rpx" color="var(--app-action-primary)" />
          <text class="ai-quick-prompt-chip__title">
            {{ prompt.title }}
          </text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ai-quick-prompt-rail-wrap {
  position: relative;
  margin-bottom: 16rpx;
}

.ai-quick-prompt-rail-wrap::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 56rpx;
  pointer-events: none;
  content: '';
  background: linear-gradient(90deg, transparent, var(--app-bg-surface));
}

.ai-quick-prompt-rail {
  width: 100%;
  height: 80rpx;
  white-space: nowrap;
}

.ai-quick-prompt-rail__row {
  display: inline-flex;
  gap: 12rpx;
  padding: 4rpx 40rpx 4rpx 0;
}

.ai-quick-prompt-chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8rpx;
  max-width: 320rpx;
  padding: 12rpx 20rpx;
  border: 1rpx solid var(--app-border-default);
  border-radius: 999rpx;
  background: var(--app-bg-elevated);
}

.ai-quick-prompt-chip__title {
  overflow: hidden;
  font-size: 24rpx;
  line-height: 36rpx;
  color: var(--app-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-quick-prompt-chip.is-skeleton {
  min-width: 168rpx;
  padding: 16rpx 20rpx;
}

.ai-quick-prompt-chip.is-disabled {
  pointer-events: none;
  opacity: 0.5;
}
</style>
