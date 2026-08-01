<script setup lang="ts">
import type { EChartsOption } from '@/charts/echarts'
import { useDocumentVisibility, useEventListener } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'

const props = withDefaults(defineProps<{
  option: EChartsOption | null
  loading?: boolean
  error?: boolean
  errorTitle?: string
  errorDescription?: string
  emptyText?: string
  emptyDescription?: string
  height?: number | string
}>(), {
  loading: false,
  error: false,
  errorTitle: '数据加载失败',
  errorDescription: '请稍后重试',
  emptyText: '暂无趋势数据',
  emptyDescription: '',
  height: 300,
})

const emit = defineEmits<{
  retry: []
}>()

const chartRef = ref<InstanceType<typeof VChart> | null>(null)

const heightStyle = computed(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

const skeletonRows = [
  { height: '60%', width: '100%' },
  { height: '10px', width: '100%' },
  { height: '10px', width: '72%' },
  { height: '10px', width: '100%' },
]

function resizeChart(): void {
  chartRef.value?.resize()
}

// 页面重新显示后容器尺寸可能变化，主动重算
const pageVisibility = useDocumentVisibility()
watch(pageVisibility, (visible) => {
  if (visible === 'visible') {
    resizeChart()
  }
})

// 全屏切换后等待过渡完成再重算
useEventListener(document, 'fullscreenchange', () => {
  window.setTimeout(resizeChart, 120)
})

defineExpose({
  chart: chartRef,
  resize: resizeChart,
})
</script>

<template>
  <div class="app-chart" :style="heightStyle">
    <AppEmptyState
      v-if="!loading && !error && !option"
      :description="emptyDescription"
      :title="emptyText"
    />
    <AppErrorState
      v-else-if="!loading && error"
      :description="errorDescription"
      :title="errorTitle"
      @action="emit('retry')"
    />
    <div v-else class="app-chart__body">
      <VChart
        ref="chartRef"
        :autoresize="{ throttle: 100 }"
        class="app-chart__canvas"
        :option="option ?? undefined"
      />
      <div v-if="loading" class="app-chart__loading" aria-label="图表加载中">
        <t-skeleton animation="gradient" :row-col="skeletonRows" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-chart {
  position: relative;
  min-width: 0;
  width: 100%;
}

.app-chart__body {
  position: relative;
  width: 100%;
  height: 100%;
}

.app-chart__canvas {
  width: 100%;
  height: 100%;
}

.app-chart__loading {
  position: absolute;
  inset: 0;
  display: grid;
  padding: var(--td-size-4);
  background: var(--td-bg-color-container);
  place-content: center;
}

.app-chart :deep(.app-empty-state),
.app-chart :deep(.app-error-state) {
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}
</style>
