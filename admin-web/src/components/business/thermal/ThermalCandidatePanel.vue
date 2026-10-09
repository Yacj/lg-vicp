<script setup lang="ts">
import type {
  ThermalConditionDraft,
  ThermalConditionPayload,
  ThermalThicknessMode,
} from '@/components/business/thermal/condition-model'
import type { ConstructionScheme, ConstructionSchemeDetail, InsulationSystem } from '@/types/construction'
import type { ProductSeries, ProductSpec } from '@/types/masterdata'
import type { ThermalCandidate, ThermalCandidateQuery, ThermalCandidateQueryResult, ThermalStandardLimit } from '@/types/thermal'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { fetchThermalStandardLimits, queryThermalCandidates } from '@/api/modules/thermal'
import { fetchPublishedConstructionSchemeDetail, fetchPublishedConstructionSchemes, fetchPublishedInsulationSystems } from '@/api/modules/construction'
import { fetchProductSeries, fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { fetchKnowledgeDocumentDetail } from '@/api/modules/knowledge'
import { createThermalConditionDraft } from '@/components/business/thermal/condition-model'
import ThermalConditionBuilder from '@/components/business/thermal/ThermalConditionBuilder.vue'
import ThermalSourceViewer from '@/components/business/thermal/ThermalSourceViewer.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError } from '@/utils/business-error'
import {
  closestThermalCandidateIds,
  thermalLookupConditionSummary,
  thermalLookupMetricLabel,
  thermalLookupModeLabel,
} from '@/utils/thermal-presentation'

/**
 * 参考方案查询：按图集参考表匹配满足条件的保温构造候选。
 * 条件以 filters[]（多指标 AND）提交，匹配语义由后端执行；前端不做任何 K/R 计算。
 * 后端标记 ranking.isClosestToTarget 为「最接近目标值」，全部候选平等展示。
 */
const props = defineProps<{
  defaultRegionCode?: string
  defaultSubstrateMaterial?: string
  defaultThicknessMm?: number
  defaultSchemeId?: string
  defaultProductSpecId?: string
}>()

const { canAccess } = usePermissionAccess()
/** 查看原始页面依赖知识库页面读取权限（后端 GET /pages/:pageId/recognition 要求 DOC_LIST）。 */
const canViewSource = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))

const conditionDrafts = ref<ThermalConditionDraft[]>([createThermalConditionDraft()])
const thicknessMode = ref<ThermalThicknessMode>(props.defaultThicknessMm ? 'exact' : 'any')
const thicknessExact = ref<number | undefined>(props.defaultThicknessMm)
const thicknessMin = ref<number | undefined>(undefined)
const thicknessMax = ref<number | undefined>(undefined)

const form = ref({
  regionCode: props.defaultRegionCode ?? '',
  standardLimitId: '',
  substrateMaterial: props.defaultSubstrateMaterial ?? '',
  specClass: undefined as 'I' | 'II' | 'III' | undefined,
  systemId: '',
  schemeId: props.defaultSchemeId ?? '',
  seriesId: '',
  productSpecId: props.defaultProductSpecId ?? '',
})

const standardLimits = ref<ThermalStandardLimit[]>([])
const systems = ref<InsulationSystem[]>([])
const schemes = ref<ConstructionScheme[]>([])
const series = ref<ProductSeries[]>([])
const specs = ref<ProductSpec[]>([])
const selectedScheme = ref<ConstructionSchemeDetail | null>(null)
const optionsError = ref<string[]>([])
let schemeRequest = 0
/** 地区选择器：选项来自已发布标准限值，提交时转换为 regionCode（禁止手输）。 */
const regionOptions = computed(() => [...new Map(standardLimits.value.map(item => [item.regionCode, {
  label: item.regionName,
  value: item.regionCode,
}])).values()])
const standardOptions = computed(() => standardLimits.value
  .filter(item => !form.value.regionCode || item.regionCode === form.value.regionCode)
  .map(item => ({ label: `${item.basisName} · ${item.regionName}${item.clauseRef ? ` · ${item.clauseRef}` : ''} · K ≤ ${item.limitKValue}`, value: item.id })))
