<script setup lang="ts">
definePage({
  name: 'assistant',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '筑小格',
  },
})

interface AssistantMessage {
  role: 'assistant' | 'user'
  content: string
}

const input = ref('')
const messages = ref<AssistantMessage[]>([
  {
    role: 'assistant',
    content: '你好，我是筑小格。可以告诉我项目所在地、建筑类型、节能等级或保温材料，我会先整理成待确认的项目参数。',
  },
])

const suggestions = ['我有一个住宅项目', '帮我整理材料参数', '查看热工计算流程']

function useSuggestion(value: string) {
  input.value = value
}

function sendMessage() {
  const content = input.value.trim()
  if (!content) {
    return
  }

  messages.value.push({ role: 'user', content })
  messages.value.push({
    role: 'assistant',
    content: '已记录你的描述。接口接入后，这里会生成结构化参数卡，并等待你确认后进入计算流程。',
  })
  input.value = ''
}
</script>

<template>
  <view class="app-page box-border min-h-screen flex flex-col">
    <wd-navbar custom-class="app-navbar app-navbar--brand" safe-area-inset-top title="筑小格">
      <template #right>
        <view class="app-navbar__action">
          <wd-icon name="more" size="36rpx" color="var(--app-text-inverse)" />
        </view>
      </template>
    </wd-navbar>

    <view class="app-enter min-h-0 flex flex-1 flex-col px-4 py-4 pb-6">
      <view class="app-ai-soft mb-4 flex items-center gap-3 rounded-3 p-3">
        <view class="h-9 w-9 flex shrink-0 items-center justify-center rounded-full bg-[var(--app-ai)]">
          <wd-icon name="chat" size="40rpx" color="var(--app-text-inverse)" />
        </view>
        <view class="min-w-0">
          <view class="app-ai-text text-3.5 font-bold">
            业务范围已开启
          </view>
          <view class="app-muted mt-0.5 text-2.5">
            仅处理建筑节能、材料、规范和项目设计相关问题
          </view>
        </view>
      </view>

      <scroll-view scroll-y class="min-h-0 flex-1">
        <view class="pb-4 space-y-4">
          <view v-for="(message, index) in messages" :key="index" class="flex gap-2" :class="message.role === 'user' ? 'flex-row-reverse' : ''">
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

      <view class="pt-2">
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

        <view class="app-panel-flat flex items-end gap-2 p-2">
          <wd-textarea
            v-model="input"
            :autosize="{ minHeight: 32, maxHeight: 88 }"
            placeholder="描述你的项目需求"
            no-border
            custom-class="flex-1! px-2!"
          />
          <wd-button
            type="primary"
            size="small"
            :disabled="!input.trim()"
            custom-class="shrink-0!"
            @click="sendMessage"
          >
            发送
          </wd-button>
        </view>
      </view>
    </view>
  </view>
</template>
