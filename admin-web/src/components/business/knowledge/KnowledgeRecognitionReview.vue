<script setup lang="ts">
import type { KnowledgePage, KnowledgePageRecognition, PageRecognitionConfirmResult, PageRecognitionMappingIssue, PageRecognitionResult, PageRecognitionSchemeCandidate, PageRecognitionProductSpecCandidate } from '@/types/knowledge'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { confirmKnowledgePageRecognition, fetchKnowledgePageRecognition, fetchVersionPages, recognizeKnowledgePage, saveKnowledgePageRecognitionDraft } from '@/api/modules/knowledge'
import { fetchPublishedConstructionSchemes } from '@/api/modules/construction'
import { fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { fetchThermalSets } from '@/api/modules/thermal'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useKnowledgeVersionEditable, KNOWLEDGE_THERMAL_SET_LOCKED_HINT, KNOWLEDGE_VERSION_LOCKED_HINT } from '@/composables/useKnowledgeVersionEditable'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import {
  describeMappingIssue,
  EMPTY_RECOGNITION_MAPPING_STATE,
  formatProductSpecCandidateLabel,
  formatSchemeCandidateLabel,
  pageRecognitionStatusMeta,
  readRecognitionMappingState,
  RECOGNITION_AMBIGUOUS_HINT,
  RECOGNITION_NOT_FOUND_HINT,
} from '@/utils/knowledge-recognition'
import type { ConstructionScheme } from '@/types/construction'
import type { ProductSpec } from '@/types/masterdata'
import type { ThermalSet } from '@/types/thermal'

const props = defineProps<{ documentId: string, versionId: string | null, focusPhysicalPageNumber?: number | null }>()
const emit = defineEmits<{ openGalleryPage: [physicalPageNumber: number] }>()
const { canAccess } = usePermissionAccess()
const canRecognize = computed(() => canAccess({ permissions: ['system:knowledge:page:recognize'] }))
const canReview = computed(() => canAccess({ permissions: ['system:knowledge:page:review'] }))
const canConfirm = computed(() => canAccess({ permissions: ['system:knowledge:page:confirm'] }))
const pages = ref<KnowledgePage[]>([])
const selected = ref<KnowledgePage | null>(null)
const recognition = ref<KnowledgePageRecognition | null>(null)
interface RecognitionDraftOption {
  thicknessMm?: number
  productThermalResistance?: number
  totalThermalResistance?: number
  kValue?: number
  /** 管理员人工选择的正式产品规格；确认时提交给后端做正式映射。 */
  productSpecId?: string | null
  /** 可选的产品目录约束；人工映射时随规格一并提交。 */
  catalogProductId?: string | null
}
interface RecognitionDraftLayer { order?: number, name: string, thicknessMm?: number, lambda?: number, alpha?: number, rValue?: number }
interface RecognitionDraftSystem {
  systemName?: string
  specClass?: 'I' | 'II' | 'III'
  constructionCode?: string
  baseMaterial?: string
  baseThicknessMm?: number
  layers: RecognitionDraftLayer[]
  options: RecognitionDraftOption[]
  /** 管理员人工选择的正式构造方案；确认时提交给后端做正式映射。 */
  schemeId?: string | null
}
interface RecognitionDraft { pageLabel?: string, pageTitle?: string, fullText: string, systems: RecognitionDraftSystem[], notes?: string[], warnings?: string[] }
const draft = ref<RecognitionDraft>(emptyResult())
const thermalSets = ref<ThermalSet[]>([])
const thermalSetId = ref('')
const loading = ref(false)
const saving = ref(false)
const recognizing = ref(false)
const confirming = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

/** 正式业务对象字典：用于人工映射下拉，接口失败时降级为仅候选。 */
const publishedSchemes = ref<ConstructionScheme[]>([])
const publishedSpecs = ref<ProductSpec[]>([])
/** AMBIGUOUS 时后端返回的候选，绑定到当前页 system/option。 */
const mappingState = ref({ ...EMPTY_RECOGNITION_MAPPING_STATE })
const ambiguous = ref(false)
/** 确认成功但部分热工数据未同步时的映射问题。 */
const confirmIssues = ref<PageRecognitionMappingIssue[]>([])

const viewerVisible = ref(false)
const viewerScale = ref(1)
const viewerOffset = ref({ x: 0, y: 0 })
const viewerDragging = ref(false)
const viewerDragOrigin = ref({ x: 0, y: 0, ox: 0, oy: 0 })

