<script setup lang="ts">
import type { SectionStatus } from '@/composables/useAsyncSection'

type SkeletonBlock = number | Record<string, string | number> | Array<Record<string, string | number>>

withDefaults(defineProps<{
  title: string
  status: SectionStatus
  empty?: boolean
  emptyIcon?: string
  emptyTip?: string
  moreLabel?: string
  skeletonRowCol?: SkeletonBlock[]
}>(), {
  empty: false,
  emptyIcon: 'empty',
  emptyTip: '暂无内容',
  moreLabel: '全部',
  skeletonRowCol: () => [{ width: '40%' }, 1, { width: '60%' }],
})

const emit = defineEmits<{
  more: []
  retry: []
}>()
</script>

<template>
  <view class="home-section">
    <view class="home-section__header flex items-center justify-between">
      <view class="app-section-title">
        {{ title }}
      </view>
      <view v-if="moreLabel" class="app-section-more flex items-center gap-0.5" @click="emit('more')">
        <text>{{ moreLabel }}</text>
        <wd-icon name="arrow-right" size="22rpx" />
      </view>
    </view>
    <view v-if="status === 'loading' || status === 'idle'" class="home-section__state px-4 pb-4 pt-2">
      <wd-skeleton :row-col="skeletonRowCol" animation="gradient" />
    </view>
    <wd-empty icon="no-content" tip="暂无内容"       v-else-if="status === 'error'"/>
    <view v-else-if="empty" class="home-section__state">
      <wd-empty :icon="emptyIcon" :tip="emptyTip" />
    </view>

    <slot v-else />
  </view>
</template>

<style lang="scss" scoped>
.home-section {
  overflow: hidden;

  border-radius: var(--app-radius-sm);
  background: var(--app-bg-surface);
}

.home-section__header {
  min-height: 82rpx;
  padding: 20rpx 28rpx 12rpx;
}

.home-section__state {
  background: var(--app-bg-surface);
}
</style>
