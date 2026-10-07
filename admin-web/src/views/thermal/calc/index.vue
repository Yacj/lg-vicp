<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { ConstructionScheme } from '@/types/construction'
import type { ProductSpec } from '@/types/masterdata'
import type { ThermalCalcExecution, ThermalCalcMode, ThermalCalcRecord, ThermalStandardLimit } from '@/types/thermal'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchPublishedConstructionSchemes } from '@/api/modules/construction'
import { fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { executeThermalCalc, fetchThermalStandardLimits } from '@/api/modules/thermal'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAppFeedback } from '@/composables/useAppFeedback'
import {
  THERMAL_CALC_MODE_OPTIONS,
  thermalCalcComplianceLabel,
  thermalCalcFormulaLines,
  thermalCalcLayerRows,
  thermalCalcModeLabel,
  thermalCalcResultSummary,
  thermalCalcSourceLabel,
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
const standardLimits = ref<ThermalStandardLimit[]>([])
const submitting = ref(false)
const execution = ref<ThermalCalcExecution | null>(null)

const schemeOptions = computed(() => schemes.value.map(item => ({ label: item.name, value: item.id })))
const specOptions = computed(() => specs.value.map(item => ({
  label: `${item.specCode}（${item.thicknessMm}mm）`,
  value: item.id,
})))
/** 地区选择器：选项来自已发布的标准限值，提交时转换为 regionCode。 */
const regionOptions = computed(() => standardLimits.value.map(item => ({
  label: `${item.regionName}（${item.regionCode}）`,
  value: item.regionCode,
})))

const record = computed<ThermalCalcRecord | null>(() => execution.value?.record ?? null)
const summary = computed(() => (record.value ? thermalCalcResultSummary(record.value) : null))
const layerRows = computed(() => (record.value ? thermalCalcLayerRows(record.value) : []))
const sourceLabel = computed(() => (record.value ? thermalCalcSourceLabel(record.value.mode) : ''))
const sourceHint = computed(() => {
  if (!record.value) {
    return ''
  }
  return record.value.mode === 'REFERENCE_TABLE'
    ? '直接读取已发布图集参考行，未做插值或重复计算。'
    : '基于当前构造参数和热工规则计算。'
})
const layerColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '材料' },
  { colKey: 'thicknessMm', title: '厚度 (mm)' },
  { colKey: 'lambda', title: '导热系数 λ' },
  { colKey: 'correctionFactor', title: '修正系数 α' },
  { colKey: 'rValue', title: '热阻 R (m²·K/W)' },
]

