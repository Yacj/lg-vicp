<script setup lang="ts">
import { computed, ref } from 'vue'
import ThermalPageTable from '@/components/ai/ThermalPageTable.vue'
import fixtures from '@/test/fixtures/sourceTableHeaders.json'
definePage({ name: 'reference-table', style: { navigationBarTitleText: '客户原表头核对' } })
const index = ref(0)
const fullscreen = ref(false)
const enabled = ref(true)
const fixture = computed(() => fixtures[index.value]!)
const constructions = computed(() => fixture.value.renderModel!.constructions)
const active = computed(() => {
  const group = constructions.value[0]!
  const option = group.options.find(item => item.thicknessMm === (index.value === 0 ? 45 : 20)) || group.options[0]!
  return { constructionId: group.constructionId, optionId: option.optionId, fieldKeys: ['productThermalResistance', 'thicknessMm', 'totalThermalResistance', 'kValue'] as const }
})
</script>
<template>
  <view style="padding: 12px; box-sizing: border-box; width: 100%">
    <view style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button v-for="(item, i) in fixtures" :key="i" size="mini" @click="index=i">原表{{ item.physicalPageNumber }}</button>
      <button size="mini" @click="fullscreen=!fullscreen">{{ fullscreen ? '退出全屏' : '全屏看表格' }}</button>
      <button size="mini" @click="enabled=!enabled">{{ enabled ? '取消高亮' : '恢复高亮' }}</button>
    </view>
    <view v-if="!fullscreen" style="font-size:18px;font-weight:600;margin:12px 0">{{ fixture.renderModel!.pageTitle }}</view>
    <view :class="{ 'audit-fullscreen': fullscreen }">
      <view v-if="fullscreen" style="height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 10px"><text>原表{{ fixture.physicalPageNumber }} · 完整表格</text><button size="mini" @click="fullscreen=false">退出全屏</button></view>
      <ThermalPageTable :constructions="constructions as any" :matches="[active] as any" :active="active as any" :highlight-enabled="enabled" :viewport-height="fullscreen ? 700 : undefined" anchor-prefix="audit" />
    </view>
  </view>
</template>
<style>
.audit-fullscreen { position:fixed;inset:0;background:var(--app-bg-surface);z-index:99;width:100%;overflow:hidden; }
</style>
