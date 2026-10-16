<script setup lang="ts">
import type { RecognitionDraftOption, RecognitionDraftSystem } from './types'
import type { PageRecognitionLayerValue, PageRecognitionSourceColumn } from '@/types/knowledge'

defineProps<{ readonly: boolean }>()
const system = defineModel<RecognitionDraftSystem>('system', { required: true })
const fields = [
  { value: 'thicknessMm', label: '档位厚度' },
  { value: 'lambda', label: '导热系数' },
  { value: 'alpha', label: '修正系数' },
  { value: 'rValue', label: '材料层热阻' },
  { value: 'productThermalResistance', label: '完整产品热阻' },
  { value: 'totalThermalResistance', label: '整构造传热阻' },
  { value: 'kValue', label: '传热系数' },
]
const scopes = [{ value: 'LAYER', label: '材料层' }, { value: 'PRODUCT', label: '完整产品' }, { value: 'CONSTRUCTION', label: '整构造' }, { value: 'UNKNOWN', label: '待核验' }]
const optionFields = ['thicknessMm', 'productThermalResistance', 'totalThermalResistance', 'kValue'] as const
function columnText(column: PageRecognitionSourceColumn, key: 'groupLabel' | 'symbol' | 'unit', value: string): void {
  column[key] = value || null
}
function rawNumber(option: RecognitionDraftOption, key: typeof optionFields[number], value: string): void {
  option.fieldEvidence = { ...option.fieldEvidence, [key]: value || null }
}
function layerNumber(value: PageRecognitionLayerValue, field: 'thicknessMm' | 'rValue', input: number | string): void {
  value[field] = input === '' ? null : Number(input)
}
function addLayerValue(option: RecognitionDraftOption, index: unknown): void {
  if (typeof index !== 'number' || !Number.isInteger(index) || !system.value.layers[index] || option.layerValues?.some(value => value.layerIndex === index)) {
    return
  }
  option.layerValues = [...(option.layerValues ?? []), { layerIndex: index }]
}
function addColumn(): void {
  system.value.sourceColumns = [...(system.value.sourceColumns ?? []), { fieldKey: 'thicknessMm', label: '', scope: 'UNKNOWN' }]
}
function updateDiagramNotes(text: string): void {
  system.value.diagramNotes = text.split('\n').filter(line => line.trim())
}
</script>

