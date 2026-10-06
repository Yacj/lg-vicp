<script setup lang="ts">
import type { ParsedNeedInput } from '@/utils/aiAgentUi'

defineProps<{
  input: ParsedNeedInput
  disabled?: boolean
}>()

const emit = defineEmits<{
  resume: [content: string]
}>()
</script>

<template>
  <view class="ai-need-input app-panel-flat mt-3 rounded-3 px-3.5 py-3">
    <view class="text-3.5 font-semibold leading-5.5">
      {{ input.mode === 'conflict' ? '检测到新的项目条件与之前记录不同' : input.prompt }}
    </view>

    <view v-if="input.mode === 'conflict' && input.conflict" class="mt-3 space-y-2">
      <view class="ai-need-input__value rounded-2 px-3 py-2">
        <text class="app-tertiary block text-2.5">
          原值
        </text>
        <text class="mt-0.5 block text-3 leading-5">
          {{ input.conflict.previous }}
        </text>
      </view>
      <view class="ai-need-input__value ai-need-input__value--next rounded-2 px-3 py-2">
        <text class="app-tertiary block text-2.5">
          新值
        </text>
        <text class="mt-0.5 block text-3 leading-5">
          {{ input.conflict.next }}
        </text>
      </view>
    </view>

    <view v-else-if="input.options.length" class="mt-3 space-y-2">
      <view
        v-for="option in input.options"
        :key="option.id"
        class="ai-need-input__option rounded-2 px-3 py-2.5"
      >
        <text class="block text-3 font-medium">
          {{ option.label }}
        </text>
        <text v-if="option.description" class="app-muted mt-1 block text-2.5 leading-4.5">
          {{ option.description }}
        </text>
      </view>
    </view>

    <view class="mt-3 flex flex-wrap gap-2">
      <wd-button
        v-for="option in input.options"
        :key="`btn-${option.id}`"
        size="small"
        :disabled="disabled"
        :plain="input.mode === 'conflict' && option.id === 'keep-old'"
        @click="emit('resume', option.resumeContent)"
      >
        {{ option.label }}
      </wd-button>
    </view>

    <view class="app-tertiary mt-2 text-2.5">
      也可以直接输入，例如「第二个」
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-need-input {
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}

.ai-need-input__value,
.ai-need-input__option {
  background: var(--app-bg-drawer);
}

.ai-need-input__value--next {
  background: var(--app-action-primary-soft);
}
</style>
