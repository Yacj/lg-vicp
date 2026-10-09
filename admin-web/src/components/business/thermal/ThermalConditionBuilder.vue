<script setup lang="ts">
import type { ThermalConditionDraft, ThermalConditionPayload, ThermalThicknessMode } from '@/components/business/thermal/condition-model'
import type { ThermalLookupFilter } from '@/types/thermal'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed } from 'vue'
import { createThermalConditionDraft, THERMAL_CONDITION_MAX_ROWS } from '@/components/business/thermal/condition-model'
import {
  THERMAL_LOOKUP_METRIC_OPTIONS,
  THERMAL_LOOKUP_MODE_OPTIONS,
  thermalLookupConditionSummary,
  thermalLookupMetricUnit,
} from '@/utils/thermal-presentation'

/**
 * 热工参考查询条件构造器（纯 UI，不发请求）。
 * - 多指标条件之间为 AND，最多 12 条（后端 filters[] 约束）；
 * - 厚度「精确档」与「区间」互斥，区间允许单边；
 * - 指标 / 匹配语义文案统一来自 utils/thermal-presentation，不在此另建别名。
 */
const props = withDefaults(defineProps<{
  loading?: boolean
  disabled?: boolean
  searchLabel?: string
}>(), {
  loading: false,
  disabled: false,
  searchLabel: '查询参考方案',
})

const emit = defineEmits<{
  search: [payload: ThermalConditionPayload]
  reset: []
}>()

const filters = defineModel<ThermalConditionDraft[]>('filters', { required: true })
const thicknessMode = defineModel<ThermalThicknessMode>('thicknessMode', { required: true })
const thicknessExact = defineModel<number | undefined>('thicknessExact')
const thicknessMin = defineModel<number | undefined>('thicknessMin')
const thicknessMax = defineModel<number | undefined>('thicknessMax')

/** 页面提交时要求每条可见条件完整，不静默丢弃。 */
const usableFilters = computed<ThermalLookupFilter[]>(() => filters.value
  .filter(row => row.targetValue != null && Number.isFinite(row.targetValue))
  .map(row => ({ metric: row.metric, mode: row.mode, targetValue: Number(row.targetValue) })))

const previewText = computed(() => {
  const parts: string[] = []
  if (usableFilters.value.length > 0) {
    parts.push(thermalLookupConditionSummary(usableFilters.value))
  }
  if (thicknessMode.value === 'exact' && thicknessExact.value != null) {
    parts.push(`厚度 = ${thicknessExact.value} mm`)
  }
  if (thicknessMode.value === 'range') {
    const min = thicknessMin.value
    const max = thicknessMax.value
    if (min != null && max != null) {
      parts.push(`厚度 ${min}–${max} mm`)
    }
    else if (min != null) {
      parts.push(`厚度 ≥ ${min} mm`)
    }
    else if (max != null) {
      parts.push(`厚度 ≤ ${max} mm`)
    }
  }
  return parts.length > 0 ? parts.join(' 且 ') : '尚未填写任何条件'
})

function addRow(): void {
  if (filters.value.length >= THERMAL_CONDITION_MAX_ROWS) {
    MessagePlugin.warning(`最多支持 ${THERMAL_CONDITION_MAX_ROWS} 个条件`)
    return
  }
  const last = filters.value[filters.value.length - 1]
  const next: ThermalConditionDraft = last
    ? { metric: last.metric === 'K' ? 'TOTAL_R' : 'K', mode: last.metric === 'K' ? 'MIN_LIMIT' : 'MAX_LIMIT', targetValue: undefined }
    : createThermalConditionDraft()
  filters.value = [...filters.value, next]
}

function removeRow(index: number): void {
  if (filters.value.length <= 1) {
    filters.value = []
    return
  }
  filters.value = filters.value.filter((_, position) => position !== index)
}

function handleReset(): void {
  filters.value = [createThermalConditionDraft()]
  thicknessMode.value = 'any'
  thicknessExact.value = undefined
  thicknessMin.value = undefined
  thicknessMax.value = undefined
  emit('reset')
}