const editableState = useKnowledgeVersionEditable(computed(() => ({
  status: recognition.value?.versionStatus ?? null,
  versionEditable: recognition.value?.versionEditable ?? null,
  thermalSetEditable: recognition.value?.thermalSetEditable ?? null,
  permission: true,
})))
const versionLocked = computed(() => Boolean(selected.value && recognition.value && !editableState.value.editable))
const thermalSetLocked = computed(() => Boolean(selected.value && recognition.value && recognition.value.thermalSetEditable === false))
const reviewAllowed = computed(() => canReview.value && !versionLocked.value)
const confirmAllowed = computed(() => canConfirm.value && !versionLocked.value)
const recognizeAllowed = computed(() => canRecognize.value && !versionLocked.value)

function emptyResult(): RecognitionDraft { return { pageLabel: '', pageTitle: '', fullText: '', systems: [] } }
function copyResult(value: PageRecognitionResult | null | undefined): RecognitionDraft {
  if (!value) return emptyResult()
  return {
    pageLabel: value.pageLabel ?? '', pageTitle: value.pageTitle ?? '', fullText: value.fullText ?? '',
    notes: value.notes, warnings: value.warnings,
    systems: (value.systems ?? []).map(system => ({
      schemeId: system.schemeId ?? null,
      systemName: system.systemName ?? '', specClass: system.specClass ?? undefined,
      constructionCode: system.constructionCode ?? '', baseMaterial: system.baseMaterial ?? '',
      baseThicknessMm: system.baseThicknessMm ?? undefined,
      layers: (system.layers ?? []).map(layer => ({ order: layer.order ?? undefined, name: layer.name, thicknessMm: layer.thicknessMm ?? undefined, lambda: layer.lambda ?? undefined, alpha: layer.alpha ?? undefined, rValue: layer.rValue ?? undefined })),
      options: (system.options ?? []).map(option => ({
        thicknessMm: option.thicknessMm ?? undefined,
        productThermalResistance: option.productThermalResistance ?? undefined,
        totalThermalResistance: option.totalThermalResistance ?? undefined,
        kValue: option.kValue ?? undefined,
        productSpecId: option.productSpecId ?? null,
        catalogProductId: option.catalogProductId ?? null,
      })),
    })),
  }
}
function apiResult(value: RecognitionDraft): PageRecognitionResult {
  return JSON.parse(JSON.stringify(value)) as PageRecognitionResult
}
const counts = computed(() => ({
  total: pages.value.length,
  confirmed: pages.value.filter(page => page.recognitionStatus === 'CONFIRMED').length,
  reviewPending: pages.value.filter(page => page.recognitionStatus === 'REVIEW_REQUIRED').length,
  processing: pages.value.filter(page => page.recognitionStatus === 'PROCESSING').length,
  queued: pages.value.filter(page => page.recognitionStatus === 'PENDING').length,
  failed: pages.value.filter(page => page.recognitionStatus === 'FAILED').length,
  unrecognized: pages.value.filter(page => !page.recognitionStatus).length,
}))
const progressPercent = computed(() => counts.value.total === 0 ? 0 : Math.round((counts.value.confirmed / counts.value.total) * 100))

async function load(): Promise<void> {
  if (!props.versionId) { pages.value = []; selected.value = null; return }
  loading.value = true
  try {
    const first = await fetchVersionPages(props.versionId, 1, 100)
    const list = [...first.items]
    for (let p = 2; p <= Math.ceil(first.total / 100); p += 1) list.push(...(await fetchVersionPages(props.versionId, p, 100)).items)
    // Recognition metadata is intentionally read from its dedicated contract.
    const enriched: KnowledgePage[] = []
    for (let index = 0; index < list.length; index += 8) {
      const batch = await Promise.all(list.slice(index, index + 8).map(async (page) => {
        try {
          const item = await fetchKnowledgePageRecognition(page.id)
          return { ...page, recognitionStatus: item.recognitionStatus, recognitionWarnings: item.recognitionWarnings, lastRecognitionError: item.lastRecognitionError }
        }
        catch { return page }
      }))
      enriched.push(...batch)
    }
    pages.value = enriched.sort((a, b) => a.pageNumber - b.pageNumber)
    const requested = props.focusPhysicalPageNumber == null ? null : pages.value.find(page => page.physicalPageNumber === props.focusPhysicalPageNumber)
    const current = selected.value && pages.value.find(page => page.id === selected.value?.id)
    await selectPage(requested ?? current ?? pages.value[0] ?? null)
  }
  catch (error) { MessagePlugin.error(normalizeFeedbackError(error).message) }
  finally { loading.value = false }
}

