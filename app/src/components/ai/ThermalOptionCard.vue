<script setup lang="ts">
import type { KnowledgeRenderConstruction, ThermalFieldKey, ThermalRenderOption } from '@/api/reference-page'
import { computed } from 'vue'
import { readableReferenceAnnotations } from '@/utils/referenceAnnotations'
import { formatReferenceNumber } from '@/utils/referencePage'
import { thermalColumnHeader } from '@/utils/thermalSourceLabels'

const props = defineProps<{ option: Omit<ThermalRenderOption, 'optionId'>, construction?: KnowledgeRenderConstruction, highlighted?: boolean, active?: boolean, fieldKeys?: string[] }>()
const fields = computed(() => [
  ...(['productThermalResistance', 'totalThermalResistance', 'kValue'] as ThermalFieldKey[]).map(key => ({ key, ...thermalColumnHeader(props.construction ? [props.construction] : [], key) })),
])
const hasWarning = computed(() => !!readableReferenceAnnotations(props.option.warnings).length || ['thicknessMm', 'productThermalResistance', 'totalThermalResistance', 'kValue'].some((key) => {
  const value = props.option[key as ThermalFieldKey]
  return value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0
}))
</script>

<template>
  <view class="thermal-option" :class="{ 'thermal-option--hit': highlighted, 'thermal-option--active': active }">
    <view class="flex items-center justify-between gap-2">
      <text class="text-4 font-semibold" :class="{ 'thermal-option__field-hit': fieldKeys?.includes('thicknessMm') }">
        {{ formatReferenceNumber(option.thicknessMm) }} mm
      </text>
      <text v-if="highlighted" class="app-primary-text text-2.5">
        {{ active ? '当前档位' : '命中档位' }}
      </text>
    </view>
    <view v-for="field in fields" :key="field.key" class="mt-2 flex items-baseline justify-between gap-3 text-3">
      <text class="app-muted">
        {{ field.label }}
      </text>
      <view class="text-right">
        <text class="thermal-option__value" :class="{ 'thermal-option__field-hit': fieldKeys?.includes(field.key) }">
          {{ formatReferenceNumber(option[field.key], 3) }}
        </text>
        <text class="app-tertiary ml-1 text-2.5">
          {{ field.unit }}
        </text>
      </view>
    </view>
    <text v-if="hasWarning" class="thermal-option__warning mt-2 block text-2.5">
      部分识别参数需核对，请以原始页面为准。
    </text>
  </view>
</template>

<style scoped lang="scss">
.thermal-option { padding: var(--app-space-3); border: 1px solid var(--app-border-default); border-radius: var(--app-radius-xs); color: var(--app-text-primary); font-variant-numeric: tabular-nums; }
.thermal-option--hit { background: var(--app-action-primary-soft); border-color: var(--app-action-primary); }
.thermal-option--active { border-width: 2px; }
.thermal-option__value { white-space: nowrap; font-weight: 600; }
.thermal-option__warning { color: var(--app-warning); }
.thermal-option__field-hit { color: var(--app-action-primary); background: var(--app-bg-surface); border-radius: var(--app-radius-xs); padding: 2rpx 8rpx; font-weight: 700; }
</style>
