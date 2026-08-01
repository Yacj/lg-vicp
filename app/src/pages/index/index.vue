<script setup lang="ts">
import type { AttachmentAsset } from '@/services/attachments'
import { AttachmentPickerError, isAttachmentCancelled, pickAttachment, previewAttachment } from '@/services/attachments'

definePage({
  name: 'home',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

interface HomeMessage {
  role: 'assistant' | 'user'
  content: string
}

type DrawerEntry = 'projects' | 'public-projects' | 'project-detail' | 'create-project' | 'assistant' | 'profile' | 'login'

const router = useRouter()
const { requireLogin } = useAuthGate()
const { info, error: showError } = useGlobalToast()
const drawerVisible = ref(false)
const isComposerActive = ref(false)
const composerTextarea = ref()
const input = ref('')
const messages = ref<HomeMessage[]>([])

const suggestions = [
  '我有一个住宅项目',
  '帮我匹配保温材料',
  '查看热工计算流程',
]

const models = [
  { value: 'deepseek', label: 'DeepSeek', description: '适合建筑节能方案分析' },
] as const

type AttachmentType = 'album' | 'camera' | 'file'

const attachments = [
  { value: 'album', label: '相册图片', description: '选择手机中的图片', icon: 'picture' },
  { value: 'camera', label: '相机拍摄', description: '使用摄像头拍摄图片', icon: 'camera' },
  { value: 'file', label: '手机文件', description: '支持 DOC / DOCX / PDF / TXT', icon: 'file' },
] as const

const selectedModel = ref<(typeof models)[number]['value']>('deepseek')
const modelPickerVisible = ref(false)
const attachmentPickerVisible = ref(false)
const selectedAttachments = ref<AttachmentAsset[]>([])

const selectedModelLabel = computed(() => {
  return models.find(model => model.value === selectedModel.value)?.label || 'DeepSeek'
})

function openModelPicker() {
  modelPickerVisible.value = true
}

function selectModel(value: typeof selectedModel.value) {
  selectedModel.value = value
  modelPickerVisible.value = false
}

function openAttachmentPicker() {
  attachmentPickerVisible.value = true
}

async function selectAttachment(type: AttachmentType) {
  attachmentPickerVisible.value = false

  try {
    const selected = await pickAttachment(type)
    selectedAttachments.value = [...selectedAttachments.value, ...selected]

    if (selected.length) {
      info(`已选择 ${selected.length} 个附件`)
    }
  }
  catch (error) {
    if (isAttachmentCancelled(error)) {
      return
    }
    console.log(error)
    const message = error instanceof AttachmentPickerError ? error.message : '附件选择失败，请稍后重试'
    showError(message)
  }
}

function removeAttachment(index: number) {
  selectedAttachments.value.splice(index, 1)
}

async function previewSelectedAttachment(index: number) {
  const asset = selectedAttachments.value[index]
  if (!asset) {
    return
  }

  try {
    await previewAttachment(asset, selectedAttachments.value)
  }
  catch (error) {
    const message = error instanceof AttachmentPickerError ? error.message : '附件预览失败，请稍后重试'
    showError(message)
  }
}

function activateComposer(value?: string) {
  if (value) {
    input.value = value
  }

  isComposerActive.value = true
  nextTick(() => composerTextarea.value?.focus?.())
}

function useSuggestion(value: string) {
  activateComposer(value)
}

function handleDrawerSelect(entry: DrawerEntry, id?: string) {
  drawerVisible.value = false

  if (entry === 'projects' || entry === 'public-projects') {
    const scope = entry === 'public-projects' ? 'public' : 'mine'
    if (scope === 'mine' && !requireLogin()) {
      return
    }
    router.pushTab({ name: 'projects', query: { scope } })
    return
  }

  if (entry === 'project-detail' && id) {
    if (requireLogin()) {
      router.push({ name: 'project-detail', query: { id } })
    }
    return
  }

  if (entry === 'create-project') {
    if (requireLogin()) {
      router.push({ name: 'project-create' })
    }
    return
  }

  if (entry === 'assistant') {
    if (requireLogin()) {
      router.pushTab({ name: 'assistant', query: id ? { conversationId: id } : undefined })
    }
    return
  }

  if (entry === 'profile') {
    router.pushTab({ name: 'profile' })
  }
}

function sendMessage() {
  const content = input.value.trim()
  if (!content) {
    return
  }

  messages.value.push({ role: 'user', content })
  messages.value.push({
    role: 'assistant',
    content: '我已记下你的需求。接下来可以继续补充项目所在地、建筑类型或节能目标。',
  })
  input.value = ''
}
</script>

<template>
  <view class="app-page app-page--immersive app-home box-border min-h-screen flex flex-col">
    <wd-navbar custom-class="!bg-transparent" safe-area-inset-top title="筑小格">
      <template #left>
        <view class="app-navbar__action" aria-label="打开导航" @click="drawerVisible = true">
          <wd-icon name="align-left" size="40rpx" color="var(--app-text-primary)" />
        </view>
      </template>
    </wd-navbar>

    <view class="app-enter app-home__body min-h-0 flex flex-1 flex-col px-4">
      <scroll-view scroll-y class="app-home__messages min-h-0 flex-1">
        <view v-if="!messages.length && !isComposerActive" class="home-welcome min-h-120 flex flex-col items-center justify-center px-5 text-center">
          <view class="home-hero-art mb-5 flex items-center justify-center" aria-label="IP 形象占位">
            <view class="home-hero-art__glow" />
            <view class="home-hero-art__mark flex items-center justify-center rounded-3xl">
              <wd-icon name="chat" size="60rpx" color="var(--app-text-inverse)" />
            </view>
          </view>
          <view class="app-eyebrow mb-2">
            VICP 建筑节能 AI
          </view>
          <view class="text-6 font-bold leading-8">
            你好，我是筑小格
          </view>
          <view class="app-muted mt-2 max-w-680rpx text-3.5 leading-6">
            描述你的项目，我帮你整理参数并推进设计。
          </view>
        </view>

        <view v-else class="pb-4 pt-4 space-y-4">
          <view
            v-for="(message, index) in messages"
            :key="index"
            class="flex gap-2"
            :class="message.role === 'user' ? 'flex-row-reverse' : ''"
          >
            <view
              class="h-8 w-8 flex shrink-0 items-center justify-center rounded-full"
              :class="message.role === 'user' ? 'bg-[var(--app-action-primary)]' : 'app-ai-soft'"
            >
              <wd-icon
                :name="message.role === 'user' ? 'user' : 'chat'"
                size="32rpx"
                :color="message.role === 'user' ? 'var(--app-text-inverse)' : 'var(--app-ai)'"
              />
            </view>
            <view
              class="max-w-290rpx rounded-3 px-3.5 py-3 text-3.5 leading-5"
              :class="message.role === 'user' ? 'bg-[var(--app-action-primary)] text-white' : 'app-panel-flat'"
            >
              {{ message.content }}
            </view>
          </view>
        </view>
      </scroll-view>

      <view class="app-home__composer pt-2">
        <scroll-view scroll-x class="mb-3 whitespace-nowrap">
          <view class="inline-flex gap-2">
            <view
              v-for="suggestion in suggestions"
              :key="suggestion"
              class="app-panel-flat app-muted rounded-full px-3 py-2 text-2.5"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </view>
          </view>
        </scroll-view>

        <view
          v-if="!isComposerActive"
          class="app-composer app-composer--collapsed app-panel-flat flex items-center gap-3 px-4 py-3"
          @click="activateComposer()"
        >
          <wd-icon name="sound" size="42rpx" color="var(--app-text-primary)" />
          <view class="app-muted min-w-0 flex-1 truncate text-3.5">
            描述你的项目需求
          </view>
          <wd-icon name="add" size="46rpx" color="var(--app-text-primary)" />
        </view>

        <view v-else class="app-composer app-composer--expanded app-panel-flat p-3">
          <view v-if="selectedAttachments.length" class="app-composer__attachments mb-2 flex flex-wrap gap-2">
            <view
              v-for="(attachment, index) in selectedAttachments"
              :key="`${attachment.path}-${index}`"
              class="app-composer__attachment app-panel-flat max-w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5"
              @click="previewSelectedAttachment(index)"
            >
              <wd-icon
                :name="attachment.kind === 'image' ? 'picture' : 'file'"
                size="30rpx"
                color="var(--app-action-primary)"
              />
              <view class="min-w-0 flex-1 truncate text-2.5">
                {{ attachment.name }}
              </view>
              <wd-icon
                name="close"
                size="26rpx"
                color="var(--app-text-tertiary)"
                @click.stop="removeAttachment(index)"
              />
            </view>
          </view>
          <wd-textarea
            ref="composerTextarea"
            v-model="input"
            auto-height
            placeholder="描述你的项目需求"
            no-border
            custom-class="!p-0"
            custom-textarea-class="app-composer__textarea"
          />
          <view class="mt-7 flex items-center gap-3">
            <view class="app-composer__model app-muted flex items-center gap-1 text-3" @click="openModelPicker">
              <wd-icon name="module-fill" size="32rpx" color="var(--app-text-tertiary)" custom-class="relative top-[1rpx]" />
              {{ selectedModelLabel }}
            </view>
            <view class="flex-1" />
            <wd-icon name="plus" size="34rpx" color="var(--app-text-primary)" @click="openAttachmentPicker" />
            <wd-button
              type="primary"
              size="mini"
              icon="caret-up"
              :disabled="!input.trim()"
              custom-class="app-composer__send!"
              @click="sendMessage"
            />
          </view>
        </view>
        <view class="app-tertiary mt-2 text-center text-2.5">
          内容由 AI 生成，请结合项目规范核对结果
        </view>
      </view>
    </view>
  </view>

  <app-drawer v-model="drawerVisible" @select="handleDrawerSelect" />

  <wd-popup
    v-model="modelPickerVisible"
    position="bottom"
    round
    closable
    lock-scroll
    root-portal
    safe-area-inset-bottom
    custom-style="max-height: 55vh;"
  >
    <view class="app-picker">
      <view class="app-picker__title">
        选择模型
      </view>
      <view
        v-for="model in models"
        :key="model.value"
        class="app-picker__option flex items-center gap-3"
        @click="selectModel(model.value)"
      >
        <view class="app-picker__icon flex shrink-0 items-center justify-center rounded-xl">
          <wd-icon name="chat" size="40rpx" color="var(--app-action-primary)" />
        </view>
        <view class="min-w-0 flex-1">
          <view class="text-3.5 font-medium">
            {{ model.label }}
          </view>
          <view class="app-muted mt-0.5 text-2.5">
            {{ model.description }}
          </view>
        </view>
        <wd-icon
          :name="selectedModel === model.value ? 'check' : 'circle'"
          size="38rpx"
          :color="selectedModel === model.value ? 'var(--app-action-primary)' : 'var(--app-text-tertiary)'"
        />
      </view>
    </view>
  </wd-popup>

  <wd-popup
    v-model="attachmentPickerVisible"
    position="bottom"
    round
    closable
    lock-scroll
    root-portal
    safe-area-inset-bottom
    custom-style="max-height: 65vh;"
  >
    <view class="app-picker">
      <view class="app-picker__attachments flex gap-2">
        <view
          v-for="attachment in attachments"
          :key="attachment.value"
          class="app-picker__option flex flex-1 flex-col items-center justify-center gap-2 rounded-xl"
          @click="selectAttachment(attachment.value)"
        >
          <view class="app-picker__icon flex shrink-0 items-center justify-center">
            <wd-icon :name="attachment.icon" size="48rpx" color="var(--app-text-secondary)" />
          </view>
          <view class="app-picker__label text-center text-3">
            {{ attachment.label }}
          </view>
        </view>
      </view>
      <view class="app-picker__hint app-muted mt-2 text-2.5">
        当前仅支持图片和文档，不支持视频。
      </view>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
.app-home {
  background: var(--app-bg-surface);
}

.home-hero-art {
  position: relative;
  width: 176rpx;
  height: 176rpx;
}

.home-hero-art__glow {
  position: absolute;
  width: 144rpx;
  height: 144rpx;
  border-radius: 56rpx;
  background: var(--app-gradient-ai);
  opacity: 0.16;
  filter: blur(24rpx);
  transform: rotate(-10deg);
}

.home-hero-art__mark {
  position: relative;
  width: 116rpx;
  height: 116rpx;
  background: var(--app-gradient-brand);
  box-shadow: 0 24rpx 52rpx rgba(47, 107, 255, 0.2);
  transform: rotate(-6deg);
}

.app-home__body {
  padding-bottom: env(safe-area-inset-bottom);
}

.app-home__messages {
  overscroll-behavior: contain;
}

.app-home__composer {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  padding-bottom: 24rpx;
  background: linear-gradient(180deg, transparent 0%, var(--app-bg-surface) 20%);
}

.app-composer {
  border-radius: 48rpx;
  background: var(--app-bg-surface);
  box-shadow: 0 20rpx 56rpx rgba(20, 43, 69, 0.08);
}

.app-composer--collapsed {
  min-height: 104rpx;
}

.app-composer--expanded {
  min-height: 232rpx;
}

:deep(.app-composer__textarea) {
  min-height: 88rpx;
  max-height: 224rpx;
  overflow-y: auto;
}

.app-composer__model {
  cursor: pointer;
}

.app-composer__send {
  width: 68rpx !important;
  height: 68rpx !important;
  min-width: 68rpx !important;
  padding: 0 !important;
  border-radius: 50% !important;
  box-shadow: none !important;
}

.app-picker {
  padding: 40rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  padding-top: 110rpx;
}

.app-picker__title {
  margin-bottom: 24rpx;
  color: var(--app-text-primary);
  font-size: 34rpx;
  font-weight: 700;
}

.app-picker__option {
  min-height: 176rpx;
  background: var(--app-bg-canvas);
}

.app-picker__option:active {
  background: var(--app-action-primary-soft);
}

.app-picker__icon {
  width: 64rpx;
  height: 64rpx;
}

.app-picker__label {
  color: var(--app-text-secondary);
  line-height: 36rpx;
}

.app-picker__hint {
  line-height: 36rpx;
}

.home-menu-icon {
  display: flex;
  width: 32rpx;
  flex-direction: column;
  gap: 6rpx;

  view {
    width: 32rpx;
    height: 3rpx;
    border-radius: 999rpx;
    background: currentColor;
  }
}
</style>