async function selectPage(page: KnowledgePage | null): Promise<void> {
  selected.value = page
  recognition.value = null
  ambiguous.value = false
  confirmIssues.value = []
  mappingState.value = { ...EMPTY_RECOGNITION_MAPPING_STATE }
  if (!page) { draft.value = emptyResult(); return }
  try {
    recognition.value = await fetchKnowledgePageRecognition(page.id)
    draft.value = copyResult(recognition.value.structuredData ?? recognition.value.draftStructuredData ?? recognition.value.confirmedStructuredData)
    draft.value.pageLabel = recognition.value.pageLabel ?? ''
    draft.value.pageTitle = recognition.value.pageTitle ?? ''
    if (!draft.value.fullText) draft.value.fullText = recognition.value.parsedText ?? ''
  }
  catch (error) { MessagePlugin.error(normalizeFeedbackError(error).message) }
}

async function loadThermalSets(): Promise<void> {
  try { thermalSets.value = (await fetchThermalSets({ page: 1, pageSize: 100 })).items.filter(set => set.status === 'DRAFT' && set.atlasDocumentId === props.documentId) }
  catch { thermalSets.value = [] }
}

async function loadDictionaries(): Promise<void> {
  try { publishedSchemes.value = (await fetchPublishedConstructionSchemes({})).items }
  catch { publishedSchemes.value = [] }
  try { publishedSpecs.value = (await fetchPublishedProductSpecs({})).items }
  catch { publishedSpecs.value = [] }
}

function schemeOptionsFor(system: RecognitionDraftSystem): Array<{ label: string, value: string }> {
  const map = new Map<string, { label: string, value: string }>()
  const code = system.constructionCode?.trim()
  const candidates: PageRecognitionSchemeCandidate[] = mappingState.value.schemeCandidates.filter(item => !code || !item.schemeCode || item.schemeCode === code)
  candidates.forEach(item => map.set(item.id, { label: formatSchemeCandidateLabel(item), value: item.id }))
  publishedSchemes.value
    .filter(item => !code || item.schemeCode === code)
    .forEach(item => { if (!map.has(item.id)) map.set(item.id, { label: `${item.name} · ${item.schemeCode}`, value: item.id }) })
  return [...map.values()]
}

function specOptionsFor(system: RecognitionDraftSystem, option: RecognitionDraftOption): Array<{ label: string, value: string }> {
  const map = new Map<string, { label: string, value: string }>()
  const thickness = option.thicknessMm
  const candidates: PageRecognitionProductSpecCandidate[] = mappingState.value.productSpecCandidates
    .filter(item => thickness == null || item.thicknessMm == null || item.thicknessMm === thickness)
  candidates.forEach(item => map.set(item.id, { label: formatProductSpecCandidateLabel(item), value: item.id }))
  publishedSpecs.value
    .filter(item => (thickness == null || item.thicknessMm === thickness) && (!system.specClass || item.specClass === system.specClass))
    .forEach(item => { if (!map.has(item.id)) map.set(item.id, { label: `${item.specCode} · ${item.specClass}型 · ${item.thicknessMm}mm`, value: item.id }) })
  return [...map.values()]
}

function onSchemeChange(system: RecognitionDraftSystem, value: unknown): void {
  system.schemeId = typeof value === 'string' && value ? value : null
  // 构造方案变化后，原产品规格可能不再属于该方案，清空避免提交不兼容映射。
  for (const option of system.options) {
    option.productSpecId = null
    option.catalogProductId = null
  }
  ambiguous.value = false
}

function onSpecChange(option: RecognitionDraftOption, value: unknown): void {
  const id = typeof value === 'string' && value ? value : null
  option.productSpecId = id
  const candidate = id ? mappingState.value.productSpecCandidates.find(item => item.id === id) : undefined
  option.catalogProductId = candidate?.catalogProductId ?? null
  ambiguous.value = false
}

