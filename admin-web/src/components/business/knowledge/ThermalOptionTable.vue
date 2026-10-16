<script setup lang="ts">
import type { PrimaryTableCol, TableRowAttributes, TableRowData, TableRowspanAndColspanFunc } from 'tdesign-vue-next'
import type { KnowledgeConstructionContent, ReferenceHighlight, ThermalFieldKey } from '@/types/knowledge-page-render'
import type { KnowledgePageTableRow } from '@/utils/knowledge-construction-table'
import { computed, h } from 'vue'
import { formatRenderNumber, formatThermalNumber, optionHasWarning } from '@/utils/knowledge-page-render'
import { pageConstructionCellSpan, pageConstructionTableRows } from '@/utils/knowledge-construction-table'
import { constructionAttributes, constructionLabel, thermalColumnHeader, thermalGroupHeader } from '@/utils/knowledge-thermal-labels'

const props = withDefaults(defineProps<{
  construction?: KnowledgeConstructionContent
  constructions?: KnowledgeConstructionContent[]
  matches?: ReferenceHighlight[]
  activeOptionId?: string | null
  active?: ReferenceHighlight
}>(), { matches: () => [], activeOptionId: null })

const constructions = computed(() => props.constructions ?? (props.construction ? [props.construction] : []))
const data = computed(() => pageConstructionTableRows(constructions.value))
const hasWarnings = computed(() => constructions.value.some(construction => construction.options.some(optionHasWarning)))
function rowMatches(row: KnowledgePageTableRow): ReferenceHighlight[] {
  if (!row.construction.constructionId) return []
  return props.matches.filter(match => match.constructionId === row.construction.constructionId && (!match.optionId || (row.kind === 'option' && match.optionId === row.option.optionId)))
}
function optionCell(row: KnowledgePageTableRow, key: ThermalFieldKey): ReturnType<typeof h> | string {
  if (row.kind !== 'option') return ''
  return h('span', {
    class: { 'field-hit': rowMatches(row).some(match => match.fieldKeys?.includes(key)) },
    title: key === 'productThermalResistance' ? '产品层热阻 R' : undefined,
  }, key === 'thicknessMm' ? formatRenderNumber(row.option[key]) : formatThermalNumber(row.option[key]))
}
function heading(field: Parameters<typeof thermalColumnHeader>[1]) {
  return () => {
    const { label, unit } = thermalColumnHeader(constructions.value, field)
    return h('span', [label, unit ? h('small', unit) : null])
  }
}
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const result: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'constructionCode', title: '构造 / 原始标签', width: 190, align: 'center', className: 'construction-code', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      return h('div', [h('strong', constructionLabel(item.construction)), ...constructionAttributes(item.construction).map(text => h('small', text))])
    } },
    { colKey: 'name', title: '构造层', width: 220, className: 'construction-material', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      const name = item.layer?.name || item.construction.material?.name || '厚度档位'
      return h('div', [item.layer?.sourceGroupLabel ? h('small', item.layer.sourceGroupLabel) : null, item.layer?.sourceLayerLabel ? `${item.layer.sourceLayerLabel} · ${name}` : `${item.order != null ? `${item.order}. ` : ''}${name}`])
    } },
    { colKey: 'thicknessMm', title: heading('thicknessMm'), width: 95, align: 'center', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      return item.kind === 'option' ? optionCell(item, 'thicknessMm') : formatRenderNumber(item.layer?.thicknessMm)
    } },
    { colKey: 'lambda', title: heading('lambda'), width: 120, align: 'center', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      return formatThermalNumber(item.layer?.lambda ?? (item.kind === 'option' ? item.construction.material?.lambda : null))
    } },
    { colKey: 'alpha', title: heading('alpha'), width: 100, align: 'center', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      return formatThermalNumber(item.layer?.alpha ?? (item.kind === 'option' ? item.construction.material?.alpha : null), 2)
    } },
    { colKey: 'rValue', title: heading('rValue'), width: 110, align: 'center', cell: (_, { row }) => {
      const item = row as KnowledgePageTableRow
      return formatThermalNumber(item.kind === 'option'
        ? item.option.layerValues?.find(value => value.layerIndex === item.layerIndex)?.rValue
        : item.layer?.rValue)
    } },
    ...(constructions.value.some(section => section.options.some(option => option.productThermalResistance != null))
      ? [{ colKey: 'productThermalResistance', title: heading('productThermalResistance'), width: 150, align: 'center' as const, cell: (_: unknown, { row }: { row: TableRowData }) => optionCell(row as KnowledgePageTableRow, 'productThermalResistance') }]
      : []),
    { colKey: 'wallSection', title: thermalGroupHeader(constructions.value), align: 'center', children: [
      { colKey: 'totalThermalResistance', title: heading('totalThermalResistance'), width: 170, align: 'center', className: 'wall-section-value', cell: (_, { row }) => optionCell(row as KnowledgePageTableRow, 'totalThermalResistance') },
      { colKey: 'kValue', title: heading('kValue'), width: 150, align: 'center', className: 'wall-section-value', cell: (_, { row }) => optionCell(row as KnowledgePageTableRow, 'kValue') },
    ] },
  ]
  if (hasWarnings.value) result.push({ colKey: 'warning', title: '识别提示', width: 100, cell: (_, { row }) => {
    const item = row as KnowledgePageTableRow
    return item.kind === 'option' && optionHasWarning(item.option) ? h('span', { class: 'thermal-option-table__warning' }, '需校验') : ''
  } })
  return result
})
const spans: TableRowspanAndColspanFunc<TableRowData> = ({ row, rowIndex, col }) => pageConstructionCellSpan(row as KnowledgePageTableRow, rowIndex, col.colKey || '')
const rowAttributes: TableRowAttributes<TableRowData> = ({ row }) => {
  const item = row as KnowledgePageTableRow
  return {
    'data-row-kind': item.kind,
    ...(item.construction.constructionId ? { 'data-construction-id': item.construction.constructionId } : {}),
    ...(item.kind === 'option' && item.option.optionId ? { 'data-option-id': item.option.optionId } : {}),
  }
}
function rowClassName({ row, rowIndex }: { row: TableRowData, rowIndex: number }): string {
  const item = row as KnowledgePageTableRow
  const hit = rowMatches(item).length > 0
  const active = hit && (props.active
    ? props.active.constructionId === item.construction.constructionId && (!props.active.optionId || (item.kind === 'option' && props.active.optionId === item.option.optionId))
    : item.kind === 'option' && props.activeOptionId === item.option.optionId)
  return [hit ? 'is-hit' : '', active ? 'is-active' : '', rowIndex === item.constructionStart + item.constructionLength - 1 ? 'is-construction-end' : ''].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="thermal-option-table" tabindex="0" aria-label="构造热工表，可横向滚动">
    <t-table :data="data" :columns="columns" :rowspan-and-colspan="spans" row-key="viewerKey" :max-height="720" :style="{ minWidth: hasWarnings ? '1100px' : '1000px' }" table-content-width="100%" :row-attributes="rowAttributes" :row-class-name="rowClassName" vertical-align="middle" size="small" bordered />
  </div>
</template>

<style scoped>
.thermal-option-table { min-width: 0; overflow-x: auto; font-variant-numeric: tabular-nums; }
.thermal-option-table:focus-visible { outline: 2px solid var(--td-brand-color); outline-offset: 2px; }
.thermal-option-table :deep(th), .thermal-option-table :deep(td) { white-space: nowrap; }
.thermal-option-table :deep(.construction-material), .thermal-option-table :deep(.construction-code) { white-space: normal; overflow-wrap: anywhere; }
.thermal-option-table :deep(.construction-code) { font-weight: bold; }
.thermal-option-table :deep(th small) { display: block; font-weight: normal; }
.thermal-option-table :deep(td small) { display: block; font-weight: normal; color: var(--td-text-color-secondary); }
.thermal-option-table :deep(th) { white-space: normal; }
.thermal-option-table :deep(.is-hit td) { background: var(--td-warning-color-1); }
.thermal-option-table :deep(.is-active td) { border-bottom-color: var(--td-warning-color); }
/* 主断面两列呈现为贯穿构造的连续区域；保留单元格高度及档位定位。 */
.thermal-option-table :deep(tbody td.wall-section-value) { border-bottom-color: transparent; }
.thermal-option-table :deep(tbody .is-construction-end td) { border-bottom-color: var(--td-component-stroke); }
.thermal-option-table :deep(.field-hit) { background: var(--td-warning-color-2); color: var(--td-text-color-primary); font-weight: bold; border-radius: var(--td-radius-small); padding: var(--td-size-1); }
.thermal-option-table :deep(.thermal-option-table__warning) { color: var(--td-warning-color); }
</style>
