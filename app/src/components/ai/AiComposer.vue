<script setup lang="ts">
import type { ChatImageDraft } from '@/composables/useChatImageUpload'
import { useVoiceInput } from '@/composables/useVoiceInput'

const props = defineProps<{
  modelValue: string
  active: boolean
  streaming: boolean
  disabled?: boolean
  attachments?: ChatImageDraft[]
  uploading?: boolean
  placeholder?: string
  statusText?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:active': [value: boolean]
  'send': []
  'stop': []
  'pick': [type: 'camera' | 'album']
  'remove-attachment': [key: string]
}>()

const composerTextarea = ref()
const sheetVisible = ref(false)

/** 上滑取消的位移阈值（px），超出即进入取消意图 */
const CANCEL_THRESHOLD = 60

const toast = useGlobalToast()

const { phase, duration, cancelIntent, start, stop, markCancelIntent, reset } = useVoiceInput({
  onResult: handleVoiceResult,
})

const isRecording = computed(() => phase.value === 'recording')
const isRecognizing = computed(() => phase.value === 'recognizing')
const voiceActive = computed(() => isRecording.value || isRecognizing.value)
const voiceDisabled = computed(() => props.streaming || Boolean(props.disabled) || Boolean(props.uploading))
const canSend = computed(() => Boolean(props.modelValue.trim() || props.attachments?.length))
const attachDisabled = computed(() => props.streaming || Boolean(props.disabled) || Boolean(props.uploading) || voiceActive.value)
const sheetActions = [
  { name: '拍照' },
  { name: '从相册选择' },
]

let pressStartY = 0

watch(() => props.active, (active) => {
  if (active) {
    nextTick(() => composerTextarea.value?.focus?.())
  }
})

onUnmounted(() => {
  reset()
})

function handleAction() {
  if (props.streaming) {
    emit('stop')
    return
  }
  if (!props.disabled && !props.uploading && canSend.value) {
    emit('send')
  }
}

function handleVoiceResult(text: string) {
  const merged = props.modelValue.trim() ? `${props.modelValue.trim()}\n${text}` : text
  emit('update:modelValue', merged)
  emit('update:active', true)
  nextTick(() => composerTextarea.value?.focus?.())
}

function handlePressStart(event: TouchEvent) {
  if (voiceDisabled.value) {
    return
  }
  pressStartY = event.touches[0]?.clientY ?? 0
  start()
}

function handlePressMove(event: TouchEvent) {
  if (!isRecording.value) {
    return
  }
  const currentY = event.touches[0]?.clientY ?? pressStartY
  markCancelIntent(pressStartY - currentY > CANCEL_THRESHOLD)
}

async function handlePressEnd() {
  if (!isRecording.value) {
    return
  }
  const outcome = await stop()
  if (outcome.cancelled && outcome.reason === 'tooShort') {
    toast.info('说话时间太短')
  }
}

function handlePressCancel() {
  if (isRecording.value) {
    markCancelIntent(true)
    void stop()
  }
}

function openAttachSheet() {
  if (attachDisabled.value) {
    return
  }
  sheetVisible.value = true
}

function onSheetSelect({ index }: { index: number }) {
  emit('pick', index === 0 ? 'camera' : 'album')
}

function previewDraft(draft: ChatImageDraft) {
  const urls = (props.attachments || []).map(item => item.path)
  uni.previewImage({
    urls,
    current: draft.path,
  })
}
</script>

