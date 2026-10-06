<script setup lang="ts">
defineProps<{
  currentMessage?: string | null
}>()
</script>

<template>
  <view v-if="currentMessage" class="ai-agent-status">
    <view class="app-muted mt-1 flex items-center gap-1.5 text-2.5">
      <view class="ai-streaming-dot" />
      <text>{{ currentMessage }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-streaming-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--app-ai);
  animation: ai-streaming-pulse 1.1s ease-in-out infinite;
}

@keyframes ai-streaming-pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
