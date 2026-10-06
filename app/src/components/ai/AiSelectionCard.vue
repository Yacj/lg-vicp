<script setup lang="ts">
import type { UserSelectionKind, UserSelectionOption } from '@/utils/aiUserSelection'
import { canConfirmSelection, optionMetaLines } from '@/utils/aiUserSelection'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  options: Array<UserSelectionOption | {
    id: string
    label?: string
    title?: string
    description?: string
    meta?: Record<string, unknown>
    disabled?: boolean
  }>
  selectedIds: string[]
  multiple?: boolean
  minSelections?: number
  maxSelections?: number
  confirmLabel?: string
  selectionKind?: UserSelectionKind
  disabled?: boolean
  loading?: boolean
  showFooter?: boolean
}>(), {
  description: '',
  multiple: false,
  minSelections: 1,
  confirmLabel: '确认',
  disabled: false,
  loading: false,
  showFooter: true,
})

const emit = defineEmits<{
  toggle: [optionId: string]
  confirm: []
}>()

const normalizedOptions = computed(() => props.options.map(item => ({
  id: item.id,
  title: ('title' in item && item.title) || ('label' in item && item.label) || item.id,
  description: item.description || '',
  meta: item.meta,
  disabled: item.disabled === true,
  resumeContent: ('title' in item && item.title) || ('label' in item && item.label) || item.id,
})))

const canConfirm = computed(() => canConfirmSelection(props.selectedIds.length, {
  minSelections: props.minSelections ?? 1,
  maxSelections: props.maxSelections,
  multiple: props.multiple,
}) && !props.disabled && !props.loading)

function isSelected(id: string) {
  return props.selectedIds.includes(id)
}

function optionLines(option: UserSelectionOption) {
  return optionMetaLines(props.selectionKind, option)
}

function handleToggle(option: UserSelectionOption) {
  if (props.disabled || props.loading || option.disabled) {
    return
  }
  emit('toggle', option.id)
}
</script>

<template>
  <view class="ai-selection-card app-panel-flat mt-3 rounded-3 px-3.5 py-3">
    <view class="text-3.5 font-semibold leading-5.5">
      {{ title }}
    </view>
    <view v-if="description" class="app-muted mt-1 text-2.5 leading-4.5">
      {{ description }}
    </view>

    <view class="mt-3 space-y-2">
      <view
        v-for="option in normalizedOptions"
        :key="option.id"
        class="ai-selection-card__option flex items-start gap-2.5 rounded-2 px-3 py-2.5"
        :class="[
          isSelected(option.id) ? 'ai-selection-card__option--active' : '',
          option.disabled ? 'ai-selection-card__option--disabled' : '',
        ]"
        @click="handleToggle(option)"
      >
        <view
          class="ai-selection-card__mark flex shrink-0 items-center justify-center"
          :class="[
            multiple ? 'ai-selection-card__mark--check' : 'ai-selection-card__mark--radio',
            isSelected(option.id) ? 'ai-selection-card__mark--on' : '',
          ]"
        >
          <wd-icon v-if="isSelected(option.id)" name="check" size="22rpx" color="var(--app-text-inverse)" />
        </view>
        <view class="min-w-0 flex-1">
          <text class="block text-3 font-medium leading-5">
            {{ option.title }}
          </text>
          <text
            v-for="(line, index) in optionLines(option)"
            :key="`${option.id}-${index}`"
            class="app-muted mt-1 block text-2.5 leading-4.5"
          >
            {{ line }}
          </text>
        </view>
      </view>
    </view>

    <view v-if="showFooter" class="mt-3 flex items-center justify-end">
      <wd-button
        size="small"
        :disabled="!canConfirm"
        :loading="loading"
        @click="canConfirm && emit('confirm')"
      >
        {{ confirmLabel }}
      </wd-button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-selection-card {
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}

.ai-selection-card__option {
  background: var(--app-bg-drawer);
  border: 1px solid transparent;
}

.ai-selection-card__option--active {
  border-color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.ai-selection-card__option--disabled {
  opacity: 0.4;
}

.ai-selection-card__mark {
  width: 36rpx;
  height: 36rpx;
  margin-top: 4rpx;
  border: 2rpx solid var(--app-border-strong);
  background: var(--app-bg-surface);
}

.ai-selection-card__mark--check {
  border-radius: 8rpx;
}

.ai-selection-card__mark--radio {
  border-radius: 50%;
}

.ai-selection-card__mark--on {
  border-color: var(--app-action-primary);
  background: var(--app-action-primary);
}
</style>