const systemOptions = computed(() => systems.value.map(item => ({ label: item.name, value: item.id })))
const schemeOptions = computed(() => schemes.value.filter(item => !form.value.systemId || item.systemId === form.value.systemId)
  .map(item => ({ label: `${item.schemeCode} · ${item.name}`, value: item.id })))
const seriesOptions = computed(() => series.value.map(item => ({ label: item.name, value: item.id })))
const compatibleSpecIds = computed(() => selectedScheme.value ? new Set(selectedScheme.value.productOptions.map(option => option.productSpecId)) : null)
const specOptions = computed(() => specs.value
  .filter(item => (!form.value.seriesId || item.seriesId === form.value.seriesId)
    && (!form.value.specClass || item.specClass === form.value.specClass)
    && (!compatibleSpecIds.value || compatibleSpecIds.value.has(item.id)))
  .map(item => ({ label: `${item.specCode} · ${item.thicknessMm} mm`, value: item.id })))

const searching = ref(false)
const error = ref<unknown>(null)
const result = ref<ThermalCandidateQueryResult | null>(null)
/** 最近一次提交的条件载荷（多标准选择时以相同条件重查）。 */
const activePayload = ref<ThermalConditionPayload | null>(null)
const activeQuery = ref<ThermalCandidateQuery | null>(null)

const closestIds = computed(() =>
  result.value ? closestThermalCandidateIds(result.value.candidates) : new Set<string>())

/** 查询条件回显：指标条件以后端 filters[] 为准，厚度条件以本地提交载荷为准。 */
const conditionSummary = computed(() => {
  const parts: string[] = []
  const filters = result.value?.filters ?? activePayload.value?.filters ?? []
  if (filters.length > 0) {
    parts.push(thermalLookupConditionSummary(filters))
  }
  const payload = activePayload.value
  if (payload?.thicknessMm != null) {
    parts.push(`厚度 = ${payload.thicknessMm} mm`)
  }
  if (payload?.thicknessMin != null || payload?.thicknessMax != null) {
    parts.push(`厚度 ${payload.thicknessMin ?? '不限'}–${payload.thicknessMax ?? '不限'} mm`)
  }
  const query = activeQuery.value
  if (query?.systemId) parts.push(`系统：${systems.value.find(item => item.id === query.systemId)?.name ?? '已选系统'}`)
  if (query?.schemeId) parts.push(`构造：${schemes.value.find(item => item.id === query.schemeId)?.schemeCode ?? '已选构造'}`)
  if (query?.productSpecId) parts.push(`规格：${specs.value.find(item => item.id === query.productSpecId)?.specCode ?? '已选规格'}`)
  if (query?.regionCode) parts.push(`地区：${regionOptions.value.find(item => item.value === query.regionCode)?.label ?? '已选地区'}`)
  if (query?.standardLimitId) parts.push(`标准：${standardLimits.value.find(item => item.id === query.standardLimitId)?.basisName ?? '已选标准'}`)
  if (query?.substrateMaterial) parts.push(`基层：${query.substrateMaterial}`)
  if (query?.specClass) parts.push(`规格类别：${query.specClass} 型`)
  return parts.length > 0 ? parts.join(' 且 ') : '未指定热工指标条件'
})

/** 匹配语义回显：确认「接近」与「上限」未被混淆，容差是否被后端收敛。 */
const semanticsNotes = computed(() => {
  const current = result.value
  if (!current) {
    return []
  }
  const parts: string[] = []
  if (current.lookupMode) {
    parts.push(`匹配语义：${thermalLookupModeLabel(current.lookupMode)}`)
  }
  if (current.effectiveTolerance != null) {
    parts.push(`生效容差：${current.effectiveTolerance}`)
  }
  if (current.toleranceAdjusted) {
    parts.push('容差已按该指标允许范围调整')
  }
  return parts
})