function numeric(value: number | null | undefined): boolean { return value == null || Number.isFinite(value) }
function validate(): string | null {
  if (!draft.value.fullText.trim()) return '页面全文不能为空'
  for (const [systemIndex, system] of draft.value.systems.entries()) {
    for (const [layerIndex, layer] of (system.layers ?? []).entries()) {
      if (!layer.name.trim()) return `构造 ${systemIndex + 1} 的第 ${layerIndex + 1} 层材料不能为空`
      if (!numeric(layer.thicknessMm) || (layer.thicknessMm != null && layer.thicknessMm <= 0)) return '构造层厚度必须是大于 0 的数字'
      if (!numeric(layer.lambda) || !numeric(layer.alpha) || !numeric(layer.rValue)) return 'λ、α、R 必须是有效数字'
    }
    const keys = (system.options ?? []).map(option => option.thicknessMm == null ? '' : String(option.thicknessMm))
    if (new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length) return `构造 ${system.constructionCode || systemIndex + 1} 存在重复厚度选项`
    for (const option of system.options ?? []) {
      if (option.thicknessMm == null || option.thicknessMm <= 0) return '参考方案厚度必须是大于 0 的数字'
      if (!numeric(option.productThermalResistance) || !numeric(option.totalThermalResistance) || !numeric(option.kValue)) return 'R、K 必须是有效数字'
    }
  }
  return null
}
async function saveDraft(): Promise<boolean> {
  if (!selected.value || !reviewAllowed.value) return false
  const message = validate()
  if (message) { MessagePlugin.warning(message); return false }
  saving.value = true
  try {
    const response = await saveKnowledgePageRecognitionDraft(selected.value.id, {
      structuredData: apiResult(draft.value), pageLabel: draft.value.pageLabel?.trim() || null,
      pageTitle: draft.value.pageTitle?.trim() || null, parsedText: draft.value.fullText,
    })
    recognition.value = response.recognition
    ambiguous.value = false
    MessagePlugin.success('识别草稿已保存')
    await load()
    return true
  }
  catch (error) { handleMappingError(error); return false }
  finally { saving.value = false }
}
function handleMappingError(error: unknown): void {
  const state = readRecognitionMappingState(error)
  if (state) {
    mappingState.value = state
    ambiguous.value = state.schemeCandidates.length > 0 || state.productSpecCandidates.length > 0
    MessagePlugin.warning(ambiguous.value ? RECOGNITION_AMBIGUOUS_HINT : RECOGNITION_NOT_FOUND_HINT)
    return
  }
  MessagePlugin.error(normalizeFeedbackError(error).message)
}
function applyConfirmResult(result: PageRecognitionConfirmResult): void {
  if (result.recognition) {
    recognition.value = result.recognition
  }
  confirmIssues.value = result.thermal.mappingIssues ?? []
  const synced = result.thermal.upserted
  if (confirmIssues.value.length > 0) {
    MessagePlugin.warning('页面已确认，但部分热工数据未同步，请检查映射')
  }
  else {
    MessagePlugin.success(`本页已确认，生成 ${result.chunkCount} 个页面分块${synced ? `，同步 ${synced} 条热工行` : ''}`)
  }
}
async function confirmPage(next = false): Promise<void> {
  if (!selected.value || !confirmAllowed.value) return
  const message = validate()
  if (message) { MessagePlugin.warning(message); return }
  if (reviewAllowed.value && !await saveDraft()) return
  confirming.value = true
  try {
    const result = await confirmKnowledgePageRecognition(selected.value.id, {
      ...(thermalSetId.value ? { thermalSetId: thermalSetId.value } : {}), structuredData: apiResult(draft.value),
    })
    applyConfirmResult(result)
    const currentIndex = pages.value.findIndex(page => page.id === selected.value?.id)
    await load()
    if (next) await selectPage(pages.value.slice(currentIndex + 1).find(page => page.recognitionStatus !== 'CONFIRMED') ?? pages.value[currentIndex + 1] ?? null)
  }
  catch (error) { handleMappingError(error) }
  finally { confirming.value = false }
}
async function submitRecognition(page: KnowledgePage, reRecognize: boolean): Promise<void> {
  recognizing.value = true
  try {
    await recognizeKnowledgePage(page.id, reRecognize)
    MessagePlugin.success('已提交页面识别')
    await load()
    startPolling()
  }
  catch (error) { MessagePlugin.error(normalizeFeedbackError(error).message) }
  finally { recognizing.value = false }
}
function recognize(page = selected.value): void {
  if (!page || !recognizeAllowed.value) return
  if (page.recognitionStatus === 'CONFIRMED') {
    const dialog = DialogPlugin.confirm({
      header: '重新识别页面',
      body: '重新识别不会直接覆盖已发布数据，新结果将进入待确认。',
      confirmBtn: '重新识别',
      onConfirm: async () => { await submitRecognition(page, true); dialog.hide() },
    })
    return
  }
  void submitRecognition(page, false)
}
async function recognizePending(): Promise<void> {
  const targets = pages.value.filter(page => page.pageImageUrl && ['PENDING', 'FAILED', null, undefined].includes(page.recognitionStatus))
  if (!targets.length) { MessagePlugin.info('没有待识别页面'); return }
  let succeeded = 0
  for (let index = 0; index < targets.length; index += 4) {
    const results = await Promise.allSettled(targets.slice(index, index + 4).map(page => recognizeKnowledgePage(page.id)))
    succeeded += results.filter(result => result.status === 'fulfilled').length
  }
  const failed = targets.length - succeeded
  if (failed) MessagePlugin.warning(`已提交 ${succeeded} 页识别，${failed} 页提交失败`)
  else MessagePlugin.success(`已提交 ${succeeded} 页识别`)
  await load()
  startPolling()
}
function startPolling(): void {
  if (pollTimer.value) clearInterval(pollTimer.value)
  pollTimer.value = setInterval(() => { void load() }, 3500)
  setTimeout(() => { if (pollTimer.value) clearInterval(pollTimer.value); pollTimer.value = null }, 120000)
}
function addSystem(): void { draft.value.systems.push({ systemName: '', constructionCode: '', baseMaterial: '', layers: [], options: [] }) }
function addLayer(systemIndex: number): void { const system = draft.value.systems[systemIndex]; if (system) system.layers.push({ name: '' }) }
function addOption(systemIndex: number): void { const system = draft.value.systems[systemIndex]; if (system) system.options.push({}) }
function movePage(offset: number): void {
  const index = pages.value.findIndex(page => page.id === selected.value?.id)
  const target = pages.value[index + offset]
  if (target) void selectPage(target)
}

