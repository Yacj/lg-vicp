<script setup lang="ts">
export type HomeEntryKey = 'projects' | 'create' | 'public' | 'library'

interface HomeEntry {
  key: HomeEntryKey
  label: string
  description: string
  icon: string
  tone: 'primary' | 'energy' | 'ai' | 'warning'
}

const props = defineProps<{
  /** 当前账号明确无创建权限时隐藏「新建项目」入口 */
  hideCreate?: boolean
}>()

const emit = defineEmits<{
  select: [key: HomeEntryKey]
}>()

const baseEntries: HomeEntry[] = [
  { key: 'projects', label: '我的项目', description: '查看与跟进项目', icon: 'folder', tone: 'primary' },
  { key: 'create', label: '新建项目', description: '创建节能项目', icon: 'plus', tone: 'energy' },
  { key: 'public', label: '公开案例', description: '浏览优秀实践', icon: 'public', tone: 'ai' },
  { key: 'library', label: '公开文库', description: '查阅公开资料', icon: 'book', tone: 'warning' },
]

const entries = computed(() =>
  props.hideCreate ? baseEntries.filter(entry => entry.key !== 'create') : baseEntries,
)

// 仅剩 3 个入口时切换为一行三列的紧凑模式（图标 + 标题，去掉描述）
const isCompact = computed(() => entries.value.length === 3)
</script>

<template>
  <view class="home-tools grid" :class="isCompact ? 'grid-cols-3' : 'grid-cols-2'">
    <view
      v-for="entry in entries"
      :key="entry.key"
      class="home-tool app-pressable flex"
      :class="isCompact ? 'home-tool--compact flex-col items-center gap-2' : 'items-center gap-2.5'"
      @click="emit('select', entry.key)"
    >
      <view class="home-tool__icon app-tone flex shrink-0 items-center justify-center" :class="`is-${entry.tone}`">
        <wd-icon :name="entry.icon" size="34rpx" />
      </view>
      <view class="min-w-0" :class="isCompact ? '' : 'flex-1'">
        <view class="truncate text-3 font-semibold" :class="isCompact ? 'text-center' : ''">
          {{ entry.label }}
        </view>
        <view v-if="!isCompact" class="app-tertiary mt-0.5 truncate text-2.5">
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

.home-tool--compact {
  padding: 24rpx 12rpx;
}

.home-tool__icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
}
</style>
