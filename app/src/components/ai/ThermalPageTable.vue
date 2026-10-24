<script setup lang="ts">
import type { KnowledgeRenderConstruction, ReferenceHighlight, ThermalFieldKey } from '@/api/reference-page'
import type { ThermalTableRow } from '@/utils/thermalPageTable'
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue'
import { readableReferenceAnnotations } from '@/utils/referenceAnnotations'
import { formatReferenceNumber } from '@/utils/referencePage'
import { thermalConstructionRows, thermalLayerValue, thermalSourceResistance } from '@/utils/thermalPageTable'
import { constructionAttributes, constructionDiagramNotes, constructionLabel, hasSharedSourceResistance, sourceHeaderNotice, sourceTableHeader, thermalColumnHeader, thermalGroupHeader } from '@/utils/thermalSourceLabels'

defineOptions({ options: { virtualHost: true } })
const props = withDefaults(defineProps<{ constructions: KnowledgeRenderConstruction[], matches: ReferenceHighlight[], active?: ReferenceHighlight, highlightEnabled?: boolean, anchorPrefix?: string, viewportHeight?: number }>(), { highlightEnabled: true, anchorPrefix: 'reference' })
const instance = getCurrentInstance()
const headerHeight = ref(0)
async function measureHeader() {
  if (!props.viewportHeight)
    return
  await nextTick()
  uni.createSelectorQuery().in(instance?.proxy).select('.thermal-table__head-scroll').boundingClientRect((rect) => {
    if (rect && !Array.isArray(rect) && typeof rect.height === 'number')
      headerHeight.value = rect.height
  }).exec()
}
onMounted(measureHeader)
watch(() => props.viewportHeight, measureHeader, { flush: 'post' })
const anchor = (constructionIndex: number, optionIndex?: number) => `${props.anchorPrefix}-construction-${constructionIndex}${optionIndex == null ? '' : `-option-${optionIndex}`}`
const groups = computed(() => props.constructions.map((construction, index) => {
  const label = constructionLabel(construction)
  const system = construction.systemName?.trim() || ''
  return { construction, index, label, attributes: constructionAttributes(construction), system: system !== label && system !== construction.title?.trim() ? system : '', diagramNotes: constructionDiagramNotes(construction), rows: thermalConstructionRows(construction) }
}))
const column = (field: Parameters<typeof thermalColumnHeader>[1]) => thermalColumnHeader(props.constructions, field)
const groupHeader = computed(() => thermalGroupHeader(props.constructions))
const headerNotice = computed(() => sourceHeaderNotice(props.constructions))
const sharedResistance = computed(() => hasSharedSourceResistance(props.constructions))
const bodyHeight = computed(() => props.viewportHeight
  ? `${Math.max(1, props.viewportHeight - headerHeight.value)}px`
  : `min(60vh, ${Math.max(1, groups.value.reduce((count, group) => count + Math.max(1, group.rows.length), 0)) * 34 + groups.value.length}px)`)
