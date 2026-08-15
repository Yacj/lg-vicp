<script setup lang="ts">
import { AI_FEEDBACK_TAGS } from '@/constants/aiFeedback'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': [payload: { tags: string[]; content: string }]
}>()

const selectedTags = ref<string[]>([])
const content = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      selectedTags.value = []
      content.value = ''
    }
  },
)

function toggleTag(tag: string) {
  const index = selectedTags.value.indexOf(tag)
  if (index >= 0) {
    selectedTags.value.splice(index, 1)
    return
  }
  selectedTags.value.push(tag)
}

function confirm() {
  emit('confirm', { tags: [...selectedTags.value], content: content.value.trim() })
  visible.value = false
}

function close() {
  visible.value = false
}
</script>

<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="2000"
    :close-on-click-modal="false"
    custom-class="ai-feedback-panel"
    @close="close"
  >
    <view class="ai-feedback-panel__body">
      <view class="ai-feedback-panel__header">
        <text class="ai-feedback-panel__title">
          哪里不满意
        </text>
        <view class="ai-feedback-panel__close" @click="close">
          <wd-icon name="close" size="32rpx" color="var(--app-text-tertiary)" />
        </view>
      </view>

      <text class="ai-feedback-panel__label">
        请选择反馈原因（选填）
      </text>
      <scroll-view scroll-x :show-scrollbar="false" class="ai-feedback-panel__tags">
        <view class="ai-feedback-panel__tag-row">
          <view
            v-for="tag in AI_FEEDBACK_TAGS"
            :key="tag"
            class="ai-feedback-panel__tag"
            :class="selectedTags.includes(tag) ? 'ai-feedback-panel__tag--active' : ''"
            @click="toggleTag(tag)"
          >
            <text>{{ tag }}</text>
          </view>
        </view>
      </scroll-view>

      <text class="ai-feedback-panel__label">
        补充说明（选填）
      </text>
      <view class="ai-feedback-panel__field">
        <textarea
          v-model="content"
          class="ai-feedback-panel__textarea"
          :maxlength="1000"
          placeholder="还有哪些地方需要改进？"
          placeholder-class="ai-feedback-panel__placeholder"
        />
      </view>

      <button class="ai-feedback-panel__primary" @click="confirm">
        确认提交
      </button>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
:deep(.ai-feedback-panel) {
  border-radius: 32rpx 32rpx 0 0;
  overflow: hidden;
  background: var(--app-bg-surface);
}

.ai-feedback-panel__body {
  padding: 32rpx 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.ai-feedback-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28rpx;
}

.ai-feedback-panel__title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text-primary);
}

.ai-feedback-panel__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
}

.ai-feedback-panel__label {
  display: block;
  margin-bottom: 16rpx;
  font-size: 24rpx;
  color: var(--app-text-tertiary);
}

.ai-feedback-panel__tags {
  width: 100%;
  white-space: nowrap;
}

.ai-feedback-panel__tag-row {
  display: inline-flex;
  gap: 16rpx;
  padding: 4rpx 0;
}

.ai-feedback-panel__tag {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 64rpx;
  padding: 0 28rpx;
  font-size: 26rpx;
  color: var(--app-text-secondary);
  background: var(--app-bg-drawer);
  border: 1px solid var(--app-border-default);
  border-radius: 999rpx;
  transition: color var(--app-transition-fast) ease, background var(--app-transition-fast) ease, border-color var(--app-transition-fast) ease;
}

.ai-feedback-panel__tag--active {
  color: var(--app-text-inverse);
  background: var(--app-action-primary);
  border-color: var(--app-action-primary);
}

.ai-feedback-panel__field {
  padding: 24rpx;
  border-radius: 20rpx;
  background: var(--app-bg-drawer);
  border: 1px solid var(--app-border-default);
}

.ai-feedback-panel__textarea {
  width: 100%;
  height: 160rpx;
  font-size: 28rpx;
  color: var(--app-text-primary);
}

.ai-feedback-panel__placeholder {
  color: var(--app-text-disabled);
}

.ai-feedback-panel__primary {
  width: 100%;
  margin-top: 28rpx;
  padding: 0;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 88rpx;
  color: var(--app-text-inverse);
  text-align: center;
  border: none;
  border-radius: 999rpx;
  background: var(--app-action-primary);
}

.ai-feedback-panel__primary::after {
  border: none;
}
</style>