async function loadOptions(): Promise<void> {
  try {
    const [schemePage, specPage, limitPage] = await Promise.all([
      fetchPublishedConstructionSchemes({}),
      fetchPublishedProductSpecs({}),
      fetchThermalStandardLimits({ page: 1, pageSize: 200, status: 'PUBLISHED' }),
    ])
    schemes.value = schemePage.items
    specs.value = specPage.items
    standardLimits.value = limitPage.items
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

function formatNumber(value: number | null): string {
  return value == null ? '—' : String(value)
}

onMounted(() => {
  void loadOptions()
})
</script>

<template>
  <AppPage
    description="选择构造方案、产品规格与厚度后执行热工计算。核心计算由系统热工引擎完成，本页只展示结果、构造层与计算依据。"
    title="热工计算"
  >
    <t-card title="计算参数">
      <t-form label-width="120px">
        <t-form-item label="计算模式">
          <t-radio-group v-model="form.mode" :options="THERMAL_CALC_MODE_OPTIONS" />
        </t-form-item>
        <t-form-item label="构造方案">
          <t-select v-model="form.schemeId" filterable :options="schemeOptions" placeholder="请选择已发布构造方案" />
        </t-form-item>
        <t-form-item label="产品规格">
          <t-select v-model="form.productSpecId" filterable :options="specOptions" placeholder="请选择已发布产品规格" />
        </t-form-item>
        <t-form-item label="厚度 (mm)">
          <t-input-number v-model="form.thicknessMm" :min="1" :step="1" theme="column" />
        </t-form-item>
        <t-form-item label="地区">
          <t-select
            v-model="form.regionCode"
            clearable
            filterable
            :options="regionOptions"
            placeholder="选填，仅用于判断是否满足当地限值"
          />
        </t-form-item>
        <t-form-item>
          <t-button :loading="submitting" theme="primary" @click="runCalc">
            执行计算
          </t-button>
        </t-form-item>
      </t-form>
    </t-card>

    <t-card v-if="execution" class="mt-4" title="计算结果">
      <div v-if="record" class="calc-source">
        <AppStatusTag
          :label="sourceLabel"
          :status="record.mode === 'REFERENCE_TABLE' ? 'info' : 'success'"
        />
        <span class="calc-source__hint">{{ sourceHint }}</span>
      </div>
      <t-alert v-if="!execution.valid" theme="warning" :message="execution.errors.map(item => item.message).join('；')" />
      <p v-for="note in execution.notes" :key="note" class="calc-note">{{ note }}</p>
      <template v-if="record && summary">
        <div class="calc-result-grid">
          <div class="calc-result-cell">
            <span>保温层厚度</span>
            <strong>{{ formatNumber(summary.thicknessMm) }}<small v-if="summary.thicknessMm != null"> mm</small></strong>
          </div>
          <div class="calc-result-cell">
            <span>产品层热阻 R</span>
            <strong>{{ formatNumber(summary.productResistance) }}<small v-if="summary.productResistance != null"> m²·K/W</small></strong>
          </div>
          <div class="calc-result-cell">
            <span>总热阻 R₀</span>
            <strong>{{ formatNumber(summary.totalResistance) }}<small v-if="summary.totalResistance != null"> m²·K/W</small></strong>
          </div>
          <div class="calc-result-cell">
            <span>传热系数 K</span>
            <strong>{{ formatNumber(summary.kValue) }}<small v-if="summary.kValue != null"> W/(m²·K)</small></strong>
          </div>
        </div>

        <t-descriptions bordered :column="3" class="mt-3">
          <t-descriptions-item label="限值">
            {{ summary.limitKValue != null ? `${summary.limitKValue} W/(m²·K)` : '未提供地区限值' }}
          </t-descriptions-item>
          <t-descriptions-item label="是否满足要求">
            <AppStatusTag
              :label="thermalCalcComplianceLabel(summary.compliant)"
              :status="summary.compliant === true ? 'success' : summary.compliant === false ? 'error' : 'default'"
            />
          </t-descriptions-item>
          <t-descriptions-item label="计算模式">
            {{ thermalCalcModeLabel(record.mode) }}
          </t-descriptions-item>
          <t-descriptions-item label="使用规则">
            {{ summary.ruleName || '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="依据标准">
            {{ [summary.standardName, summary.standardClause].filter(Boolean).join(' · ') || '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="规则用途">
            {{ summary.ruleUsage || '—' }}
          </t-descriptions-item>
        </t-descriptions>

        <template v-if="layerRows.length">
          <h3 class="calc-section-title">构造层</h3>
          <t-table
            :columns="layerColumns"
            :data="layerRows"
            row-key="order"
            size="small"
            table-layout="auto"
          />
        </template>

        <h3 class="calc-section-title">计算依据</h3>
        <p class="calc-note">
          内表面换热阻 Ri = {{ formatNumber(summary.interiorSurfaceResistance) }} m²·K/W；
          外表面换热阻 Re = {{ formatNumber(summary.exteriorSurfaceResistance) }} m²·K/W
        </p>
        <p class="calc-note">
          总热阻 R₀ = Ri + ΣR + Re；传热系数 K = 1 / R₀
        </p>

        <template v-if="thermalCalcStepLines(record).length">
          <h3 class="calc-section-title">计算过程</h3>
          <ol>
            <li v-for="(step, index) in thermalCalcStepLines(record)" :key="`${step.label}-${index}`">
              {{ step.label }}
              <span v-if="step.formula">（{{ step.formula }}）</span>
              <span v-if="step.value"> = {{ step.value }}</span>
            </li>
          </ol>
        </template>

        <template v-if="thermalCalcFormulaLines(record).length">
          <h3 class="calc-section-title">公式</h3>
          <ul>
            <li v-for="item in thermalCalcFormulaLines(record)" :key="item.key">
              {{ item.key }}：{{ item.value }}
            </li>
          </ul>
        </template>

        <t-collapse class="calc-technical">
          <t-collapse-panel header="技术详情（高级）" value="technical">
            <pre class="calc-json">{{ JSON.stringify(record.result, null, 2) }}</pre>
          </t-collapse-panel>
        </t-collapse>
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

.calc-source {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  margin-bottom: var(--td-size-4);
}

.calc-source__hint {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.calc-result-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-size-3);
}

.calc-result-cell {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.calc-result-cell span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.calc-result-cell strong {
  color: var(--td-text-color-primary);
  font-size: 20px;
  font-weight: 600;
}

.calc-result-cell small {
  margin-left: 4px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 400;
}

.calc-technical {
  margin-top: var(--td-size-4);
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

@media (max-width: 1366px) {
  .calc-result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