const activeAnchor = computed(() => {
  const group = groups.value.find(item => item.construction.constructionId === props.active?.constructionId)
  if (!group)
    return ''
  const index = group.construction.options.findIndex(option => option.optionId === props.active?.optionId)
  return anchor(group.index, index >= 0 ? index : undefined)
})
const scrollLeft = ref(0)
const scrollTarget = ref('')
onMounted(() => {
  scrollTarget.value = activeAnchor.value
})
watch(activeAnchor, (target) => {
  scrollTarget.value = target
})
function syncScroll(event: { detail: { scrollLeft: number } }) {
  if (Math.abs(scrollLeft.value - event.detail.scrollLeft) > 1)
    scrollLeft.value = event.detail.scrollLeft
}
watch(() => `${props.active?.constructionId || ''}:${props.active?.optionId || ''}`, () => {
  scrollLeft.value = props.active?.optionId && props.active.fieldKeys?.some(key => key === 'kValue' || key === 'totalThermalResistance') ? 10000 : 0
}, { immediate: true })
const showAttributes = ref(false)
const showDiagram = ref(false)
const hasDiagramNotes = computed(() => groups.value.some(group => group.diagramNotes.length))
const hasDiagram = computed(() => hasDiagramNotes.value && showDiagram.value)
const hasProduct = computed(() => !sharedResistance.value && props.constructions.some(group => group.options.some(option => option.productThermalResistance != null)))
const fields = computed<ThermalFieldKey[]>(() => ['thicknessMm', ...(hasProduct.value ? ['productThermalResistance' as const] : []), 'totalThermalResistance', 'kValue'])
const layout = computed(() => {
  const material = hasDiagram.value ? 3 : 2
  const rValue = material + 4
  const totalThermalResistance = rValue + (hasProduct.value ? 2 : 1)
  return { material, thicknessMm: material + 1, lambda: material + 2, alpha: material + 3, rValue, productThermalResistance: rValue + 1, totalThermalResistance, kValue: totalThermalResistance + 1 }
})
const tableStyle = computed(() => ({
  '--thermal-table-width': `max(100%, ${845 + (hasProduct.value ? 115 : 0) + (hasDiagram.value ? 230 : 0)}px)`,
  '--thermal-table-columns': ['100fr', ...(hasDiagram.value ? ['230fr'] : []), '190fr', '75fr', '90fr', '70fr', '90fr', ...(hasProduct.value ? ['115fr'] : []), '120fr', '110fr'].join(' '),
}))
const headingPosition = (column: number) => ({ gridColumn: String(column), gridRow: '1 / span 2' })
// UniApp 的 scroll-into-view 同时调整 X/Y，锚定真实指标格，避免定位时把 K 列滚回左侧。
const anchorField = computed(() => (['kValue', 'totalThermalResistance', 'productThermalResistance', 'thicknessMm'] as ThermalFieldKey[]).find(field => props.active?.fieldKeys?.includes(field)) || 'thicknessMm')
const ownedMatches = (construction: KnowledgeRenderConstruction, row: ThermalTableRow) => props.matches.filter(match => match.constructionId === construction.constructionId && (!match.optionId || match.optionId === row.option?.optionId))
const isHit = (construction: KnowledgeRenderConstruction, row: ThermalTableRow) => props.highlightEnabled && ownedMatches(construction, row).length > 0
const fieldHit = (construction: KnowledgeRenderConstruction, row: ThermalTableRow, field: ThermalFieldKey) => isHit(construction, row) && ownedMatches(construction, row).some(match => match.fieldKeys?.includes(field))
const cellPosition = (column: number, start: number, length = 1) => ({ gridColumn: String(column), gridRow: `${start + 1} / span ${length}` })
const value = (row: ThermalTableRow, field: ThermalFieldKey) => formatReferenceNumber(field === 'thicknessMm' ? thermalLayerValue(row, field) : row.option?.[field], field === 'thicknessMm' ? undefined : 3)
</script>

