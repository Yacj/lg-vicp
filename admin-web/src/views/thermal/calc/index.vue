<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppPage from '@/components/ui/AppPage.vue'
import { fetchPublishedConstructionSchemes } from '@/api/modules/construction'
import { fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { executeThermalCalc } from '@/api/modules/thermal'
import { useAppFeedback } from '@/composables/useAppFeedback'
import type { ConstructionScheme } from '@/types/construction'
import type { ProductSpec } from '@/types/masterdata'
import type { ThermalCalcExecution, ThermalCalcMode, ThermalCalcRecord } from '@/types/thermal'
import {
  THERMAL_CALC_MODE_OPTIONS,
  thermalCalcConclusion,
  thermalCalcFormulaLines,
  thermalCalcModeLabel,
  thermalCalcStepLines,
} from '@/utils/thermal-calc'

const route = useRoute()
const feedback = useAppFeedback()

const form = reactive({
  mode: 'REFERENCE_TABLE' as ThermalCalcMode,
  schemeId: '',
  productSpecId: '',
  thicknessMm: 50,
  regionCode: '',
  projectId: typeof route.query.projectId === 'string' ? route.query.projectId : '',
})

const schemes = ref<ConstructionScheme[]>([])
const specs = ref<ProductSpec[]>([])
const submitting = ref(false)
const execution = ref<ThermalCalcExecution | null>(null)

const schemeOptions = computed(() => schemes.value.map(item => ({ label: item.name, value: item.id })))
const specOptions = computed(() => specs.value.map(item => ({
  label: `${item.specCode}（${item.thicknessMm}mm）`,
  value: item.id,
})))
const record = computed<ThermalCalcRecord | null>(() => execution.value?.record ?? null)

async function loadOptions(): Promise<void> {
  try {
    const [schemePage, specPage] = await Promise.all([
      fetchPublishedConstructionSchemes({}),
      fetchPublishedProductSpecs({}),
    ])
    schemes.value = schemePage.items
    specs.value = specPage.items
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
}

async function runCalc(): Promise<void> {
  if (!form.schemeId || !form.productSpecId) {
    await feedback.message('warning', '请选择构造方案和产品规格')
    return
  }
  submitting.value = true
  try {
    execution.value = await executeThermalCalc({
      mode: form.mode,
      productSpecId: form.productSpecId,
      schemeId: form.schemeId,
      thicknessMm: form.thicknessMm,
      ...(form.regionCode.trim() ? { regionCode: form.regionCode.trim() } : {}),
      ...(form.projectId.trim() ? { projectId: form.projectId.trim() } : {}),
    })
    if (!execution.value.valid) {
      await feedback.message('warning', execution.value.errors.map(item => item.message).join('；') || '计算未通过')
    }
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
  finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadOptions()
})
</script>

<template>
  <AppPage
    description="输入 Backend 已支持参数后执行计算。热工计算独立于产品对比，不作为对比前置步骤。核心计算由热工引擎完成，本页只展示公式、过程、结果与结论。"
    title="热工计算"
  >
    <t-card title="计算参数">
      <t-form label-width="120px">
        <t-form-item label="计算模式">
          <t-radio-group v-model="form.mode" :options="THERMAL_CALC_MODE_OPTIONS" />
        </t-form-item>
        <t-form-item label="构造方案">
          <t-select v-model="form.schemeId" :options="schemeOptions" placeholder="请选择已发布构造方案" />
        </t-form-item>
        <t-form-item label="产品规格">
          <t-select v-model="form.productSpecId" :options="specOptions" placeholder="请选择已发布产品规格" />
        </t-form-item>
        <t-form-item label="厚度 (mm)">
          <t-input-number v-model="form.thicknessMm" :min="1" :step="1" theme="column" />
        </t-form-item>
        <t-form-item label="地区编码">
          <t-input v-model="form.regionCode" maxlength="40" placeholder="选填，用于限值判定" />
        </t-form-item>
        <t-form-item>
          <t-button :loading="submitting" theme="primary" @click="runCalc">
            执行计算
          </t-button>
        </t-form-item>
      </t-form>
    </t-card>

    <t-card v-if="execution" class="mt-4" title="计算结果">
      <t-alert v-if="!execution.valid" theme="warning" :message="execution.errors.map(item => item.message).join('；')" />
      <p v-for="note in execution.notes" :key="note" class="calc-note">{{ note }}</p>
      <template v-if="record">
        <t-descriptions bordered :column="2" class="mt-3">
          <t-descriptions-item label="计算模式">{{ thermalCalcModeLabel(record.mode) }}</t-descriptions-item>
          <t-descriptions-item label="结论">{{ thermalCalcConclusion(record) }}</t-descriptions-item>
        </t-descriptions>
        <h3 class="calc-section-title">公式</h3>
        <ul>
          <li v-for="item in thermalCalcFormulaLines(record)" :key="item.key">
            {{ item.key }}：{{ item.value }}
          </li>
        </ul>
        <h3 class="calc-section-title">过程</h3>
        <ol>
          <li v-for="(step, index) in thermalCalcStepLines(record)" :key="`${step.label}-${index}`">
            {{ step.label }}
            <span v-if="step.formula">（{{ step.formula }}）</span>
            <span v-if="step.value"> = {{ step.value }}</span>
          </li>
        </ol>
        <h3 class="calc-section-title">结果快照</h3>
        <pre class="calc-json">{{ JSON.stringify(record.result, null, 2) }}</pre>
      </template>
    </t-card>
  </AppPage>
</template>

<style scoped>
.calc-note,
.calc-section-title {
  color: var(--td-text-color-secondary);
}

.calc-section-title {
  margin: var(--td-size-5) 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.calc-json {
  overflow: auto;
  margin: 0;
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
}
</style>