<template>
  <details class="recognition-evidence">
    <summary>原表栏目与逐档证据</summary>
    <p>逐字核对原图。材料层、芯层和完整产品的热阻不能互填；原图没有的值留空，不补算。仅核对资料不会选定方案。</p>
    <div class="recognition-evidence__column">
      <label v-for="(label, key) in { identifier: '编号栏原表头', diagram: '简图栏原表头', layers: '材料栏原表头' }" :key="key">{{ label }}<t-input :model-value="system.sourceTableHeaders?.[key] || ''" :disabled="readonly" @update:model-value="system.sourceTableHeaders = { ...system.sourceTableHeaders, [key]: $event || undefined }" /></label>
    </div>
    <label>构造简图文字说明（每行一条，与热工表材料行分开）<t-textarea :model-value="(system.diagramNotes || []).join('\n')" :disabled="readonly" @update:model-value="updateDiagramNotes" /></label>
    <div v-for="(column, index) in system.sourceColumns" :key="index" class="recognition-evidence__column">
      <label>工程字段<t-select v-model="column.fieldKey" :options="fields" :disabled="readonly" /></label>
      <label>原列名称<t-input v-model="column.label" :disabled="readonly" /></label>
      <label>原表组名<t-input :model-value="column.groupLabel || ''" :disabled="readonly" @update:model-value="columnText(column, 'groupLabel', $event)" /></label>
      <label>原符号<t-input :model-value="column.symbol || ''" :disabled="readonly" @update:model-value="columnText(column, 'symbol', $event)" /></label>
      <label>原单位<t-input :model-value="column.unit || ''" :disabled="readonly" @update:model-value="columnText(column, 'unit', $event)" /></label>
      <label>指标对象<t-select v-model="column.scope" :options="scopes" :disabled="readonly" /></label>
      <t-button v-if="!readonly" variant="text" theme="danger" @click="system.sourceColumns?.splice(index, 1)">
        删除栏目
      </t-button>
    </div>
    <t-button v-if="!readonly" variant="outline" size="small" @click="addColumn">
      新增来源栏目
    </t-button>
    <details v-for="(layer, index) in system.layers" :key="`layer-${index}`" class="recognition-evidence__row">
      <summary>{{ layer.name }}：原表层标签</summary>
      <label>来源区域<t-select v-model="layer.sourceRegion" :disabled="readonly" :options="[{ label: '热工表构造层', value: 'THERMAL_TABLE' }, { label: '构造简图说明（不进入热工表）', value: 'DIAGRAM' }, { label: '来源待核对', value: 'UNKNOWN' }]" placeholder="旧资料尚未核对来源区域" /></label>
      <label>印刷层标签<t-input v-model="layer.sourceLayerLabel" :disabled="readonly" /></label>
      <label>合并单元格父标签<t-input v-model="layer.sourceGroupLabel" :disabled="readonly" /></label>
    </details>
    <details v-for="(option, index) in system.options" :key="`option-${index}`" class="recognition-evidence__row">
      <summary>{{ option.thicknessMm ?? '待核' }} mm：原文数字及材料层档位</summary>
      <label>原表行标签<t-input :model-value="option.sourceRowLabel || ''" :disabled="readonly" @update:model-value="option.sourceRowLabel = $event || null" /></label>
      <label v-for="field in optionFields" :key="field">{{ fields.find(item => item.value === field)?.label }}原文数字
        <t-input :model-value="option.fieldEvidence?.[field] || ''" :disabled="readonly" placeholder="原图无独立数值时留空" @update:model-value="rawNumber(option, field, $event)" />
      </label>
      <div v-for="(value, valueIndex) in option.layerValues" :key="valueIndex" class="recognition-evidence__column">
        <label>所属材料层<t-select v-model="value.layerIndex" :disabled="readonly" :options="system.layers.map((layer, i) => ({ label: `${i + 1}. ${layer.name}`, value: i }))" /></label>
        <label>层厚度 mm<t-input-number :model-value="value.thicknessMm ?? undefined" :disabled="readonly" :min="0" @change="layerNumber(value, 'thicknessMm', $event)" /></label>
        <label>厚度原文<t-input :model-value="value.thicknessText || ''" :disabled="readonly" @update:model-value="value.thicknessText = $event || null" /></label>
        <label>层自身热阻<t-input-number :model-value="value.rValue ?? undefined" :disabled="readonly" :min="0" @change="layerNumber(value, 'rValue', $event)" /></label>
        <label>层热阻原文<t-input :model-value="value.rValueText || ''" :disabled="readonly" @update:model-value="value.rValueText = $event || null" /></label>
        <t-button v-if="!readonly" variant="text" theme="danger" @click="option.layerValues?.splice(valueIndex, 1)">
          删除层档位
        </t-button>
      </div>
      <label v-if="!readonly">添加材料层档位<t-select placeholder="请选择原图对应层" :options="system.layers.map((layer, i) => ({ label: `${i + 1}. ${layer.name}`, value: i }))" @change="addLayerValue(option, $event)" /></label>
    </details>
  </details>
</template>

<style scoped>
.recognition-evidence { margin-top: var(--td-size-4); border-top: 1px solid var(--td-component-stroke); padding-top: var(--td-size-3); }
summary { cursor: pointer; color: var(--td-brand-color); }
p { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
label { display: grid; gap: var(--td-size-1); color: var(--td-text-color-secondary); min-width: 0; font-size: var(--td-font-size-body-small); }
.recognition-evidence__column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--td-size-2); margin-bottom: var(--td-size-3); }
.recognition-evidence__row { margin-block: var(--td-size-3); }
.recognition-evidence__row > label { margin-block: var(--td-size-2); }
</style>
