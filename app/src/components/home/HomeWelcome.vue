<script setup lang="ts">
const props = defineProps<{
  isAuthenticated: boolean
  displayName?: string
}>()

const emit = defineEmits<{
  login: []
}>()

const hour = new Date().getHours()
const timeGreeting = hour < 6
  ? '夜深了'
  : hour < 11
    ? '早上好'
    : hour < 14
      ? '中午好'
      : hour < 18
        ? '下午好'
        : '晚上好'

const title = computed(() => {
  if (!props.isAuthenticated) {
    return `${timeGreeting}，欢迎来到筑小格`
  }
  return props.displayName ? `${timeGreeting}，${props.displayName}` : timeGreeting
})

const subtitle = computed(() => props.isAuthenticated
  ? '欢迎使用筑小格 AI 建筑节能助手'
  : '登录后可同步项目与最近会话')
</script>

<template>
  <view class="home-welcome flex items-center justify-between gap-3">
    <view class="min-w-0 flex-1">
      <view class="home-welcome__title truncate font-bold">
        {{ title }}
      </view>
      <view class="app-muted mt-1 text-2.5">
        {{ subtitle }}
      </view>
    </view>

    <view
      v-if="!isAuthenticated"
      class="home-welcome__login app-pressable flex shrink-0 items-center gap-1"
      @click="emit('login')"
    >
      <text>登录</text>
      <wd-icon name="arrow-right" size="24rpx" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.home-welcome {
  min-height: 108rpx;
  padding-top: 16rpx;
}

.home-welcome__title {
  color: var(--app-text-primary);
  font-size: 34rpx;
  line-height: 48rpx;
}

.home-welcome__login {
  padding: 12rpx 4rpx 12rpx 20rpx;
  color: var(--app-action-primary);
  font-size: 26rpx;
  font-weight: 600;
}
</style>
