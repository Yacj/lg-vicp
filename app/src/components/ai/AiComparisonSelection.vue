<script setup lang="ts">
import type { AgentChoiceOption } from '@/utils/aiAgentUi'
import AiSelectionCard from '@/components/ai/AiSelectionCard.vue'
import { canConfirmComparison } from '@/utils/aiComparison'

const props = withDefaults(defineProps<{
  title: string
  prompt: string
  options: AgentChoiceOption[]
  selectedIds: string[]
  minSelections?: number
  maxSelections?: number
  confirmLabel?: string
  disabled?: boolean
  loading?: boolean
  showFooter?: boolean
}>(), {
  minSelections: 1,
  confirmLabel: '确认并生成报告',
  showFooter: true,
})

const emit = defineEmits<{
  toggle: [optionId: string]
  confirm: []
}>()

const mappedOptions = computed(() => props.options.map(item => ({
  id: item.id,
  title: item.title || item.label,
  description: item.description,
  meta: item.meta,
  disabled: item.disabled,
  resumeContent: item.resumeContent,
})))

const canConfirm = computed(() => canConfirmComparison(props.selectedIds.length, props.minSelections) && !props.disabled)
</script>

<template>
  <view>
    <AiSelectionCard
      :title="title"
      :description="prompt || '可选择一个或多个'"
      :options="mappedOptions"
      :selected-ids="selectedIds"
      multiple
      :min-selections="minSelections"
      :max-selections="maxSelections"
      :confirm-label="confirmLabel"
      selection-kind="PRODUCT"
      :disabled="disabled"
      :loading="loading"
      :show-footer="showFooter"
      @toggle="emit('toggle', $event)"
      @confirm="canConfirm && emit('confirm')"
    />
    <view class="app-tertiary mt-2 px-1 text-2.5">
      也可以继续输入，例如「再加一个产品」或「哪个更适合预算有限？」
    </view>
  </view>
</template>
