<script setup lang="ts">
const props = defineProps<{
  selectedCount: number
  allSelected: boolean
}>()

const emit = defineEmits<{
  toggleAll: []
  cancel: []
  confirm: []
}>()

function handleConfirm() {
  if (props.selectedCount > 0) {
    emit('confirm')
  }
}
</script>

<template>
  <view class="ai-share-bar">
    <view class="ai-share-bar__left" @click="emit('toggleAll')">
      <view class="ai-share-bar__check" :class="{ 'ai-share-bar__check--on': allSelected }">
        <wd-icon v-if="allSelected" name="check" size="24rpx" color="var(--app-text-inverse)" />
      </view>
      <text class="ai-share-bar__all">
        {{ allSelected ? '取消全选' : '全选' }}
      </text>
      <text class="ai-share-bar__count">
        已选 {{ selectedCount }} 条
      </text>
    </view>

    <view class="ai-share-bar__right">
      <view class="ai-share-bar__cancel" @click="emit('cancel')">
        取消
      </view>
      <view
        class="ai-share-bar__confirm"
        :class="{ 'ai-share-bar__confirm--disabled': selectedCount === 0 }"
        @click="handleConfirm"
      >
        分享
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-share-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 16rpx 20rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx;
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow-card);
}

.ai-share-bar__left {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.ai-share-bar__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-border-default);
  background: var(--app-bg-surface);
  transition: border-color var(--app-transition-fast) ease, background var(--app-transition-fast) ease;
}

.ai-share-bar__check--on {
  border-color: var(--app-action-primary);
  background: var(--app-action-primary);
}

.ai-share-bar__all {
  font-size: 28rpx;
  color: var(--app-text-secondary);
  white-space: nowrap;
}

.ai-share-bar__count {
  font-size: 24rpx;
  color: var(--app-text-tertiary);
  white-space: nowrap;
}

.ai-share-bar__right {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex-shrink: 0;
}

.ai-share-bar__cancel {
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  color: var(--app-text-tertiary);
}

.ai-share-bar__confirm {
  padding: 16rpx 40rpx;
  font-size: 28rpx;
  font-weight: 500;
  color: var(--app-text-inverse);
  border-radius: 999rpx;
  background: var(--app-action-primary);
  transition: opacity var(--app-transition-fast) ease, transform var(--app-transition-fast) ease;
}

.ai-share-bar__confirm:active {
  opacity: 0.85;
  transform: scale(0.97);
}

.ai-share-bar__confirm--disabled {
  opacity: 0.4;
}
</style>
