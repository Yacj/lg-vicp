<script setup lang="ts">
export type HomeEntryKey = 'projects' | 'create' | 'public' | 'history'

interface HomeEntry {
  key: HomeEntryKey
  label: string
  description: string
  icon: string
  tone: 'primary' | 'energy' | 'ai' | 'warning'
}

const emit = defineEmits<{
  select: [key: HomeEntryKey]
}>()

const entries: HomeEntry[] = [
  { key: 'projects', label: '我的项目', description: '查看与跟进项目', icon: 'folder', tone: 'primary' },
  { key: 'create', label: '新建项目', description: '创建节能项目', icon: 'plus', tone: 'energy' },
  { key: 'public', label: '公开案例', description: '浏览优秀实践', icon: 'public', tone: 'ai' },
  { key: 'history', label: '对话记录', description: '继续最近会话', icon: 'history', tone: 'warning' },
]
</script>

<template>
  <view class="home-tools grid grid-cols-2">
    <view
      v-for="entry in entries"
      :key="entry.key"
      class="home-tool app-pressable flex items-center gap-2.5"
      @click="emit('select', entry.key)"
    >
      <view class="home-tool__icon flex shrink-0 items-center justify-center" :class="`is-${entry.tone}`">
        <wd-icon :name="entry.icon" size="34rpx" />
      </view>
      <view class="min-w-0 flex-1">
        <view class="truncate text-3 font-semibold">
          {{ entry.label }}
        </view>
        <view class="app-tertiary mt-0.5 truncate text-2.5">
          {{ entry.description }}
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.home-tools {
  overflow: hidden;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-surface);
}

.home-tool {
  min-height: 108rpx;
  padding: 22rpx 24rpx;
}


.home-tool__icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;

  &.is-primary {
    color: var(--app-action-primary);
    background: var(--app-action-primary-soft);
  }

  &.is-energy {
    color: var(--app-energy);
    background: var(--app-energy-soft);
  }

  &.is-ai {
    color: var(--app-ai);
    background: var(--app-ai-soft);
  }

  &.is-warning {
    color: var(--app-warning);
    background: var(--app-warning-soft);
  }
}
</style>
