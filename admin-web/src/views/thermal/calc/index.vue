<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { ConstructionScheme, ConstructionSchemeDetail } from '@/types/construction'
import type { ProductSpec } from '@/types/masterdata'
import type { ThermalCalcExecution, ThermalCalcMode, ThermalCalcRecord, ThermalStandardLimit } from '@/types/thermal'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPublishedConstructionSchemeDetail, fetchPublishedConstructionSchemes } from '@/api/modules/construction'
import { fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { executeThermalCalc, fetchThermalStandardLimits } from '@/api/modules/thermal'
import ThermalCalcResultCard from '@/components/business/thermal/ThermalCalcResultCard.vue'
import ThermalDebugPanel from '@/components/business/thermal/ThermalDebugPanel.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError } from '@/utils/business-error'
import {
  THERMAL_CALC_MODE_OPTIONS,
  thermalCalcEvidence,
  thermalCalcLayerRows,
  thermalCalcModeLabel,
  thermalCalcReferenceCandidates,
  thermalCalcResultSummary,
  thermalCalcStepLines,
} from '@/utils/thermal-calc'

/**
 * 热工计算：优先图集查表，图集无精确匹配行时才使用整体当量法 / 分层计算（需已发布计算规则）。
 * 页面只展示后端冻结快照的投影结果，不在前端重算 K / R；原始 JSON 收进高级调试（debug 权限门控）。
 */
defineOptions({ name: 'ThermalCalc' })

const route = useRoute()
const router = useRouter()
const feedback = useAppFeedback()
const { canAccess } = usePermissionAccess()
/** 高级调试：后端 system:thermal:* 无专用 debug 码，沿用知识库 debug 码门控（超管自动放行）。 */
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))

function queryText(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value.trim() : ''
}

function queryNumber(name: string): number | undefined {
  const raw = queryText(name)
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function queryMode(): ThermalCalcMode {
  const raw = queryText('mode')
  return THERMAL_CALC_MODE_OPTIONS.some(item => item.value === raw) ? raw as ThermalCalcMode : 'REFERENCE_TABLE'
}

const defaults = {
  mode: queryMode(),
  schemeId: queryText('schemeId'),
  productSpecId: queryText('productSpecId'),
  thicknessMm: queryNumber('thicknessMm') ?? 50,
  regionCode: queryText('regionCode'),
  projectId: queryText('projectId'),
}

const form = reactive({ ...defaults })

const schemes = ref<ConstructionScheme[]>([])
const specs = ref<ProductSpec[]>([])
const standardLimits = ref<ThermalStandardLimit[]>([])
const schemeDetail = ref<ConstructionSchemeDetail | null>(null)
const schemeLoading = ref(false)
const optionsError = ref<string[]>([])
const calcError = ref<unknown>(null)
let schemeRequest = 0
const submitting = ref(false)
const execution = ref<ThermalCalcExecution | null>(null)

const schemeOptions = computed(() => schemes.value.map(item => ({ label: item.name, value: item.id })))
const allowedSpecIds = computed(() => new Set(schemeDetail.value?.productOptions.map(item => item.productSpecId) ?? []))
const specOptions = computed(() => specs.value.filter(item => allowedSpecIds.value.has(item.id)).map(item => ({
  label: `${item.specCode}（${item.thicknessMm}mm）`,
  value: item.id,
})))
const selectedOption = computed(() => schemeDetail.value?.productOptions.find(item => item.productSpecId === form.productSpecId) ?? null)
/** 地区选择器：选项来自已发布的标准限值，提交时转换为 regionCode。 */
const regionOptions = computed(() => [...new Map(standardLimits.value.map(item => [item.regionCode, {
  label: item.regionName,
  value: item.regionCode,
}])).values()])

const record = computed<ThermalCalcRecord | null>(() => execution.value?.record ?? null)
const summary = computed(() => (record.value ? thermalCalcResultSummary(record.value) : null))
const evidence = computed(() => (record.value ? thermalCalcEvidence(record.value) : null))
const layerRows = computed(() => (record.value ? thermalCalcLayerRows(record.value) : []))
const referenceRows = computed(() => (record.value ? thermalCalcReferenceCandidates(record.value) : []))
const stepLines = computed(() => (record.value ? thermalCalcStepLines(record.value) : []))
const referenceMissing = computed(() => record.value?.mode === 'REFERENCE_TABLE' && referenceRows.value.length === 0)
const hasSurfaceResistance = computed(() => summary.value?.interiorSurfaceResistance != null
  || summary.value?.exteriorSurfaceResistance != null)
const usesSurfaceResistance = computed(() => record.value?.mode !== 'REFERENCE_TABLE'
  && record.value?.rule?.includeSurfaceResistances === true)

const MODE_HINTS: Record<ThermalCalcMode, string> = {
  REFERENCE_TABLE: '读取已发布图集中与构造、规格、厚度完全一致的参考值；不插值。',
  EQUIVALENT: '按产品层等效参数计算热阻；需已发布计算规则与参数，所得数值属于系统计算结果。',
  LAYERED: '逐层计算构造热阻并汇总；需已发布计算规则，所得数值属于系统计算结果。',
}
const modeHint = computed(() => MODE_HINTS[form.mode])

const layerColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '材料' },
  { colKey: 'thicknessMm', title: '厚度 (mm)' },
  { colKey: 'lambda', title: '导热系数 λ' },
  { colKey: 'correctionFactor', title: '修正系数 α' },
  { colKey: 'rValue', title: '热阻 R (m²·K/W)' },
]

const referenceColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'setCode', title: '参考集' },
  { colKey: 'setVersion', title: '版本' },
  { colKey: 'thicknessMm', title: '厚度 (mm)' },
  { colKey: 'productThermalResistance', title: '产品层热阻 R (m²·K/W)' },
  { colKey: 'totalThermalResistance', title: '总热阻 R₀ (m²·K/W)' },
  { colKey: 'kValue', title: '传热系数 K W/(m²·K)' },
  { colKey: 'compliance', title: '限值判定' },
  { colKey: 'evidence', title: '图集依据' },
]

async function loadOptions(): Promise<void> {
  optionsError.value = []
  const [schemeResult, specResult, limitResult] = await Promise.allSettled([
    fetchPublishedConstructionSchemes({}),
    fetchPublishedProductSpecs({}),
    fetchThermalStandardLimits({ page: 1, pageSize: 100, status: 'PUBLISHED' }),
  ])
  if (schemeResult.status === 'fulfilled') schemes.value = schemeResult.value.items
  else optionsError.value.push(`构造方案加载失败：${businessUserError(schemeResult.reason)}`)
  if (specResult.status === 'fulfilled') specs.value = specResult.value.items
  else optionsError.value.push(`产品规格加载失败：${businessUserError(specResult.reason)}`)
  if (limitResult.status === 'fulfilled') {
    const limitPage = limitResult.value
    const limits = [...limitPage.items]
    try {
      for (let page = 2; page <= Math.ceil(limitPage.total / 100); page += 1) {
        limits.push(...(await fetchThermalStandardLimits({ page, pageSize: 100, status: 'PUBLISHED' })).items)
      }
    }
    catch {
      optionsError.value.push('部分地区限值加载失败，可重试或不选地区计算')
    }
    standardLimits.value = limits
  }
  else optionsError.value.push('地区限值加载失败；仍可不选地区进行计算')
}

async function loadSchemeDetail(id: string): Promise<void> {
  const request = ++schemeRequest
  const requestedSpecId = form.productSpecId
  schemeDetail.value = null
  form.productSpecId = ''
  if (!id) return
  schemeLoading.value = true
  try {
    const detail = await fetchPublishedConstructionSchemeDetail(id)
    if (request === schemeRequest && form.schemeId === id) {
      schemeDetail.value = detail
      if (detail.productOptions.some(item => item.productSpecId === requestedSpecId)) form.productSpecId = requestedSpecId
    }
  }
  catch (cause) {
    if (request === schemeRequest) optionsError.value.push(`构造产品选项加载失败：${businessUserError(cause)}`)
  }
  finally {
    if (request === schemeRequest) schemeLoading.value = false
  }
}

async function runCalc(): Promise<void> {
  if (!form.schemeId || !form.productSpecId) {
    await feedback.message('warning', '请选择构造方案和产品规格')
    return
  }
  if (!selectedOption.value) {
    await feedback.message('warning', '请从当前构造方案支持的产品规格中选择')
    return
  }
  if (!Number.isFinite(form.thicknessMm) || form.thicknessMm < selectedOption.value.minThickness || form.thicknessMm > selectedOption.value.maxThickness) {
    await feedback.message('warning', `厚度须在当前构造允许的 ${selectedOption.value.minThickness}–${selectedOption.value.maxThickness} mm 范围内`)
    return
  }
  submitting.value = true
  execution.value = null
  calcError.value = null
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
    calcError.value = cause
    await feedback.messageError(cause)
  }
  finally {
    submitting.value = false
  }
}

function resetForm(): void {
  form.mode = defaults.mode
  form.schemeId = defaults.schemeId
  form.productSpecId = defaults.productSpecId
  form.thicknessMm = defaults.thicknessMm
  form.regionCode = defaults.regionCode
  execution.value = null
}

