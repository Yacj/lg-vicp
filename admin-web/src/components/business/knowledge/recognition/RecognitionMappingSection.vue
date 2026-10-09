<script setup lang="ts">
import type { RecognitionDraftOption, RecognitionDraftSystem } from '@/components/business/knowledge/recognition/types'
import type { ConstructionScheme } from '@/types/construction'
import type { ProductSpec } from '@/types/masterdata'
import type { RecognitionMappingCandidateState, RecognitionSelectOption } from '@/utils/knowledge-recognition'
import { buildSchemeOptions, buildSpecOptions } from '@/utils/knowledge-recognition'

/**
 * 正式数据映射：把 AI 识别出的构造 / 参考方案人工对到已发布的
 * 正式构造方案与正式产品规格，确认时随草稿一并提交。
 * 未映射时后端会按构造编号 / 厚度 / 规格类型自动匹配。
 */
const props = withDefaults(defineProps<{
  systems: RecognitionDraftSystem[]
  mappingState: RecognitionMappingCandidateState
  publishedSchemes?: ConstructionScheme[]
  publishedSpecs?: ProductSpec[]
  readonly?: boolean
}>(), {
  publishedSchemes: () => [],
  publishedSpecs: () => [],
  readonly: false,
})

const emit = defineEmits<{ change: [] }>()

function schemeOptions(system: RecognitionDraftSystem): RecognitionSelectOption[] {
  return buildSchemeOptions(system, props.mappingState, props.publishedSchemes)
}

function specOptions(system: RecognitionDraftSystem, option: RecognitionDraftOption): RecognitionSelectOption[] {
  return buildSpecOptions(system, option, props.mappingState, props.publishedSpecs)
}

function onSchemeChange(system: RecognitionDraftSystem, value: unknown): void {
  system.schemeId = typeof value === 'string' && value ? value : null
  // 构造方案变化后，原产品规格可能不再属于该方案，清空避免提交不兼容映射。
  for (const option of system.options) {
    option.productSpecId = null
    option.catalogProductId = null
  }
  emit('change')
}

function onSpecChange(option: RecognitionDraftOption, value: unknown): void {
  const id = typeof value === 'string' && value ? value : null
  option.productSpecId = id
  option.catalogProductId = id
    ? props.mappingState.productSpecCandidates.find(item => item.id === id)?.catalogProductId ?? null
    : null
  emit('change')
}
</script>

<template>
  <section class="recognition-mapping">
    <p class="recognition-mapping__hint">
      人工映射到已发布的正式构造方案与产品规格；不选则确认时按构造编号 / 厚度自动匹配。
    </p>

    <div
      v-for="(system, systemIndex) in systems"
      :key="systemIndex"
      class="recognition-mapping__block"
    >
      <div class="recognition-mapping__row">
        <span class="recognition-mapping__label">正式构造方案</span>
        <t-select
          :disabled="readonly"
          :model-value="system.schemeId ?? ''"
          :options="schemeOptions(system)"
          clearable
          filterable
          placeholder="请选择已发布的正式构造方案"
          @change="(value: unknown) => onSchemeChange(system, value)"
        />
        <span class="recognition-mapping__state">
          {{ system.schemeId ? '已映射到正式构造方案' : '未映射，确认时将按构造编号自动匹配' }}
        </span>
      </div>

      <div
        v-for="(option, optionIndex) in system.options"
        :key="`option-${optionIndex}`"
        class="recognition-mapping__row"
      >
        <span class="recognition-mapping__label">
          正式产品规格{{ option.thicknessMm != null ? ` · ${option.thicknessMm}mm` : '' }}
        </span>
        <t-select
          :disabled="readonly"
          :model-value="option.productSpecId ?? ''"
          :options="specOptions(system, option)"
          clearable
          filterable
          :placeholder="option.thicknessMm ? `请选择 ${option.thicknessMm}mm 对应的正式产品规格` : '请先填写厚度，再选择正式产品规格'"
          @change="(value: unknown) => onSpecChange(option, value)"
        />
        <span class="recognition-mapping__state">
          {{ option.productSpecId ? '已映射到正式产品规格' : '未映射，确认时将按厚度 / 规格类型自动匹配' }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.recognition-mapping {
  display: grid;
  gap: 10px;
}

.recognition-mapping__hint {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.recognition-mapping__block {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.recognition-mapping__row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.recognition-mapping__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.recognition-mapping__state {
  grid-column: 2;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}
</style>