function handleSearch(): void {
  if (props.disabled || props.loading) {
    return
  }
  if (filters.value.some(row => row.targetValue == null || !Number.isFinite(row.targetValue))) {
    MessagePlugin.warning('请填写每条热工指标条件的数值；不需要的条件可删除')
    return
  }
  if (filters.value.some(row => row.targetValue! <= 0 || row.targetValue! > (row.metric === 'K' ? 10 : 100))) {
    MessagePlugin.warning('传热系数 K 须大于 0 且不超过 10；热阻须大于 0 且不超过 100')
    return
  }
  if (thicknessMode.value === 'exact' && thicknessExact.value == null) {
    MessagePlugin.warning('请填写精确厚度')
    return
  }
  const min = thicknessMin.value
  const max = thicknessMax.value
  if (thicknessMode.value === 'range' && min == null && max == null) {
    MessagePlugin.warning('请至少填写一个厚度范围边界')
    return
  }
  if ((thicknessMode.value === 'exact' && (thicknessExact.value! <= 0 || thicknessExact.value! > 1000))
    || (thicknessMode.value === 'range' && [min, max].some(value => value != null && (value <= 0 || value > 1000)))) {
    MessagePlugin.warning('厚度须大于 0 且不超过 1000 mm')
    return
  }
  if (thicknessMode.value === 'range' && min != null && max != null && min > max) {
    MessagePlugin.warning('厚度下限不能大于上限')
    return
  }
  const payload: ThermalConditionPayload = { filters: usableFilters.value }
  if (thicknessMode.value === 'exact' && thicknessExact.value != null) {
    payload.thicknessMm = thicknessExact.value
  }
  if (thicknessMode.value === 'range') {
    if (min != null) {
      payload.thicknessMin = min
    }
    if (max != null) {
      payload.thicknessMax = max
    }
  }
  if (payload.filters.length === 0 && payload.thicknessMm == null && payload.thicknessMin == null && payload.thicknessMax == null) {
    MessagePlugin.warning('请至少填写一个热工指标条件或厚度条件')
    return
  }
  emit('search', payload)
}

defineExpose({ usableFilters, previewText })
</script>

<template>
  <section class="thermal-condition">
    <div class="thermal-condition__rows">
      <p v-if="!filters.length" class="thermal-condition__hint">未添加热工指标条件，可只按厚度查询。</p>
      <div v-for="(row, index) in filters" :key="index" class="thermal-condition__row">
        <t-select
          v-model="row.metric"
          :disabled="disabled"
          :options="THERMAL_LOOKUP_METRIC_OPTIONS"
          style="width: 150px"
        />
        <t-select
          v-model="row.mode"
          :disabled="disabled"
          :options="THERMAL_LOOKUP_MODE_OPTIONS"
          style="width: 110px"
        />
        <t-input-number
          v-model="row.targetValue"
          :disabled="disabled"
          :max="row.metric === 'K' ? 10 : 100"
          :min="0"
          :step="0.01"
          placeholder="数值"
          theme="normal"
        />
        <span class="thermal-condition__unit">{{ thermalLookupMetricUnit(row.metric) }}</span>
        <t-button
          :disabled="disabled"
          size="small"
          theme="danger"
          variant="text"
          @click="removeRow(index)"
        >
          删除
        </t-button>
      </div>
      <div class="thermal-condition__actions">
        <t-button :disabled="disabled" size="small" variant="outline" @click="addRow">
          添加条件（同时满足）
        </t-button>
        <span class="thermal-condition__hint">多条条件之间为「同时满足」，最多 {{ THERMAL_CONDITION_MAX_ROWS }} 条</span>
      </div>
    </div>

    <div class="thermal-condition__thickness">
      <span class="thermal-condition__label">厚度</span>
      <t-radio-group v-model="thicknessMode" :disabled="disabled" size="small" variant="default-filled">
        <t-radio-button value="any">
          不限
        </t-radio-button>
        <t-radio-button value="exact">
          精确档
        </t-radio-button>
        <t-radio-button value="range">
          区间
        </t-radio-button>
      </t-radio-group>
      <t-input-number
        v-if="thicknessMode === 'exact'"
        v-model="thicknessExact"
        :disabled="disabled"
        :max="1000"
        :min="1"
        placeholder="mm"
        theme="normal"
      />
      <template v-if="thicknessMode === 'range'">
        <t-input-number
          v-model="thicknessMin"
          :disabled="disabled"
          :max="1000"
          :min="1"
          placeholder="下限 mm"
          theme="normal"
        />
        <span class="thermal-condition__separator">—</span>
        <t-input-number
          v-model="thicknessMax"
          :disabled="disabled"
          :max="1000"
          :min="1"
          placeholder="上限 mm"
          theme="normal"
        />
      </template>
    </div>

    <div class="thermal-condition__footer">
      <p class="thermal-condition__preview">
        生效条件：{{ previewText }}
      </p>
      <div class="thermal-condition__buttons">
        <t-button :disabled="loading" variant="outline" @click="handleReset">
          重置条件
        </t-button>
        <t-button :disabled="disabled" :loading="loading" theme="primary" @click="handleSearch">
          {{ searchLabel }}
        </t-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.thermal-condition {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}

.thermal-condition__rows {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
}

.thermal-condition__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.thermal-condition__unit {
  min-width: 76px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-condition__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-3);
}

.thermal-condition__hint {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-condition__thickness {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.thermal-condition__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-condition__separator {
  color: var(--td-text-color-secondary);
}

.thermal-condition__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding-top: var(--td-size-3);
  border-top: 1px solid var(--td-component-stroke);
}

.thermal-condition__preview {
  flex: 1 1 260px;
  min-width: 0;
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-condition__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
}
</style>