watch(() => form.schemeId, (id) => { void loadSchemeDetail(id) }, { immediate: true })
watch(() => [form.mode, form.schemeId, form.productSpecId, form.thicknessMm, form.regionCode], () => {
  execution.value = null
  calcError.value = null
})
watch(() => form.productSpecId, (id) => {
  const option = schemeDetail.value?.productOptions.find(item => item.productSpecId === id)
  if (option && (form.thicknessMm < option.minThickness || form.thicknessMm > option.maxThickness)) {
    form.thicknessMm = option.defaultThickness ?? option.minThickness
  }
})

async function switchMode(mode: ThermalCalcMode): Promise<void> {
  form.mode = mode
  await runCalc()
}

function goCandidates(): void {
  const query: Record<string, string> = {}
  if (form.regionCode.trim()) {
    query.regionCode = form.regionCode.trim()
  }
  query.thicknessMm = String(form.thicknessMm)
  if (form.schemeId) query.schemeId = form.schemeId
  if (form.productSpecId) query.productSpecId = form.productSpecId
  void router.push({ path: '/thermal/candidates', query })
}

function formatNumber(value: number | null): string {
  return value == null ? '—' : String(value)
}

/** 图集查表命中行的展示行（数值来自冻结快照，仅做格式化）。 */
interface ReferenceRow {
  setId: string
  setCode: string
  setVersion: string
  thicknessMm: string
  productThermalResistance: string
  totalThermalResistance: string
  kValue: string
  compliance: string
  evidence: string
}

const referenceTableData = computed<ReferenceRow[]>(() => referenceRows.value.map(item => ({
  setId: item.setId ?? `${item.setCode ?? 'row'}-${item.setVersion ?? 0}-${item.thicknessMm ?? 0}`,
  setCode: item.setCode ?? '—',
  setVersion: item.setVersion == null ? '—' : `v${item.setVersion}`,
  thicknessMm: formatNumber(item.thicknessMm),
  productThermalResistance: formatNumber(item.productThermalResistance),
  totalThermalResistance: formatNumber(item.totalThermalResistance),
  kValue: formatNumber(item.kValue),
  compliance: item.compliant == null ? '—' : item.compliant ? '满足限值' : '不满足限值',
  evidence: [item.evidenceSource, item.evidenceRef].filter(Boolean).join(' · ') || '—',
})))

onMounted(() => {
  void loadOptions()
})
</script>

