<script setup lang="ts">
defineProps<{
  visible: boolean
}>()
</script>

<template>
  <view v-if="visible" class="ai-welcome flex flex-col items-center justify-center px-1 pb-6 pt-4 text-center">
    <view class="ai-hero-art mb-4 flex items-center justify-center" aria-label="蓝格智配">
      <view class="ai-hero-art__glow" />
      <image class="ai-hero-art__cover" src="/static/cover.png" mode="aspectFit" />
    </view>

    <view class="app-eyebrow mb-2">
      VICP 建筑节能 AI
    </view>
    <view class="text-6 font-bold leading-8">
      你好，我是筑小格
    </view>
    <view class="app-muted mt-2 max-w-680rpx text-3.5 leading-6">
      你可以直接输入项目、图集、标准、材料或建筑节能相关问题，也可以从输入框上方的快捷提问开始。
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-welcome {
  min-height: 620rpx;
}

.ai-hero-art {
  position: relative;
  width: 208rpx;
  height: 208rpx;
}

.ai-hero-art__glow {
  position: absolute;
  width: 176rpx;
  height: 176rpx;
  border-radius: 64rpx;
  background: var(--app-gradient-ai);
  opacity: 0.14;
  filter: blur(24rpx);
  transform: rotate(-8deg);
}

.ai-hero-art__cover {
  position: relative;
  width: 208rpx;
  height: 208rpx;
  filter: drop-shadow(0 16rpx 28rpx rgba(47, 107, 255, 0.16));
}

@media (max-height: 650px) {
  .ai-welcome {
    min-height: 480rpx;
  }
}
</style>
