<script setup lang="ts">
import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import { computed, ref } from 'vue'
import { formatReferenceNumber, referenceSolutions } from '@/utils/referencePage'
import { thermalColumnHeader } from '@/utils/thermalSourceLabels'

const props = defineProps<{ page: AiReferencePage, limit?: number }>()
const emit = defineEmits<{ open: [match?: ReferenceHighlight] }>()
const solutions = computed(() => referenceSolutions(props.page).slice(0, props.limit))
const details = ref<Record<string, boolean>>({})
</script>

<template>
  <view class="solution-list">
    <view v-for="solution in solutions" :key="solution.key" class="solution">
      <view class="text-3.5 font-semibold">
        {{ solution.title }}
      </view>
      <view v-if="solution.system && solution.system !== solution.title" class="app-muted mt-1 text-3">
        {{ solution.system }}
      </view>
      <view v-if="solution.base" class="app-muted mt-1 text-3">
        {{ solution.base }}
      </view>
      <view class="solution__parameters">
        <view>
          <view class="app-muted text-2.5">
            保温层厚度
          </view>
          <view class="solution__value">
            {{ formatReferenceNumber(solution.option.thicknessMm) }}<text class="solution__unit">
              mm
            </text>
          </view>
        </view>
        <view>
          <view class="app-muted text-2.5">
            传热系数 K
          </view>
          <view class="solution__value">
            {{ formatReferenceNumber(solution.option.kValue, 3) }}
          </view>
          <view class="app-tertiary text-2.5">
            W/(m²·K)
          </view>
        </view>
      </view>
      <view v-if="details[solution.key] || page.primaryFieldKeys?.some(key => key === 'productThermalResistance' || key === 'totalThermalResistance')" class="solution__details text-3">
        <view>{{ thermalColumnHeader(solution.construction ? [solution.construction] : [], 'productThermalResistance').label }}：{{ formatReferenceNumber(solution.option.productThermalResistance, 3) }} (m²·K)/W</view>
        <view class="mt-1">
          {{ thermalColumnHeader(solution.construction ? [solution.construction] : [], 'totalThermalResistance').label }}：{{ formatReferenceNumber(solution.option.totalThermalResistance, 3) }} {{ thermalColumnHeader(solution.construction ? [solution.construction] : [], 'totalThermalResistance').unit }}
        </view>
      </view>
      <wd-button v-if="!page.primaryFieldKeys?.some(key => key === 'productThermalResistance' || key === 'totalThermalResistance')" size="small" variant="text" @click="details[solution.key] = !details[solution.key]">
        {{ details[solution.key] ? '收起热阻参数' : '查看热阻参数' }}
      </wd-button>
      <view class="solution__citation">
        <view class="app-muted text-2.5 leading-5">
          <view>来源：{{ page.page.documentTitle || '参考资料' }}{{ page.page.pageLabel ? ` · 第${page.page.pageLabel}页` : '' }}</view>
          <view v-if="page.page.docNumber">
            图集号：{{ page.page.docNumber }}
          </view>
        </view>
        <wd-button size="small" variant="text" custom-class="mt-1!" @click="emit('open', solution.match)">
          查看参考页
        </wd-button>
      </view>
    </view>
    <view v-if="!solutions.length" class="solution__citation">
      <view class="app-muted text-3">
        来源：{{ page.page.documentTitle || '参考资料' }}{{ page.page.pageLabel ? ` · 第${page.page.pageLabel}页` : '' }}
      </view>
      <wd-button size="small" variant="text" custom-class="mt-1!" @click="emit('open')">
        查看参考页
      </wd-button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.solution-list { margin: var(--app-space-3) 0; }
.solution + .solution { margin-top: var(--app-space-4); padding-top: var(--app-space-3); border-top: 1px solid var(--app-border-default); }
.solution__parameters { display: flex; gap: var(--app-space-5); margin: var(--app-space-2) 0; padding: var(--app-space-3); background: var(--app-action-primary-soft); border-radius: var(--app-radius-xs); }
.solution__value { color: var(--app-action-primary); font-size: var(--app-font-size-xl); line-height: var(--app-line-height-tight); font-weight: 700; font-variant-numeric: tabular-nums; margin-top: var(--app-space-1); }
.solution__unit { font-size: var(--app-font-size-sm); font-weight: 400; }
.solution__details { margin: var(--app-space-2) 0; }
.solution__citation { border-left: 2px solid var(--app-border-strong); background: var(--app-bg-canvas); padding: var(--app-space-2) var(--app-space-3); margin-top: var(--app-space-2); }
</style>