<template>
  <AppPage
    description="按所选方式查询参考构造或实时计算。结果来自已发布数据与计算快照；查询参考方案请使用独立的参考方案查询页面。"
    title="热工计算"
  >
    <t-card title="计算参数">
      <t-alert v-if="optionsError.length" theme="warning" :message="optionsError.join('；')">
        <t-button size="small" variant="text" @click="loadOptions">重试加载</t-button>
      </t-alert>
      <t-form label-width="130px">
        <t-form-item label="计算方式">
          <t-radio-group v-model="form.mode" :options="THERMAL_CALC_MODE_OPTIONS" />
        </t-form-item>
        <t-form-item label="构造方案">
          <t-select v-model="form.schemeId" filterable :options="schemeOptions" placeholder="请选择已发布构造方案" />
        </t-form-item>
        <t-form-item label="产品规格">
          <t-select v-model="form.productSpecId" filterable :disabled="!schemeDetail || schemeLoading" :loading="schemeLoading" :options="specOptions" placeholder="先选构造，再选兼容规格" />
        </t-form-item>
        <t-alert v-if="schemeDetail && !schemeDetail.productOptions.length" theme="warning" message="该构造暂无可用于计算的产品规格，请选择其他构造。" />
        <t-form-item label="保温层厚度 (mm)">
          <t-input-number v-model="form.thicknessMm" :min="0" :step="0.1" theme="column" />
          <span v-if="selectedOption" class="calc-hint">当前规格允许 {{ selectedOption.minThickness }}–{{ selectedOption.maxThickness }} mm</span>
        </t-form-item>
        <t-form-item label="地区（选填）">
          <t-select
            v-model="form.regionCode"
            clearable
            filterable
            :options="regionOptions"
            placeholder="用于匹配当地标准限值，不影响图集方案筛选"
          />
        </t-form-item>
        <t-form-item>
          <t-space>
            <t-button :disabled="schemeLoading" :loading="submitting" theme="primary" @click="runCalc">
              执行计算
            </t-button>
            <t-button variant="outline" @click="resetForm">
              重置参数
            </t-button>
          </t-space>
        </t-form-item>
      </t-form>
      <p class="calc-hint">
        {{ modeHint }}
      </p>
    </t-card>

    <t-alert v-if="calcError" class="mt-4" theme="error" :message="businessUserError(calcError)">
      <t-button size="small" variant="text" @click="runCalc">重试计算</t-button>
    </t-alert>

    <AppEmptyState
      v-if="!execution && !calcError && !submitting"
      class="mt-4"
      description="选择构造方案与产品规格后执行计算；结果与图集参考表 / 已发布热工规则保持一致。"
      title="还没有计算结果"
    />

    <t-card v-if="execution" class="mt-4" title="计算结果">
      <t-alert
        v-if="!execution.valid"
        :message="execution.errors.map(item => item.message).join('；') || '计算未通过，请检查参数与已发布数据'"
        theme="error"
        title="计算未通过"
      />
      <template v-else>
        <t-alert v-for="(note, index) in execution.notes" :key="index" :message="note" theme="info" />

        <template v-if="record && summary && evidence">
          <ThermalCalcResultCard v-if="!referenceMissing" :evidence="evidence" :mode="record.mode" :summary="summary" />

          <section v-if="referenceMissing" class="calc-noresult">
            <h3 class="calc-section-title">
              图集中没有完全匹配的方案
            </h3>
            <p class="calc-hint">
              参考构造查表不做插值。可前往参考方案查询调整条件，或改用等效热阻、分层构造计算（需已发布计算规则）。
            </p>
            <t-space>
              <t-button size="small" theme="primary" variant="outline" @click="goCandidates">
                查看参考方案
              </t-button>
              <t-button size="small" variant="outline" @click="switchMode('EQUIVALENT')">
                改用等效热阻计算
              </t-button>
              <t-button size="small" variant="outline" @click="switchMode('LAYERED')">
                改用分层构造计算
              </t-button>
            </t-space>
          </section>

          <template v-if="referenceTableData.length">
            <h3 class="calc-section-title">
              匹配的图集方案（{{ referenceTableData.length }} 个）
            </h3>
            <t-table
              :columns="referenceColumns"
              :data="referenceTableData"
              row-key="setId"
              size="small"
              table-layout="auto"
            />
          </template>

          <template v-if="layerRows.length">
            <h3 class="calc-section-title">
              构造层
            </h3>
            <t-table
              :columns="layerColumns"
              :data="layerRows"
              row-key="order"
              size="small"
              table-layout="auto"
            />
          </template>

          <details v-if="record.mode !== 'REFERENCE_TABLE' && stepLines.length" class="calc-process">
            <summary>查看计算过程与依据</summary>
            <template v-if="hasSurfaceResistance && usesSurfaceResistance">
              <p class="calc-hint">
                内表面热阻 Ri = {{ formatNumber(summary.interiorSurfaceResistance) }} m²·K/W；
                外表面热阻 Re = {{ formatNumber(summary.exteriorSurfaceResistance) }} m²·K/W
              </p>
              <p class="calc-hint">内外表面热阻参与汇总；各层热阻与总热阻以本次计算过程为准。</p>
            </template>
            <ol v-if="stepLines.length" class="calc-steps">
              <li v-for="(step, index) in stepLines" :key="`${step.label}-${index}`">
                {{ step.label }}<span v-if="step.formula">（{{ step.formula }}）</span><span v-if="step.value !== ''"> = {{ step.value }}</span>
              </li>
            </ol>
          </details>

          <div class="calc-meta">
            <span>计算方式：{{ thermalCalcModeLabel(record.mode) }}</span>
            <AppStatusTag
              :label="record.ruleVersion == null ? '未使用计算规则' : `规则 v${record.ruleVersion}`"
              :status="record.ruleVersion == null ? 'default' : 'info'"
            />
            <AppStatusTag
              :label="record.limitVersion == null ? '未关联标准限值' : `限值 v${record.limitVersion}`"
              :status="record.limitVersion == null ? 'default' : 'info'"
            />
          </div>

          <ThermalDebugPanel :can-debug="canDebug" :record="record" />
        </template>
      </template>
    </t-card>
  </AppPage>
</template>

<style scoped>
.calc-hint {
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.calc-section-title {
  margin: var(--td-size-5) 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.calc-noresult {
  margin-top: var(--td-size-4);
  padding: var(--td-size-4);
  border: 1px solid var(--td-warning-color-3);
  border-radius: var(--td-radius-medium);
  background: var(--td-warning-color-1);
}

.calc-noresult .calc-section-title {
  margin-top: 0;
}

.calc-noresult .calc-hint {
  margin-bottom: var(--td-size-3);
}

.calc-steps {
  margin: 0;
  padding-left: var(--td-size-5);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.8;
}

.calc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-3);
  margin-top: var(--td-size-4);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.calc-process {
  margin-top: var(--td-size-4);
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.calc-process summary {
  color: var(--td-brand-color);
  cursor: pointer;
}
</style>