function statusMeta(page: KnowledgePage) { return pageRecognitionStatusMeta(page.recognitionStatus) }

function openViewer(): void {
  if (!selected.value) return
  resetViewer()
  viewerVisible.value = true
}
function resetViewer(): void { viewerScale.value = 1; viewerOffset.value = { x: 0, y: 0 } }
function onViewerWheel(event: WheelEvent): void {
  event.preventDefault()
  const delta = event.deltaY > 0 ? -0.1 : 0.1
  viewerScale.value = Math.min(4, Math.max(0.5, Number((viewerScale.value + delta).toFixed(2))))
}
function onViewerDragStart(event: MouseEvent): void {
  if (viewerScale.value <= 1) return
  viewerDragging.value = true
  viewerDragOrigin.value = { x: event.clientX, y: event.clientY, ox: viewerOffset.value.x, oy: viewerOffset.value.y }
}
function onViewerDragMove(event: MouseEvent): void {
  if (!viewerDragging.value) return
  viewerOffset.value = { x: viewerDragOrigin.value.ox + (event.clientX - viewerDragOrigin.value.x), y: viewerDragOrigin.value.oy + (event.clientY - viewerDragOrigin.value.y) }
}
function onViewerDragEnd(): void { viewerDragging.value = false }

watch(() => props.versionId, () => void load())
watch(() => props.focusPhysicalPageNumber, value => { const page = pages.value.find(item => item.physicalPageNumber === value); if (page) void selectPage(page) })
onMounted(() => { void load(); void loadThermalSets(); void loadDictionaries() })
onUnmounted(() => { if (pollTimer.value) clearInterval(pollTimer.value) })
</script>