const sourceVisible = ref(false)
const sourcePageId = ref<string | null>(null)
const sourceCaption = ref('')
const sourceTitles = new Map<string, string>()
let sourceRequest = 0

async function loadLimits(): Promise<void> {
  try {
    const first = await fetchThermalStandardLimits({ page: 1, pageSize: 100, status: 'PUBLISHED' })
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchThermalStandardLimits({ page, pageSize: 100, status: 'PUBLISHED' })).items)
    }
    standardLimits.value = items
  }
  catch {
    standardLimits.value = []
    optionsError.value.push('地区与标准限值加载失败')
  }
}

async function loadOptions(): Promise<void> {
  const results = await Promise.allSettled([
    fetchPublishedInsulationSystems({}),
    fetchPublishedConstructionSchemes({}),
    fetchPublishedProductSpecs({}),
    loadPublishedSeries(),
  ])
  if (results[0]?.status === 'fulfilled') systems.value = results[0].value.items
  else optionsError.value.push('保温系统加载失败')
  if (results[1]?.status === 'fulfilled') schemes.value = results[1].value.items
  else optionsError.value.push('构造方案加载失败')
  if (results[2]?.status === 'fulfilled') specs.value = results[2].value.items
  else optionsError.value.push('产品规格加载失败')
  if (results[3]?.status === 'fulfilled') series.value = results[3].value
  else optionsError.value.push('产品列表加载失败')
}

async function loadPublishedSeries(): Promise<ProductSeries[]> {
  const first = await fetchProductSeries({ page: 1, pageSize: 100, status: 'PUBLISHED' })
  const items = [...first.items]
  for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
    items.push(...(await fetchProductSeries({ page, pageSize: 100, status: 'PUBLISHED' })).items)
  }
  return items
}

function retryOptions(): void {
  optionsError.value = []
  void loadOptions()
  void loadLimits()
}

function buildQuery(payload: ThermalConditionPayload | null, overrideStandardLimitId?: string): ThermalCandidateQuery {
  const query: ThermalCandidateQuery = {}
  if (payload && payload.filters.length > 0) {
    query.filters = payload.filters
  }
  if (payload?.thicknessMm != null) {
    query.thicknessMm = payload.thicknessMm
  }
  if (payload?.thicknessMin != null) {
    query.thicknessMin = payload.thicknessMin
  }
  if (payload?.thicknessMax != null) {
    query.thicknessMax = payload.thicknessMax
  }
  if (form.value.regionCode.trim()) {
    query.regionCode = form.value.regionCode.trim()
  }
  const limitId = overrideStandardLimitId ?? form.value.standardLimitId
  if (limitId) {
    query.standardLimitId = limitId
  }
  if (form.value.substrateMaterial.trim()) {
    query.substrateMaterial = form.value.substrateMaterial.trim()
  }
  if (form.value.specClass) {
    query.specClass = form.value.specClass
  }
  if (form.value.systemId) query.systemId = form.value.systemId
  if (form.value.schemeId) query.schemeId = form.value.schemeId
  if (form.value.productSpecId) query.productSpecId = form.value.productSpecId
  return query
}

async function runSearch(payload: ThermalConditionPayload | null, queryOverride?: ThermalCandidateQuery): Promise<void> {
  if (searching.value) {
    return
  }
  searching.value = true
  error.value = null
  result.value = null
  const query = queryOverride ?? buildQuery(payload)
  activePayload.value = payload
  activeQuery.value = query
  try {
    result.value = await queryThermalCandidates(query)
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    searching.value = false
  }
}

function handleConditionSearch(payload: ThermalConditionPayload): void {
  if (form.value.seriesId && !form.value.productSpecId) {
    MessagePlugin.warning('请选择该产品下的具体规格')
    return
  }
  void runSearch(payload)
}