<template>
  <view class="ai-composer-wrap">
    <view class="ai-composer app-panel-flat p-3">
      <view v-if="attachments?.length && !voiceActive" class="ai-composer__thumbs mb-2">
        <view
          v-for="item in attachments"
          :key="item.key"
          class="ai-composer__thumb"
        >
          <image
            class="ai-composer__thumb-image"
            :src="item.path"
            mode="aspectFill"
            @click="previewDraft(item)"
          />
          <view
            class="ai-composer__thumb-remove"
            aria-label="删除图片"
            @click.stop="emit('remove-attachment', item.key)"
          >
            <wd-icon name="close" size="22rpx" color="var(--app-text-inverse)" />
          </view>
          <view v-if="item.status === 'uploading'" class="ai-composer__thumb-mask">
            <wd-loading size="28rpx" color="var(--app-text-inverse)" />
          </view>
          <view v-else-if="item.status === 'failed'" class="ai-composer__thumb-mask ai-composer__thumb-mask--failed">
            <text class="text-2">
              失败
            </text>
          </view>
        </view>
      </view>

      <!-- 录音 / 识别态面板（替换文本输入区） -->
      <view v-if="voiceActive" class="ai-composer__voice flex flex-col items-center justify-center">
        <view class="ai-composer__voice-waves flex items-center gap-1">
          <view
            v-for="bar in 5"
            :key="bar"
            class="ai-composer__voice-wave"
            :class="{ 'is-recognizing': isRecognizing }"
            :style="{ animationDelay: `${(bar - 1) * 90}ms` }"
          />
        </view>
        <view class="app-muted mt-3 text-3">
          <template v-if="isRecording">
            {{ cancelIntent ? '松开取消' : '松开结束 · 上滑取消' }}
          </template>
          <template v-else>
            识别中…
          </template>
        </view>
        <view v-if="isRecording" class="app-tertiary mt-1 text-2.5">
          {{ duration }}s
        </view>
      </view>

      <wd-textarea
        v-else
        ref="composerTextarea"
        :model-value="modelValue"
        :disabled="disabled"
        :cursor-spacing="12"
        auto-height
        confirm-type="send"
        :placeholder="placeholder || '输入你的问题...'"
        no-border
        custom-class="!p-0"
        custom-textarea-class="ai-composer__textarea"
        @focus="emit('update:active', true)"
        @blur="emit('update:active', false)"
        @confirm="handleAction"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <!-- 操作行常驻：麦克风按钮作为手势目标，录音态不因 DOM 移除而中断触摸 -->
      <view class="mt-1 flex items-center gap-2">
        <view v-show="!voiceActive" class="app-tertiary min-w-0 flex-1 text-2.5">
          {{ disabled ? '正在加载会话…' : uploading ? '正在上传图片…' : (statusText || '') }}
        </view>
        <view
          v-show="!voiceActive"
          class="ai-composer__mic flex items-center justify-center"
          :class="{ 'is-disabled': attachDisabled }"
          aria-label="添加图片"
          @click="openAttachSheet"
        >
          <text class="i-my-icons-plus text-4" />
        </view>
        <view
          class="ai-composer__mic flex items-center justify-center"
          :class="{
            'is-disabled': voiceDisabled,
            'is-recording': isRecording,
            'is-cancel': cancelIntent,
          }"
          aria-label="按住说话"
          @touchstart="handlePressStart"
          @touchmove.prevent="handlePressMove"
          @touchend="handlePressEnd"
          @touchcancel="handlePressCancel"
        >
          <text class="i-my-icons-mic text-4" />
        </view>

        <wd-button
          v-show="!voiceActive"
          :type="props.streaming ? 'warning' : 'primary'"
          size="mini"
          :icon="props.streaming ? 'close' : 'caret-up'"
          :disabled="!props.streaming && (disabled || uploading || !canSend)"
          custom-class="ai-composer__send!"
          :aria-label="props.streaming ? '停止生成' : '发送消息'"
          @click="handleAction"
        />
      </view>
    </view>

    <view class="app-tertiary mt-2 text-center text-2.5">
      AI 内容可能存在误差，请结合项目规范核对
    </view>

    <wd-action-sheet
      v-model="sheetVisible"
      :actions="sheetActions"
      cancel-text="取消"
      :z-index="2000"
      @select="onSheetSelect"
    />
  </view>
</template>

<style lang="scss" scoped>
.ai-composer {
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

.ai-composer__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.ai-composer__thumb {
  position: relative;
  width: 112rpx;
  height: 112rpx;
  overflow: hidden;
  border-radius: 16rpx;
  background: var(--app-bg-drawer);
}

.ai-composer__thumb-image {
  width: 100%;
  height: 100%;
}

.ai-composer__thumb-remove {
  position: absolute;
  top: 4rpx;
  right: 4rpx;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: rgb(0 0 0 / 45%);
}

.ai-composer__thumb-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-inverse);
  background: rgb(0 0 0 / 35%);
}

.ai-composer__thumb-mask--failed {
  background: rgb(0 0 0 / 50%);
}

.ai-composer__attach,
.ai-composer__mic {
  width: 60rpx;
  height: 60rpx;
  flex-shrink: 0;
  color: var(--app-text-secondary);
  border-radius: 50%;
  transition: color var(--app-transition-fast) ease, background-color var(--app-transition-fast) ease, transform var(--app-transition-fast) ease;
}

.ai-composer__attach {
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.ai-composer__attach:active,
.ai-composer__mic:active {
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
  transform: scale(0.92);
}

.ai-composer__attach.is-disabled,
.ai-composer__mic.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}

.ai-composer__mic.is-recording {
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
  animation: mic-breathe 1.2s ease-in-out infinite;
}

.ai-composer__mic.is-cancel {
  color: var(--app-danger);
  background: var(--app-danger-soft);
  animation: none;
}

.ai-composer__send {
  width: 68rpx !important;
  height: 68rpx !important;
  min-width: 68rpx !important;
  padding: 0 !important;
  border-radius: 50% !important;
  box-shadow: none !important;
}

.ai-composer__voice {
  min-height: 96rpx;
}

.ai-composer__voice-waves {
  height: 56rpx;
}

.ai-composer__voice-wave {
  width: 8rpx;
  height: 100%;
  border-radius: 999rpx;
  background: var(--app-action-primary);
  transform-origin: center;
  animation: voice-wave 1s ease-in-out infinite;
}

.ai-composer__voice-wave.is-recognizing {
  animation: voice-wave-loading 1s ease-in-out infinite;
}

@keyframes mic-breathe {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 var(--app-action-primary-soft);
  }

  50% {
    transform: scale(1.06);
    box-shadow: 0 0 0 8rpx var(--app-action-primary-soft);
  }
}

@keyframes voice-wave {
  0%,
  100% {
    transform: scaleY(0.3);
    opacity: 0.5;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@keyframes voice-wave-loading {
  0%,
  100% {
    transform: scaleY(0.4);
    opacity: 0.3;
  }

  50% {
    transform: scaleY(0.8);
    opacity: 0.7;
  }
}
</style>
