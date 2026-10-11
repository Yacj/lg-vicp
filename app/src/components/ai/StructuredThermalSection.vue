<script setup lang="ts">
import type { KnowledgeRenderConstruction, ReferenceHighlight } from '@/api/reference-page'
import { computed, ref } from 'vue'
import { formatReferenceNumber } from '@/utils/referencePage'
import ThermalOptionCard from './ThermalOptionCard.vue'

const props = withDefaults(defineProps<{ construction: KnowledgeRenderConstruction, matches: ReferenceHighlight[], active?: ReferenceHighlight, anchor: string, highlightEnabled?: boolean }>(), { highlightEnabled: true })
const allThicknesses = ref(false)
const fullConstruction = ref(false)
const ownedMatches = computed(() => props.matches.filter(match => match.constructionId === props.construction.constructionId))
const isHit = (optionId: string) => ownedMatches.value.some(match => match.optionId === optionId || !match.optionId)
const fieldKeys = (optionId: string) => [...new Set(ownedMatches.value.filter(match => match.optionId === optionId || !match.optionId).flatMap(match => match.fieldKeys || []))]
const visibleOptions = computed(() => props.construction.options.map((option, index) => ({ option, index })).filter(({ option, index }) => allThicknesses.value || isHit(option.optionId) || props.active?.optionId === option.optionId || (ownedMatches.value.length === 0 && index < 3)))
const hasHidden = computed(() => visibleOptions.value.length < props.construction.options.length)
</script>

<template>
  <view :id="anchor" class="thermal-section" :class="{ 'thermal-section--hit': highlightEnabled && ownedMatches.some(match => !match.optionId) }">
    <view class="text-4 font-bold">
      {{ construction.constructionCode || construction.title || '参考构造' }}
    </view>
    <view v-if="construction.systemName" class="app-muted mt-1 text-3">
      {{ construction.systemName }}
    </view>
    <view v-if="construction.material" class="mt-3">
      <view class="text-3.5 font-semibold">
        {{ construction.material.name }}
      </view>
      <view class="app-muted mt-1 text-3">
        导热系数 λ：{{ formatReferenceNumber(construction.material.lambda) }} W/(m·K) · 修正系数 α：{{ formatReferenceNumber(construction.material.alpha) }}
      </view>
    </view>
    <wd-button v-if="construction.layers.length" size="small" plain custom-class="mt-3!" @click="fullConstruction = !fullConstruction">
      {{ fullConstruction ? '收起构造层' : '查看完整构造' }}
    </wd-button>
    <view v-if="fullConstruction" class="mt-3 space-y-2">
      <view v-for="(layer, index) in construction.layers" :key="layer.layerId || index" class="thermal-layer text-3">
        <view class="font-medium">
          {{ layer.order ?? index + 1 }}. {{ layer.name }}
        </view>
        <view class="app-muted mt-1 leading-5">
          {{ layer.variable ? '厚度及产品层热阻见下方全部档位' : `厚度 ${formatReferenceNumber(layer.thicknessMm)} mm · 热阻 R ${formatReferenceNumber(layer.rValue, 3)}` }}
        </view>
        <view class="app-muted mt-1 leading-5">
          λ {{ formatReferenceNumber(layer.lambda) }} · α {{ formatReferenceNumber(layer.alpha) }}
        </view>
      </view>
    </view>
    <view class="mt-3 space-y-2">
      <view v-for="item in visibleOptions" :id="`${anchor}-option-${item.index}`" :key="item.option.optionId">
        <ThermalOptionCard :option="item.option" :highlighted="highlightEnabled && isHit(item.option.optionId)" :active="active?.constructionId === construction.constructionId && active.optionId === item.option.optionId" :field-keys="highlightEnabled ? fieldKeys(item.option.optionId) : []" />
      </view>
    </view>
    <wd-button v-if="hasHidden || allThicknesses" size="small" plain custom-class="mt-3!" @click="allThicknesses = !allThicknesses">
      {{ allThicknesses ? '收起其他厚度' : `查看其他厚度（共 ${construction.options.length} 档）` }}
    </wd-button>
    <view v-for="(note, index) in construction.notes" :key="index" class="app-muted mt-3 text-3 leading-5">
      {{ note }}
    </view>
    <view v-if="construction.warnings?.length" class="app-muted mt-3 text-3 leading-5">
      构造参数需要核对，请以原始页面为准。
    </view>
  </view>
</template>

<style scoped lang="scss">
.thermal-section { padding: var(--app-space-4) 0; border-bottom: 1px solid var(--app-border-default); }
.thermal-section--hit { border-left: 2px solid var(--app-action-primary); padding-left: var(--app-space-3); }
.thermal-layer { border-left: 2px solid var(--app-border-default); padding-left: var(--app-space-2); }
</style>