/** 多标准并存时由用户选择，选定后以相同条件重新查询。 */
function selectLimit(id: string): void {
  form.value.standardLimitId = id
  void runSearch(activePayload.value, { ...(activeQuery.value ?? buildQuery(activePayload.value)), standardLimitId: id })
}

function resetConditions(): void {
  conditionDrafts.value = [createThermalConditionDraft()]
  thicknessMode.value = 'any'
  thicknessExact.value = undefined
  thicknessMin.value = undefined
  thicknessMax.value = undefined
}

/** 无结果时放宽厚度条件并重查。 */
function relaxThickness(): void {
  thicknessMode.value = 'any'
  thicknessExact.value = undefined
  thicknessMin.value = undefined
  thicknessMax.value = undefined
  void runSearch(activePayload.value ? { filters: activePayload.value.filters } : null)
}

/** 无结果时清空全部条件并重查（保留地区与范围过滤）。 */
function clearConditions(): void {
  resetConditions()
  form.value.standardLimitId = ''
  void runSearch(null)
}

async function openSource(candidate: ThermalCandidate): Promise<void> {
  if (!candidate.sourcePageId) {
    MessagePlugin.info('该方案未关联原始页面')
    return
  }
  const request = ++sourceRequest
  sourcePageId.value = candidate.sourcePageId
  const pageText = candidate.sourcePageLabel
    ? `印刷页码 ${candidate.sourcePageLabel}`
    : candidate.scheme.atlasPage ? `图集参考页 ${candidate.scheme.atlasPage}` : '未标注印刷页码'
  sourceCaption.value = `${candidate.scheme.code} · ${pageText}`
  sourceVisible.value = true
  if (!candidate.sourceDocumentId) return
  let title = sourceTitles.get(candidate.sourceDocumentId)
  if (!title) {
    try {
      title = (await fetchKnowledgeDocumentDetail(candidate.sourceDocumentId)).document.title
      sourceTitles.set(candidate.sourceDocumentId, title)
    }
    catch { return }
  }
  if (request === sourceRequest) sourceCaption.value = `${title} · ${candidate.scheme.code} · ${pageText}`
}

async function loadSchemeDetail(id: string): Promise<void> {
  const request = ++schemeRequest
  selectedScheme.value = null
  if (!id) return
  try {
    const detail = await fetchPublishedConstructionSchemeDetail(id)
    if (request === schemeRequest && form.value.schemeId === id) selectedScheme.value = detail
  }
  catch (cause) {
    if (request === schemeRequest) optionsError.value.push(`构造产品选项加载失败：${businessUserError(cause)}`)
  }
}

function matchTag(candidate: ThermalCandidate): { label: string, status: 'success' | 'warning' } {
  if (candidate.matchType === 'NEIGHBOR') {
    return { label: `相邻规格（差 ${candidate.neighborGap ?? 1} 档）`, status: 'warning' }
  }
  return { label: '当前规格', status: 'success' }
}

function gapLabel(candidate: ThermalCandidate): string {
  if (!candidate.ranking) {
    return '—'
  }
  const value = candidate.ranking.metricGap ?? candidate.ranking.kGap
  const metric = candidate.ranking.metric
  return metric ? `${value}（${thermalLookupMetricLabel(metric)}）` : String(value)
}

watch(() => form.value.regionCode, () => {
  // 地区变化后旧的标准限值选择失效，需重新解析。
  form.value.standardLimitId = ''
})
watch(() => form.value.systemId, () => {
  if (form.value.schemeId && !schemes.value.some(item => item.id === form.value.schemeId && (!form.value.systemId || item.systemId === form.value.systemId))) form.value.schemeId = ''
})
watch(() => form.value.schemeId, (id) => { void loadSchemeDetail(id) }, { immediate: true })
watch(specOptions, (options) => {
  if (!specs.value.length || (form.value.schemeId && !selectedScheme.value)) return
  if (form.value.productSpecId && !options.some(item => item.value === form.value.productSpecId)) form.value.productSpecId = ''
})

