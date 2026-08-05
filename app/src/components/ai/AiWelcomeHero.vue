<script setup lang="ts">
defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  suggest: [value: string]
}>()

const suggestions = [
  { title: '梳理项目参数', description: '从建筑类型、地区和面积开始', icon: 'home' },
  { title: '匹配保温材料', description: '对比材料性能与适用场景', icon: 'folder' },
  { title: '查询节能规范', description: '定位条文并说明设计要点', icon: 'file' },
]
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
      告诉我项目背景，我会先梳理关键信息，再给出可复核的分析建议。
    </view>

    <view class="ai-suggestions mt-6 w-full text-left">
      <view
        v-for="suggestion in suggestions"
        :key="suggestion.title"
        class="ai-suggestion app-panel-flat app-pressable flex items-center gap-3 px-3 py-3"
        @click="emit('suggest', suggestion.title)"
      >
        <view class="ai-suggestion__icon flex shrink-0 items-center justify-center rounded-xl">
          <wd-icon :name="suggestion.icon" size="36rpx" color="var(--app-action-primary)" />
        </view>
        <view class="min-w-0 flex-1">
          <view class="text-3 font-medium">
            {{ suggestion.title }}
          </view>
          <view class="app-tertiary mt-0.5 text-2.5">
            {{ suggestion.description }}
          </view>
        </view>
        <wd-icon name="arrow-right" size="28rpx" color="var(--app-text-tertiary)" />
      </view>
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

.ai-suggestions {
  max-width: 680rpx;
}

.ai-suggestion {
  border-radius: 24rpx;
  background: var(--app-bg-elevated);
}

.ai-suggestion + .ai-suggestion {
  margin-top: 16rpx;
}

.ai-suggestion__icon {
  width: 68rpx;
  height: 68rpx;
  background: var(--app-action-primary-soft);
}

@media (max-height: 650px) {
  .ai-welcome {
    min-height: 480rpx;
  }
}
</style>