<template>
  <section class="knowledge-review">
    <header class="knowledge-review__header">
      <div><h2>识别校验</h2><p>AI 结果仅作候选，人工确认后才写入正式热工行和页面分块。</p></div>
      <div class="knowledge-review__toolbar">
        <span>共 {{ counts.total }} 页</span>
        <t-button v-if="canRecognize" :disabled="versionLocked" :loading="recognizing" variant="outline" @click="recognizePending">批量识别未识别页面</t-button>
      </div>
    </header>

    <div v-if="counts.total" class="knowledge-review__progress">
      <t-progress :label="false" :percentage="progressPercent" :stroke-width="8" theme="line" />
      <div class="knowledge-review__progress-stats">
        <span>已确认 <strong>{{ counts.confirmed }}</strong></span>
        <span>待确认 <strong>{{ counts.reviewPending }}</strong></span>
        <span>识别中 <strong>{{ counts.processing }}</strong></span>
        <span>排队中 <strong>{{ counts.queued }}</strong></span>
        <span>未识别 <strong>{{ counts.unrecognized }}</strong></span>
        <span :class="{ 'is-error': counts.failed > 0 }">失败 <strong>{{ counts.failed }}</strong></span>
      </div>
    </div>

    <t-alert v-if="versionLocked" class="knowledge-review__lock" theme="warning" :message="KNOWLEDGE_VERSION_LOCKED_HINT" />

    <t-loading v-if="loading && !pages.length" loading text="正在加载页面识别状态" />
    <div v-else class="knowledge-review__layout">
      <nav class="knowledge-review__pages">
        <t-button v-for="page in pages" :key="page.id" variant="text" theme="default" :class="{ 'is-selected': selected?.id === page.id }" @click="selectPage(page)">
          <img v-if="page.pageImageUrl" :src="page.pageImageUrl" :alt="`文件第 ${page.physicalPageNumber} 页`" loading="lazy">
          <span v-else class="knowledge-review__no-image">无页面图片</span>
          <span class="knowledge-review__page-meta"><strong>文件第 {{ page.physicalPageNumber }} 页</strong><small>资料页码 {{ page.pageLabel || '—' }}</small><small>{{ page.pageTitle || '未设置标题' }}</small><small>{{ statusMeta(page).label }}</small></span>
        </t-button>
      </nav>
      <div v-if="selected" class="knowledge-review__editor">
        <div class="knowledge-review__image" @click="openViewer">
          <img v-if="recognition?.pageImageUrl || selected.pageImageUrl" :src="recognition?.pageImageUrl || selected.pageImageUrl || ''" :alt="`文件第 ${selected.physicalPageNumber} 页原图`">
          <span v-else>页面图片不可用</span>
        </div>
        <div class="knowledge-review__fields">
          <div class="knowledge-review__page-heading"><div><strong>文件页序：{{ selected.physicalPageNumber }}</strong><span>资料页码：{{ draft.pageLabel || '—' }}</span></div><t-space><t-button size="small" variant="outline" :disabled="pages.findIndex(page => page.id === selected?.id) <= 0" @click="movePage(-1)">上一页</t-button><t-button size="small" variant="outline" :disabled="pages.findIndex(page => page.id === selected?.id) >= pages.length - 1" @click="movePage(1)">下一页</t-button><t-button size="small" variant="outline" @click="openViewer">全屏核对原图</t-button><t-button v-if="canRecognize" size="small" :disabled="versionLocked" :loading="recognizing" @click="recognize()">{{ selected.recognitionStatus === 'CONFIRMED' ? '重新识别' : selected.recognitionStatus === 'FAILED' ? '重试' : '开始识别' }}</t-button></t-space></div>
          <t-alert v-if="recognition?.lastRecognitionError" theme="error" :message="`识别失败：${recognition.lastRecognitionError}`" />
          <t-alert v-if="recognition?.recognitionStatus === 'CONFIRMED'" theme="warning" message="重新识别不会直接覆盖已发布数据，新结果将进入待确认。" />
          <t-alert v-if="ambiguous" theme="warning" :message="RECOGNITION_AMBIGUOUS_HINT" />
          <t-alert v-if="thermalSetLocked" theme="warning" :message="KNOWLEDGE_THERMAL_SET_LOCKED_HINT" />
          <t-alert
            v-if="confirmIssues.length"
            theme="warning"
            title="页面已确认，但部分热工数据未同步"
          >
            <ul class="knowledge-review__issues">
              <li v-for="(issue, index) in confirmIssues" :key="index">{{ describeMappingIssue(issue) }}</li>
            </ul>
          </t-alert>

          <t-form label-align="top">
            <div class="knowledge-review__grid"><t-form-item label="资料页码"><t-input v-model="draft.pageLabel" maxlength="32" :disabled="!reviewAllowed" /></t-form-item><t-form-item label="页面标题"><t-input v-model="draft.pageTitle" maxlength="255" :disabled="!reviewAllowed" /></t-form-item></div>
            <t-form-item label="页面全文"><t-textarea v-model="draft.fullText" :autosize="{ minRows: 4, maxRows: 10 }" :disabled="!reviewAllowed" /></t-form-item>
            <div v-for="(system, systemIndex) in draft.systems" :key="systemIndex" class="knowledge-review__system">
              <header><strong>构造 {{ system.constructionCode || `#${systemIndex + 1}` }}</strong><t-button v-if="reviewAllowed" size="small" theme="danger" variant="text" @click="draft.systems.splice(systemIndex, 1)">删除构造</t-button></header>
              <div class="knowledge-review__grid"><t-form-item label="体系"><t-input v-model="system.systemName" :disabled="!reviewAllowed" /></t-form-item><t-form-item label="规格类型"><t-select v-model="system.specClass" :options="[{ label: 'I 型', value: 'I' }, { label: 'II 型', value: 'II' }, { label: 'III 型', value: 'III' }]" clearable :disabled="!reviewAllowed" /></t-form-item><t-form-item label="构造编号"><t-input v-model="system.constructionCode" :disabled="!reviewAllowed" /></t-form-item><t-form-item label="基层材料"><t-input v-model="system.baseMaterial" :disabled="!reviewAllowed" /></t-form-item><t-form-item label="基层厚度"><t-input-number v-model="system.baseThicknessMm" :min="0" :disabled="!reviewAllowed" /></t-form-item></div>
              <div class="knowledge-review__mapping">
                <span class="knowledge-review__mapping-label">正式构造方案</span>
                <t-select
                  :model-value="system.schemeId ?? ''"
                  :options="schemeOptionsFor(system)"
                  :disabled="!reviewAllowed"
                  clearable
                  filterable
                  placeholder="请选择已发布的正式构造方案"
                  @change="(value: unknown) => onSchemeChange(system, value)"
                />
                <span class="knowledge-review__mapping-hint">{{ system.schemeId ? '已映射到正式构造方案' : '未映射，确认时将按构造编号自动匹配' }}</span>
              </div>
              <div class="knowledge-review__subhead"><strong>构造层</strong><t-button v-if="reviewAllowed" size="small" variant="text" @click="addLayer(systemIndex)">新增一层</t-button></div>
              <div v-for="(layer, layerIndex) in system.layers" :key="layerIndex" class="knowledge-review__row"><t-input v-model="layer.name" placeholder="材料" :disabled="!reviewAllowed"/><t-input-number v-model="layer.thicknessMm" placeholder="厚度" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="layer.lambda" placeholder="λ" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="layer.alpha" placeholder="α" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="layer.rValue" placeholder="R" :min="0" :disabled="!reviewAllowed"/><t-button v-if="reviewAllowed" theme="danger" variant="text" @click="system.layers?.splice(layerIndex, 1)">删除</t-button></div>
              <div class="knowledge-review__subhead"><strong>参考方案</strong><t-button v-if="reviewAllowed" size="small" variant="text" @click="addOption(systemIndex)">新增方案</t-button></div>
              <div v-for="(option, optionIndex) in system.options" :key="optionIndex" class="knowledge-review__option-block">
                <div class="knowledge-review__row"><t-input-number v-model="option.thicknessMm" placeholder="厚度 mm" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="option.productThermalResistance" placeholder="产品层 R" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="option.totalThermalResistance" placeholder="总 R" :min="0" :disabled="!reviewAllowed"/><t-input-number v-model="option.kValue" placeholder="K" :min="0" :disabled="!reviewAllowed"/><t-button v-if="reviewAllowed" theme="danger" variant="text" @click="system.options?.splice(optionIndex, 1)">删除</t-button></div>
                <div class="knowledge-review__mapping">
                  <span class="knowledge-review__mapping-label">正式产品规格</span>
                  <t-select
                    :model-value="option.productSpecId ?? ''"
                    :options="specOptionsFor(system, option)"
                    :disabled="!reviewAllowed"
                    clearable
                    filterable
                    :placeholder="option.thicknessMm ? `请选择 ${option.thicknessMm}mm 对应的正式产品规格` : '请先填写厚度，再选择正式产品规格'"
                    @change="(value: unknown) => onSpecChange(option, value)"
                  />
                  <span class="knowledge-review__mapping-hint">{{ option.productSpecId ? '已映射到正式产品规格' : '未映射，确认时将按厚度/规格类型自动匹配' }}</span>
                </div>
              </div>
            </div>
            <t-button v-if="reviewAllowed" variant="outline" @click="addSystem">新增构造块</t-button>
          </t-form>
          <t-form-item v-if="confirmAllowed && thermalSets.length" label="同步到本资料关联的热工参考集"><t-select v-model="thermalSetId" clearable placeholder="选择草稿参考集，同步正式热工行" :options="thermalSets.map(item => ({ label: `${item.name} · ${item.code}`, value: item.id }))" /></t-form-item>
          <t-alert v-else-if="confirmAllowed && draft.systems.some(system => system.options.length)" theme="warning" message="当前资料没有关联的草稿热工参考集；确认后会发布页面分块，但不会生成正式热工参考数据。" />
          <footer class="knowledge-review__actions"><t-button v-if="canReview" :disabled="!reviewAllowed" :loading="saving" variant="outline" @click="saveDraft">保存草稿</t-button><t-button v-if="canConfirm" :disabled="!confirmAllowed" :loading="confirming" theme="primary" @click="confirmPage(false)">确认本页</t-button><t-button v-if="canConfirm" :disabled="!confirmAllowed" :loading="confirming" theme="primary" variant="outline" @click="confirmPage(true)">确认并下一页</t-button></footer>
        </div>
      </div>
      <t-empty v-else description="先上传页面图片，再进行识别和校验" />
    </div>

    <t-dialog
      v-model:visible="viewerVisible"
      :footer="false"
      header="原图核对"
      width="min(1180px, 96vw)"
      destroy-on-close
    >
      <div class="knowledge-review__viewer-toolbar">
        <span>文件第 {{ selected?.physicalPageNumber ?? '—' }} 页 · 资料页码 {{ draft.pageLabel || '—' }}（关闭后保留当前编辑内容）</span>
        <t-space>
          <t-button size="small" @click="viewerScale = Math.max(0.5, Number((viewerScale - 0.1).toFixed(2)))">缩小</t-button>
          <t-button size="small" @click="viewerScale = Math.min(4, Number((viewerScale + 0.1).toFixed(2)))">放大</t-button>
          <t-button size="small" variant="outline" @click="resetViewer">复位</t-button>
        </t-space>
      </div>
      <div
        class="knowledge-review__viewer-stage"
        @wheel="onViewerWheel"
        @mousedown="onViewerDragStart"
        @mousemove="onViewerDragMove"
        @mouseup="onViewerDragEnd"
        @mouseleave="onViewerDragEnd"
      >
        <img
          v-if="recognition?.pageImageUrl || selected?.pageImageUrl"
          :src="recognition?.pageImageUrl || selected?.pageImageUrl || ''"
          :style="{ transform: `translate(${viewerOffset.x}px, ${viewerOffset.y}px) scale(${viewerScale})`, cursor: viewerScale > 1 ? (viewerDragging ? 'grabbing' : 'grab') : 'default' }"
          alt="原图核对"
          draggable="false"
        >
      </div>
    </t-dialog>
  </section>