<template>
  <view class="thermal-table-scroll" :style="[tableStyle, viewportHeight ? { height: `${viewportHeight}px` } : {}]" role="table" aria-label="完整构造热工表，可左右滑动">
    <view v-if="!viewportHeight" class="thermal-table__attributes">
      <view v-if="constructions.some(item => item.layers.some(layer => !layer.sourceRegion || layer.sourceRegion === 'UNKNOWN'))" class="mb-2">
        部分材料行的来源区域尚未核对，请结合原图查看。
      </view>
      <text class="app-primary-text" @click="showAttributes = !showAttributes">
        {{ showAttributes ? '收起构造属性' : '查看构造属性（型号、基层及屋面做法）' }}
      </text>
      <view v-for="group in showAttributes ? groups : []" :key="group.construction.constructionId" class="mt-2">
        {{ group.label }} · {{ [group.system, ...group.attributes].filter(Boolean).join(' · ') || '暂无附加属性' }}
      </view>
    </view>
    <scroll-view scroll-x :scroll-left="scrollLeft" class="thermal-table__scroll thermal-table__head-scroll" @scroll="syncScroll">
      <view v-if="headerNotice" class="thermal-table__attributes">
        {{ headerNotice }}
      </view>
      <view v-if="hasDiagramNotes" class="thermal-table__attributes">
        <text class="app-primary-text" @click="showDiagram = !showDiagram">
          {{ showDiagram ? '收起构造简图说明' : '展开构造简图说明' }}
        </text><text> · 左右滑动查看全部列</text>
      </view>
      <view class="thermal-table">
        <view class="thermal-table__header" role="rowgroup">
          <view class="thermal-table__cell thermal-table__heading thermal-table__code-heading" style="grid-column: 1; grid-row: 1 / span 2">
            {{ sourceTableHeader(constructions, 'identifier') }}
          </view>
          <view v-if="hasDiagram" class="thermal-table__cell thermal-table__heading" :style="headingPosition(2)">
            {{ sourceTableHeader(constructions, 'diagram') }}
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.material)">
            {{ sourceTableHeader(constructions, 'layers') }}
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.thicknessMm)">
            {{ column('thicknessMm').label }}<text>{{ column('thicknessMm').unit }}</text>
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.lambda)">
            {{ column('lambda').label }}<text>{{ column('lambda').unit }}</text>
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.alpha)">
            {{ column('alpha').label }}
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.rValue)">
            {{ column('rValue').label }}<text>{{ column('rValue').unit }}</text>
          </view>
          <view v-if="hasProduct" class="thermal-table__cell thermal-table__heading" :style="headingPosition(layout.productThermalResistance)">
            {{ column('productThermalResistance').label }}<text>{{ column('productThermalResistance').unit }}</text>
          </view>
          <view v-if="groupHeader" class="thermal-table__cell thermal-table__heading" :style="{ gridColumn: `${layout.totalThermalResistance} / span 2`, gridRow: '1' }">
            {{ groupHeader }}
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="{ gridColumn: String(layout.totalThermalResistance), gridRow: groupHeader ? '2' : '1 / span 2' }">
            {{ column('totalThermalResistance').label }}<text>{{ column('totalThermalResistance').unit }}</text>
          </view>
          <view class="thermal-table__cell thermal-table__heading" :style="{ gridColumn: String(layout.kValue), gridRow: groupHeader ? '2' : '1 / span 2' }">
            {{ column('kValue').label }}<text>{{ column('kValue').unit }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
    <scroll-view scroll-x scroll-y :scroll-left="scrollLeft" :scroll-into-view="scrollTarget" class="thermal-table__scroll thermal-table__body-scroll" :style="{ height: bodyHeight }" @scroll="syncScroll">
      <view v-if="!groups.length" class="thermal-table__cell">
        暂无热工表，请查看原始页面。
      </view>
      <view v-for="group in groups" :id="anchor(group.index)" :key="group.construction.constructionId" class="thermal-table__body" :style="{ gridTemplateRows: `repeat(${Math.max(1, group.rows.length)}, minmax(34px, auto))` }" role="rowgroup">
        <view class="thermal-table__cell thermal-table__code" :style="cellPosition(1, 0, Math.max(1, group.rows.length))">
          <text>{{ group.label }}</text>
        </view>
        <view v-if="hasDiagram" class="thermal-table__cell thermal-table__diagram" :style="cellPosition(2, 0, Math.max(1, group.rows.length))">
          <text class="app-muted">
            文字说明；简图请查看原始页面
          </text>
          <text v-for="(note, noteIndex) in group.diagramNotes" :key="noteIndex">
            {{ note }}
          </text>
        </view>
        <template v-for="(row, rowIndex) in group.rows" :key="row.key">
          <view class="thermal-table__row-marker" :class="{ 'thermal-table__row--hit': isHit(group.construction, row), 'thermal-table__row--active': highlightEnabled && active?.constructionId === group.construction.constructionId && active.optionId === row.option?.optionId }" :style="{ gridColumn: '1 / -1', gridRow: String(rowIndex + 1) }" />
          <template v-if="!row.option || rowIndex === row.groupStart">
            <view class="thermal-table__cell thermal-table__material" :style="cellPosition(layout.material, rowIndex, row.groupLength)">
              {{ row.layer?.sourceLayerLabel ? `${row.layer.sourceLayerLabel}. ` : row.order != null ? `${row.order}. ` : '' }}{{ row.layer?.sourceGroupLabel ? `${row.layer.sourceGroupLabel} · ` : '' }}{{ row.layer?.name || group.construction.material?.name || '厚度档位' }}
            </view>
            <view class="thermal-table__cell" :style="cellPosition(layout.lambda, rowIndex, row.groupLength)">
              {{ formatReferenceNumber(row.layer?.lambda ?? (row.option ? group.construction.material?.lambda : null), 3) }}
            </view>
            <view class="thermal-table__cell" :style="cellPosition(layout.alpha, rowIndex, row.groupLength)">
              {{ formatReferenceNumber(row.layer?.alpha ?? (row.option ? group.construction.material?.alpha : null), 2) }}
            </view>
          </template>
          <view :id="sharedResistance && row.option && anchorField === 'productThermalResistance' ? anchor(group.index, row.optionIndex) : undefined" class="thermal-table__cell" :style="cellPosition(layout.rValue, rowIndex)">
            <text :class="{ 'thermal-table__field--hit': sharedResistance && fieldHit(group.construction, row, 'productThermalResistance') }">
              {{ formatReferenceNumber(thermalSourceResistance(row, sharedResistance), 3) }}
            </text>
          </view>
          <view v-for="field in fields" :id="row.option && field === anchorField ? anchor(group.index, row.optionIndex) : undefined" :key="field" class="thermal-table__cell" :class="{ 'thermal-table__wall': field === 'totalThermalResistance' || field === 'kValue', 'thermal-table__last': rowIndex === group.rows.length - 1 }" :style="cellPosition(layout[field], rowIndex)">
            <text :class="{ 'thermal-table__field--hit': fieldHit(group.construction, row, field) }">
              {{ row.option || field === 'thicknessMm' ? value(row, field) : '' }}
            </text>
            <text v-if="field === 'kValue' && readableReferenceAnnotations(row.option?.warnings).length" class="app-warning text-2.5">
              需核对
            </text>
          </view>
        </template>
        <view v-if="!group.rows.length" class="thermal-table__cell" style="grid-column: 2 / -1; grid-row: 1">
          暂无构造参数，请查看原始页面。
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.thermal-table-scroll {
  // 固定上限控制宽屏列宽，rpx 使窄屏更紧凑；八列保留可读的最小宽度。
  width: 100%;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  font-size: clamp(12px, 26rpx, 13px);
  color: var(--app-text-primary);
}
.thermal-table__attributes { padding: var(--app-space-2); font-size: var(--app-font-size-sm); color: var(--app-text-secondary); }
.thermal-table__diagram { align-items: flex-start; justify-content: center; white-space: normal; line-height: 1.6; gap: var(--app-space-1); }
.thermal-table__head-scroll { flex-shrink: 0; }
.thermal-table__scroll { width: 100%; min-width: 0; }
.thermal-table__scroll :deep(.uni-scroll-view::-webkit-scrollbar) { display: none; width: 0; height: 0; }
.thermal-table { width: var(--thermal-table-width); }
.thermal-table__header, .thermal-table__body { display: grid; width: var(--thermal-table-width); grid-template-columns: var(--thermal-table-columns); border-left: 1px solid var(--app-border-default); }
.thermal-table__header { width: 100%; }
.thermal-table__header { position: sticky; top: 0; z-index: 3; background: var(--app-bg-canvas); }
.thermal-table__cell { min-width: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: min(8rpx, 4px); border-right: 1px solid var(--app-border-default); border-bottom: 1px solid var(--app-border-default); box-sizing: border-box; white-space: nowrap; position: relative; z-index: 1; }
.thermal-table__heading { min-height: min(64rpx, 32px); font-weight: 600; white-space: normal; overflow-wrap: anywhere; text-align: center; line-height: 1.45; }
.thermal-table__heading text { color: var(--app-text-tertiary); font-weight: 400; font-size: 11px; white-space: nowrap; }
.thermal-table__code-heading { position: sticky; left: 0; z-index: 4; background: var(--app-bg-canvas); }
.thermal-table__code { position: sticky; left: 0; z-index: 2; background: var(--app-bg-surface); font-weight: 600; white-space: normal; text-align: center; }
.thermal-table__material { align-items: flex-start; white-space: normal; overflow-wrap: anywhere; }
.thermal-table__body { border-bottom: 1px solid var(--app-border-strong); }
.thermal-table__wall { border-bottom-color: transparent; }
.thermal-table__last { border-bottom-color: var(--app-border-strong); }
.thermal-table__row-marker { pointer-events: none; z-index: 0; }
.thermal-table__row--hit { background: var(--app-warning-soft); }
.thermal-table__row--active { box-shadow: inset 0 -2px var(--app-warning); }
.thermal-table__field--hit { font-weight: 700; color: var(--app-action-primary); background: var(--app-bg-surface); border-radius: var(--app-radius-xs); padding: 0 var(--app-space-1); }
</style>
