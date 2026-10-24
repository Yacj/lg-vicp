<script setup lang="ts">
import type { ProcessingStep } from '@/utils/aiProcessing'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { processingNarrative, processingSeconds, processingTitle } from '@/utils/aiProcessing'

const props = withDefaults(defineProps<{
  currentMessage?: string | null
  steps?: ProcessingStep[]
  active?: boolean
  startedAt?: number
  finishedAt?: number
  status?: string
}>(), { steps: () => [], active: true })

const expanded = ref(props.active)
watch(() => props.active, (active) => {
  expanded.value = active
})
const now = ref(Date.now())
let mounted = false
let timer: ReturnType<typeof setInterval> | undefined
function syncTimer() {
  if (timer)
    clearInterval(timer)
  timer = undefined
  now.value = Date.now()
  if (mounted && props.active)
    timer = setInterval(() => { now.value = Date.now() }, 1000)
}
watch(() => props.active, syncTimer)
onMounted(() => {
  mounted = true
  syncTimer()
})
onUnmounted(() => {
  mounted = false
  if (timer)
    clearInterval(timer)
})
const title = computed(() => processingTitle(props.active, processingSeconds({ processingStartedAt: props.startedAt, processingFinishedAt: props.finishedAt }, now.value), props.status))
const paragraphs = computed(() => processingNarrative(props.steps, props.active))
</script>

<template>
  <view v-if="currentMessage || steps.length" class="ai-agent-status">
    <view
      class="ai-agent-status__toggle"
      role="button"
      :aria-expanded="expanded"
      :aria-label="title"
      @click="expanded = !expanded"
    >
      <view v-if="active" class="ai-streaming-dot" />
      <text class="ai-agent-status__title">
        {{ title }}
      </text>
      <wd-icon v-if="steps.length" :name="expanded ? 'arrow-up' : 'arrow-down'" size="22rpx" />
    </view>
    <view v-if="expanded && paragraphs.length" class="ai-agent-status__summary">
      <view v-for="paragraph in paragraphs" :key="paragraph" class="ai-agent-status__paragraph">
        <text>{{ paragraph }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-agent-status {
  max-width: 100%;
}

.ai-agent-status__title {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ai-agent-status__toggle {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  min-height: 52rpx;
  max-width: 100%;
  color: var(--app-text-tertiary);
  font-size: 26rpx;
  line-height: 1.5;
}

.ai-agent-status__summary {
  margin: 12rpx 0 8rpx;
  padding: 0 0 0 24rpx;
  border-left: 3rpx solid var(--app-border-strong);
  color: var(--app-text-tertiary);
  font-size: 26rpx;
  line-height: 1.75;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ai-agent-status__paragraph + .ai-agent-status__paragraph {
  margin-top: 16rpx;
}

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