</template>

<style scoped>
.knowledge-review{padding:20px}.knowledge-review__header{display:flex;justify-content:space-between;gap:16px;margin-bottom:16px}.knowledge-review h2{margin:0 0 6px;font-size:18px}.knowledge-review p{margin:0;color:var(--td-text-color-secondary)}.knowledge-review__toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;color:var(--td-text-color-secondary);font-size:var(--td-font-size-body-small)}
.knowledge-review__progress{margin-bottom:16px}.knowledge-review__progress-stats{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;color:var(--td-text-color-secondary);font-size:var(--td-font-size-body-small)}.knowledge-review__progress-stats strong{color:var(--td-text-color-primary)}.knowledge-review__progress-stats .is-error,.knowledge-review__progress-stats .is-error strong{color:var(--td-error-color)}
.knowledge-review__lock{margin-bottom:16px}
.knowledge-review__issues{margin:0;padding-left:18px}
.knowledge-review__layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;min-height:600px}.knowledge-review__pages{display:grid;align-content:start;gap:8px;max-height:75vh;overflow:auto}.knowledge-review__pages :deep(.t-button){display:grid;height:auto;grid-template-columns:58px 1fr;gap:9px;padding:7px;border:1px solid var(--td-component-stroke);border-radius:var(--td-radius-small);background:var(--td-bg-color-container);text-align:left;cursor:pointer}.knowledge-review__pages :deep(.t-button.is-selected){border-color:var(--td-brand-color)}.knowledge-review__pages img,.knowledge-review__no-image{width:58px;height:74px;object-fit:contain;background:var(--td-bg-color-secondarycontainer)}.knowledge-review__no-image{display:grid;place-items:center;font-size:10px;color:var(--td-text-color-placeholder)}.knowledge-review__page-meta{display:grid;align-content:start;gap:3px;min-width:0}.knowledge-review__page-meta small{overflow:hidden;color:var(--td-text-color-secondary);text-overflow:ellipsis;white-space:nowrap}.knowledge-review__editor{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(480px,1.2fr);gap:16px;align-items:start}.knowledge-review__image{position:sticky;top:12px;display:grid;min-height:400px;max-height:75vh;place-items:center;overflow:auto;background:var(--td-bg-color-secondarycontainer);cursor:zoom-in}.knowledge-review__image img{max-width:100%;max-height:75vh;object-fit:contain}.knowledge-review__fields{min-width:0}.knowledge-review__page-heading,.knowledge-review__actions,.knowledge-review__subhead,.knowledge-review__system header{display:flex;align-items:center;justify-content:space-between;gap:12px}.knowledge-review__page-heading{margin-bottom:12px}.knowledge-review__page-heading div{display:grid;gap:3px}.knowledge-review__page-heading span{color:var(--td-text-color-secondary);font-size:var(--td-font-size-body-small)}.knowledge-review__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.knowledge-review__system{padding:14px;margin-bottom:14px;border:1px solid var(--td-component-stroke);border-radius:var(--td-radius-medium)}.knowledge-review__subhead{margin:12px 0 8px}.knowledge-review__row{display:grid;grid-template-columns:1.4fr repeat(4,1fr) auto;gap:8px;margin-bottom:8px}.knowledge-review__option-block{padding:10px;margin-bottom:10px;border:1px dashed var(--td-component-stroke);border-radius:var(--td-radius-small)}.knowledge-review__mapping{display:grid;gap:6px;margin:8px 0}.knowledge-review__mapping-label{color:var(--td-text-color-secondary);font-size:var(--td-font-size-body-small)}.knowledge-review__mapping-hint{color:var(--td-text-color-placeholder);font-size:var(--td-font-size-body-small)}.knowledge-review__actions{justify-content:flex-end;margin-top:16px}
.knowledge-review__viewer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;color:var(--td-text-color-secondary)}.knowledge-review__viewer-stage{max-height:72vh;overflow:hidden;background:var(--td-bg-color-secondarycontainer);text-align:center;user-select:none}.knowledge-review__viewer-stage img{max-width:100%;max-height:72vh;object-fit:contain;transform-origin:center center;transition:transform .08s linear}
</style>
