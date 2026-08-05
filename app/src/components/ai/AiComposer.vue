<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  active: boolean
  streaming: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:active': [value: boolean]
  'send': []
  'stop': []
}>()

const composerTextarea = ref()

watch(() => props.active, (active) => {
  if (active) {
    nextTick(() => composerTextarea.value?.focus?.())
  }
})

function handleAction() {
  if (props.streaming) {
    emit('stop')
    return
  }
  if (!props.disabled && props.modelValue.trim()) {
    emit('send')
  }
}
</script>

<template>
  <view class="ai-composer-wrap">
    <view class="ai-composer app-panel-flat p-3">
      <wd-textarea
        ref="composerTextarea"
        :model-value="modelValue"
        :disabled="disabled"
        :cursor-spacing="12"
        auto-height
        confirm-type="send"
        placeholder="描述项目需求或询问节能规范"
        no-border
        custom-class="!p-0"
        custom-textarea-class="ai-composer__textarea"
        @focus="emit('update:active', true)"
        @blur="emit('update:active', false)"
        @confirm="handleAction"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <view class="mt-1 flex items-center gap-2">
        <view class="app-tertiary min-w-0 flex-1 text-2.5">
          {{ disabled ? '正在加载会话…' : 'Enter 换行，点击按钮发送' }}
        </view>
        <wd-button
          :type="props.streaming ? 'warning' : 'primary'"
          size="mini"
          :icon="props.streaming ? 'close' : 'caret-up'"
          :disabled="!props.streaming && (disabled || !modelValue.trim())"
          custom-class="ai-composer__send!"
          :aria-label="props.streaming ? '停止生成' : '发送消息'"
          @click="handleAction"
        />
      </view>
    </view>

    <view class="app-tertiary mt-2 text-center text-2.5">
      AI 内容可能存在误差，请结合项目规范核对
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-composer {
  border-color: var(--app-border-strong);
  border-radius: 32rpx;
  background: var(--app-bg-surface);
  box-shadow: var(--app-shadow-input);
  transition: border-color var(--app-transition-fast) ease, box-shadow var(--app-transition-fast) ease;
}

.ai-composer:focus-within {
  border-color: var(--app-action-primary);
  box-shadow: 0 0 0 6rpx var(--app-action-primary-soft);
}

:deep(.ai-composer__textarea) {
  min-height: 64rpx;
  max-height: 200rpx;
  overflow-y: auto;
  color: var(--app-text-primary);
  font-size: 28rpx;
  line-height: 44rpx;
}

.ai-composer__send {
  width: 68rpx !important;
  height: 68rpx !important;
  min-width: 68rpx !important;
  padding: 0 !important;
  border-radius: 50% !important;
  box-shadow: none !important;
}
</style>
