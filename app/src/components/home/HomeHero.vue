<script setup lang="ts">
const emit = defineEmits<{
  ask: []
}>()
</script>

<template>
  <view class="home-hero relative overflow-hidden">
    <view class="home-hero__dots" />

    <view class="home-hero__content relative z-1 py-4 pl-4">
      <view class="home-hero__eyebrow">
        VICP 建筑节能 AI
      </view>
      <view class="home-hero__title mt-1 font-bold">
        筑小格 AI 助手
      </view>
      <view class="home-hero__desc mt-1.5 text-2.5 leading-4.5">
        项目设计 · 材料对比 · 规范问答
      </view>
      <view
        class="home-hero__action app-pressable mt-3 inline-flex items-center gap-1.5"
        @click="emit('ask')"
      >
        <text>去问问筑小格</text>
        <wd-icon name="arrow-right" size="24rpx" />
      </view>
    </view>

    <image
      class="home-hero__figure"
      src="/static/cover.png"
      mode="aspectFit"
      aria-label="筑小格"
    />
  </view>
</template>

<style lang="scss" scoped>
.home-hero {
  min-height: 256rpx;
  border: 1px solid var(--app-on-brand-border);
  border-radius: 24rpx;
  background: var(--app-gradient-brand);
  box-shadow: var(--app-shadow-dock);
  color: var(--app-text-inverse);
}

.home-hero__content {
  width: 62%;
}

.home-hero__eyebrow {
  color: var(--app-on-brand-medium);
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.home-hero__title {
  color: var(--app-text-inverse);
  font-size: 36rpx;
  line-height: 50rpx;
}

.home-hero__desc {
  color: var(--app-on-brand-medium);
}

.home-hero__action {
  padding: 12rpx 20rpx;
  border: 1px solid var(--app-on-brand-border);
  border-radius: 999rpx;
  background: var(--app-on-brand-strong);
  color: var(--app-color-ocean-deep);
  font-size: 23rpx;
  font-weight: 600;
}

.home-hero__figure {
  position: absolute;
  right: -26rpx;
  bottom: -32rpx;
  width: 294rpx;
  height: 294rpx;
  pointer-events: none;
}

.home-hero__dots {
  position: absolute;
  right: 24rpx;
  bottom: 20rpx;
  width: 100rpx;
  height: 8rpx;
  border-radius: var(--app-radius-pill);
  background: var(--app-on-brand-surface-soft);
}
</style>
