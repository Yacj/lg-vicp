<script setup lang="ts">
import { computed } from 'vue'

/**
 * 异步任务进度条。progress 以后端任务记录为准（0-100）。
 */
const props = withDefaults(defineProps<{
  progress?: number
  /** 显示进度百分比文本，默认开启。 */
  showLabel?: boolean
  size?: 'small' | 'medium' | 'large'
  theme?: 'line' | 'plump' | 'circle'
}>(), {
  progress: 0,
  showLabel: true,
  size: 'medium',
  theme: 'line',
})

const percentage = computed(() => Math.min(100, Math.max(0, Math.round(props.progress ?? 0))))
</script>

<template>
  <div class="app-task-progress">
    <t-progress
      v-if="theme === 'circle'"
      :percentage="percentage"
      :size="size"
      theme="circle"
    />
    <t-progress
      v-else
      :label="showLabel"
      :percentage="percentage"
      :size="size"
      :theme="theme"
      track-color="var(--td-bg-color-container-hover)"
    />
  </div>
</template>

<style scoped>
.app-task-progress {
  width: 100%;
}
</style>