onMounted(() => {
  void loadLimits()
  void loadOptions()
})
</script>

<template>
  <div class="vicp-candidate">
    <section class="vicp-candidate__form">
      <ThermalConditionBuilder
        v-model:filters="conditionDrafts"
        v-model:thickness-exact="thicknessExact"
        v-model:thickness-max="thicknessMax"
        v-model:thickness-min="thicknessMin"
        v-model:thickness-mode="thicknessMode"
        :loading="searching"
        @reset="resetConditions"
        @search="handleConditionSearch"
      />

      <t-form label-align="top" layout="inline">
        <t-form-item label="保温系统">
          <t-select v-model="form.systemId" clearable filterable :options="systemOptions" placeholder="全部系统" style="width: 220px" />
        </t-form-item>
        <t-form-item label="构造方案">
          <t-select v-model="form.schemeId" clearable filterable :options="schemeOptions" placeholder="全部构造" style="width: 260px" />
        </t-form-item>
        <t-form-item v-if="seriesOptions.length" label="产品">
          <t-select v-model="form.seriesId" clearable filterable :options="seriesOptions" placeholder="全部产品" style="width: 220px" />
        </t-form-item>
        <t-form-item label="产品规格">
          <t-select v-model="form.productSpecId" clearable filterable :options="specOptions" placeholder="全部规格" style="width: 220px" />
        </t-form-item>
        <t-form-item label="地区">
          <t-select
            v-model="form.regionCode"
            clearable
            filterable
            :options="regionOptions"
            placeholder="选择地区（选填）"
            style="width: 200px"
          />
        </t-form-item>
        <t-form-item label="适用标准">
          <t-select v-model="form.standardLimitId" clearable filterable :options="standardOptions" placeholder="系统自动匹配（选填）" style="width: 300px" />
        </t-form-item>
        <t-form-item label="基层材料">
          <t-input v-model="form.substrateMaterial" clearable placeholder="如 钢筋混凝土，选填" />
        </t-form-item>
        <t-form-item label="产品规格类别">
          <t-select v-model="form.specClass" clearable placeholder="全部" style="width: 120px">
            <t-option label="Ⅰ 型" value="I" />
            <t-option label="Ⅱ 型" value="II" />
            <t-option label="Ⅲ 型" value="III" />
          </t-select>
        </t-form-item>
      </t-form>
      <t-alert v-if="optionsError.length" theme="warning" :message="`${optionsError.join('；')}。可重试加载选项，或按已可选条件查询。`">
        <t-button size="small" variant="text" @click="retryOptions">重试加载</t-button>
      </t-alert>
    </section>

    <t-alert v-if="error" :message="businessUserError(error)" theme="error">
      <t-button size="small" variant="text" @click="runSearch(activePayload, activeQuery ?? undefined)">重试查询</t-button>
    </t-alert>
    <t-loading v-if="searching" loading text="正在查询图集参考方案" />

    <template v-if="result">
      <t-alert
        v-for="(note, index) in result.notes"
        :key="index"
        :message="note"
        theme="info"
      />

      <section class="vicp-candidate__summary">
        <div class="vicp-candidate__target">
          <strong>查询条件</strong>
          <span>{{ conditionSummary }}</span>
        </div>
        <div v-if="result.limit" class="vicp-candidate__limit">
          <AppStatusTag
            :label="`标准限值 K ≤ ${result.limit.limitKValue}`"
            status="info"
          />
          <span>{{ result.limit.regionName }} · {{ result.limit.basisName }}{{ result.limit.clauseRef ? ` · ${result.limit.clauseRef}` : '' }}</span>
        </div>
        <p class="vicp-candidate__count">
          共 {{ result.candidates.length }} 个候选方案
        </p>
      </section>

      <p v-if="semanticsNotes.length" class="vicp-candidate__semantics">
        {{ semanticsNotes.join(' · ') }}
      </p>
      <t-alert v-if="result.filters?.some(filter => filter.mode === 'APPROX')" theme="warning" message="接近候选只表示数值落在容差范围内，不代表符合硬条件或标准限值。" />

      <t-alert
        v-if="result.limitCandidates && result.limitCandidates.length > 1"
        theme="warning"
        title="该地区有多份生效标准限值，请选择适用的标准"
      >
        <t-space direction="vertical">
          <t-button
            v-for="limit in result.limitCandidates"
            :key="limit.id"
            :theme="form.standardLimitId === limit.id ? 'primary' : 'default'"
            :variant="form.standardLimitId === limit.id ? 'base' : 'outline'"
            size="small"
            @click="selectLimit(limit.id)"
          >
            {{ limit.basisName }}{{ limit.clauseRef ? ` · ${limit.clauseRef}` : '' }}（K ≤ {{ limit.limitKValue }}）
          </t-button>
        </t-space>
      </t-alert>

      <div v-if="result.missingConditions.length > 0" class="vicp-candidate__missing">
        <span>数据缺失的条件：</span>
        <t-tag v-for="item in result.missingConditions" :key="item" size="small" theme="warning" variant="light">
          {{ item }}
        </t-tag>
      </div>

      <div v-if="result.candidates.length > 0" class="vicp-candidate__list">
        <article
          v-for="candidate in result.candidates"
          :key="candidate.candidateId"
          class="vicp-candidate__card"
        >
          <header class="vicp-candidate__card-head">
            <AppStatusTag label="图集参考值" status="info" />
            <strong class="vicp-candidate__card-title">
              {{ candidate.scheme.code }}
              <span v-if="candidate.system.name" class="vicp-candidate__card-system">{{ candidate.system.name }}</span>
            </strong>
            <t-tag v-if="closestIds.has(candidate.candidateId)" theme="primary" variant="light">
              最接近目标值
            </t-tag>
            <AppStatusTag :label="matchTag(candidate).label" :status="matchTag(candidate).status" />
            <AppStatusTag
              v-if="candidate.compliant !== null"
              :label="candidate.compliant ? '满足标准限值' : '未满足标准限值'"
              :status="candidate.compliant ? 'success' : 'error'"
            />
          </header>
          <p v-if="candidate.matchType === 'NEIGHBOR' || candidate.unmatchedConditions.length" class="vicp-candidate__caution">
            接近候选，不代表符合硬条件；请核对未匹配条件。
          </p>

          <div class="vicp-candidate__card-metrics">
            <div class="vicp-candidate__metric">
              <span>厚度</span>
              <strong>{{ candidate.result.thicknessMm }} mm</strong>
            </div>
            <div class="vicp-candidate__metric">
              <span>产品层热阻 R</span>
              <strong>{{ candidate.result.productThermalResistance }} m²·K/W</strong>
            </div>
            <div class="vicp-candidate__metric">
              <span>总热阻 R₀</span>
              <strong>{{ candidate.result.totalThermalResistance }} m²·K/W</strong>
            </div>
            <div class="vicp-candidate__metric">
              <span>传热系数 K</span>
              <strong>{{ candidate.result.kValue }} W/(m²·K)</strong>
            </div>
            <div v-if="candidate.ranking" class="vicp-candidate__metric">
              <span>与目标差距</span>
              <strong>{{ gapLabel(candidate) }}</strong>
            </div>
          </div>

          <div class="vicp-candidate__card-meta">
            产品规格：{{ candidate.productSpec.specCode }}{{ candidate.productSpec.specClass ? ` · ${candidate.productSpec.specClass} 型` : '' }}
            <template v-if="candidate.scheme.substrateMaterial">
              · 基层：{{ candidate.scheme.substrateMaterial }}{{ candidate.scheme.substrateThickness != null ? ` ${candidate.scheme.substrateThickness}mm` : '' }}
            </template>
          </div>

          <div class="vicp-candidate__card-conditions">
            <t-tag v-for="item in candidate.matchedConditions" :key="item" size="small" theme="success" variant="light">
              {{ item }}
            </t-tag>
            <t-tag v-for="item in candidate.unmatchedConditions" :key="item" size="small" theme="danger" variant="light">
              {{ item }}
            </t-tag>
            <t-tag v-for="item in candidate.missingConditions" :key="item" size="small" theme="warning" variant="light">
              缺失：{{ item }}
            </t-tag>
          </div>

          <footer class="vicp-candidate__card-evidence">
            <div class="vicp-candidate__evidence-line">
              图集依据：{{ candidate.evidence.source }} {{ candidate.evidence.ref }}
            </div>
            <div class="vicp-candidate__evidence-line">
              参考集：{{ candidate.set.code }} v{{ candidate.set.version }}（优先级 {{ candidate.set.priority }}）
              <template v-if="candidate.sourcePageLabel">
                · 印刷页码 {{ candidate.sourcePageLabel }}
              </template>
              <template v-else-if="candidate.scheme.atlasPage">
                · 参考页 {{ candidate.scheme.atlasPage }}
              </template>
              <template v-if="candidate.set.buildingTypes.length > 0">
                · 适用建筑：{{ candidate.set.buildingTypes.join('、') }}
              </template>
            </div>
            <div v-if="canViewSource && candidate.sourcePageId" class="vicp-candidate__source">
              <t-button size="small" variant="text" @click="openSource(candidate)">
                查看原始页面
              </t-button>
            </div>
          </footer>
        </article>
      </div>

      <div v-else class="vicp-candidate__empty">
        <AppEmptyState
          description="图集参考表不做插值，可调整上方筛选条件后重查。"
          title="没有找到满足当前条件的参考方案"
        >
          <template #action>
            <div class="vicp-candidate__empty-body">
              <p class="vicp-candidate__empty-conditions">
                当前条件：{{ conditionSummary }}
              </p>
              <p v-if="result.missingConditions.length > 0" class="vicp-candidate__empty-conditions">
                数据缺失：{{ result.missingConditions.join('、') }}
              </p>
              <t-space>
                <t-button size="small" variant="outline" @click="relaxThickness">
                  放宽厚度
                </t-button>
                <t-button size="small" variant="outline" @click="clearConditions">
                  清除指标与厚度
                </t-button>
              </t-space>
            </div>
          </template>
        </AppEmptyState>
      </div>
    </template>

    <AppEmptyState
      v-else-if="!error && !searching"
      description="填写热工指标与厚度条件，选择适用的系统、构造或规格后查询已发布图集参考值。"
      title="尚未查询参考方案"
    />

    <ThermalSourceViewer
      v-model:visible="sourceVisible"
      :caption="sourceCaption"
      :page-id="sourcePageId"
    />
  </div>
</template>

<style scoped>
.vicp-candidate {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 16px;
}

.vicp-candidate__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.vicp-candidate__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.vicp-candidate__target {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.vicp-candidate__target strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.vicp-candidate__target span {
  overflow-wrap: anywhere;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__limit {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__semantics {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__missing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.vicp-candidate__count {
  margin: 0 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}

.vicp-candidate__card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.vicp-candidate__card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.vicp-candidate__caution {
  margin: 0;
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__card-title {
  min-width: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.vicp-candidate__card-system {
  margin-left: 6px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: normal;
}

.vicp-candidate__card-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.vicp-candidate__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.vicp-candidate__metric span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__metric strong {
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}

.vicp-candidate__card-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__card-conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vicp-candidate__card-evidence {
  padding-top: 8px;
  border-top: 1px dashed var(--td-component-stroke);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
}

.vicp-candidate__evidence-line {
  word-break: break-word;
}

.vicp-candidate__source {
  margin-top: 4px;
}

.vicp-candidate__empty {
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.vicp-candidate__empty-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.vicp-candidate__empty-conditions {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
