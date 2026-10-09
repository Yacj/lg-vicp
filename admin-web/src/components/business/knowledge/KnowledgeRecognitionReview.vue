<script setup lang="ts">
import type { RecognitionDraft } from '@/components/business/knowledge/recognition/types'
import type { ConstructionScheme } from '@/types/construction'
import type {
  BatchConfirmResult,
  KnowledgePage,
  KnowledgePageRecognition,
  KnowledgePageRecognitionSummary,
  PageRecognitionConfirmResult,
  PageRecognitionMappingIssue,
  PageRecognitionResult,
} from '@/types/knowledge'
import type { ProductSpec } from '@/types/masterdata'
import type { ThermalSet } from '@/types/thermal'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { fetchPublishedConstructionSchemes } from '@/api/modules/construction'
import {
  batchConfirmVersionPages,
  confirmKnowledgePageRecognition,
  fetchKnowledgePageRecognition,
  fetchVersionPages,
  recognizeKnowledgePage,
  saveKnowledgePageRecognitionDraft,
} from '@/api/modules/knowledge'
import { fetchPublishedProductSpecs } from '@/api/modules/masterdata'
import { fetchThermalSets } from '@/api/modules/thermal'
import KnowledgeOriginalPageViewer from '@/components/business/knowledge/KnowledgeOriginalPageViewer.vue'
import RecognitionBasicSection from '@/components/business/knowledge/recognition/RecognitionBasicSection.vue'
import RecognitionMappingSection from '@/components/business/knowledge/recognition/RecognitionMappingSection.vue'
import RecognitionTextSection from '@/components/business/knowledge/recognition/RecognitionTextSection.vue'
import RecognitionThermalSection from '@/components/business/knowledge/recognition/RecognitionThermalSection.vue'
import RecognitionWarningsSection from '@/components/business/knowledge/recognition/RecognitionWarningsSection.vue'
import { KNOWLEDGE_VERSION_LOCKED_HINT, useKnowledgeVersionEditable } from '@/composables/useKnowledgeVersionEditable'
import { useKnowledgeReviewNavigation } from '@/composables/useKnowledgeReviewNavigation'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError, businessUserMessage } from '@/utils/business-error'
import {
  currentRecognitionCandidate,
  EMPTY_RECOGNITION_MAPPING_STATE,
  pageRecognitionStatusMeta,
  readRecognitionMappingState,
  RECOGNITION_AMBIGUOUS_HINT,
  RECOGNITION_NOT_FOUND_HINT,
} from '@/utils/knowledge-recognition'

const props = withDefaults(defineProps<{
  documentId: string
  versionId: string | null
  versionEditable: boolean
  focusPhysicalPageNumber?: number | null
  /** 页面级生命周期轮询心跳：变化时静默刷新页面识别状态。 */
  pollTick?: number
  /** 是否处于轮询窗口内。 */
  polling?: boolean
}>(), {
  focusPhysicalPageNumber: null,
  pollTick: 0,
  polling: false,
})

const emit = defineEmits<{
  openGalleryPage: [physicalPageNumber: number | null]
  /** 提交识别 / 确认后请求页面级刷新，由父层决定是否开启轮询。 */
  refresh: []
}>()

const { canAccess } = usePermissionAccess()
const canRecognize = computed(() => canAccess({ permissions: ['system:knowledge:page:recognize'] }))
const canReview = computed(() => canAccess({ permissions: ['system:knowledge:page:review'] }))
const canConfirm = computed(() => canAccess({ permissions: ['system:knowledge:page:confirm'] }))
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))

const pages = shallowRef<KnowledgePage[]>([])
const failedImageIds = ref<Set<string>>(new Set())
function markImageUnavailable(id: string): void {
  failedImageIds.value = new Set([...failedImageIds.value, id])
}
const selected = ref<KnowledgePage | null>(null)
const recognition = ref<KnowledgePageRecognition | null>(null)
/** 后端页面列表返回的识别进度汇总（唯一事实源，不按页面列表自行统计）。 */
const summary = ref<KnowledgePageRecognitionSummary | null>(null)
const draft = ref<RecognitionDraft>(emptyResult())
const thermalSets = ref<ThermalSet[]>([])
const thermalSetId = ref('')
const loading = ref(false)
const loadError = ref<unknown>(null)
const saving = ref(false)
const recognizing = ref(false)
const batchRecognizing = ref(false)
const batchSubmitted = ref(0)
const batchTotal = ref(0)
const batchSubmitFailures = ref<Array<{ pageId: string, physicalPageNumber: number, reason: string }>>([])
const confirming = ref(false)
const batchConfirming = ref(false)
const batchResult = ref<BatchConfirmResult | null>(null)
const pageListElement = ref<HTMLElement | null>(null)
const detailLoading = ref(false)
let detailController: AbortController | null = null
let loadSequence = 0
let detailSequence = 0
let savedDraftSnapshot = ''
let loadedVersionId: string | null = null

/** 正式业务对象字典：用于人工映射下拉，接口失败时降级为仅候选。 */
const publishedSchemes = ref<ConstructionScheme[]>([])
const publishedSpecs = ref<ProductSpec[]>([])
/** AMBIGUOUS 时后端返回的候选，绑定到当前页 system/option。 */
const mappingState = ref({ ...EMPTY_RECOGNITION_MAPPING_STATE })
const ambiguous = ref(false)
/** 确认成功但部分热工数据未同步时的映射问题。 */
const confirmIssues = ref<PageRecognitionMappingIssue[]>([])

const viewerVisible = ref(false)

const editableState = useKnowledgeVersionEditable(computed(() => ({
  status: recognition.value?.versionStatus ?? null,
  versionEditable: recognition.value?.versionEditable ?? null,
  thermalSetEditable: recognition.value?.thermalSetEditable ?? null,
  permission: true,
})))
const versionLocked = computed(() => !props.versionEditable || Boolean(recognition.value && !editableState.value.editable))
const thermalSetLocked = computed(() => Boolean(selected.value && recognition.value && recognition.value.thermalSetEditable === false))
const recognitionBusy = computed(() => selected.value?.recognitionStatus === 'PENDING' || selected.value?.recognitionStatus === 'PROCESSING')
const reviewAllowed = computed(() => canReview.value && !versionLocked.value && !recognitionBusy.value && Boolean(recognition.value))
const confirmAllowed = computed(() => canConfirm.value && !versionLocked.value && selected.value?.recognitionStatus === 'REVIEW_REQUIRED' && recognition.value?.recognitionStatus === 'REVIEW_REQUIRED')
const recognizeAllowed = computed(() => canRecognize.value && !versionLocked.value)

function emptyResult(): RecognitionDraft {
  return { pageLabel: '', pageTitle: '', fullText: '', systems: [] }
}

function copyResult(value: PageRecognitionResult | null | undefined): RecognitionDraft {
  if (!value) {
    return emptyResult()
  }
  return {
    pageLabel: value.pageLabel ?? '',
    pageTitle: value.pageTitle ?? '',
    fullText: value.fullText ?? '',
    notes: value.notes,
    warnings: value.warnings,
    systems: (value.systems ?? []).map(system => ({
      schemeId: system.schemeId ?? null,
      systemName: system.systemName ?? '',
      specClass: system.specClass ?? undefined,
      constructionCode: system.constructionCode ?? '',
      baseMaterial: system.baseMaterial ?? '',
      baseThicknessMm: system.baseThicknessMm ?? undefined,
      layers: (system.layers ?? []).map(layer => ({
        order: layer.order ?? undefined,
        name: layer.name,
        thicknessMm: layer.thicknessMm ?? undefined,
        lambda: layer.lambda ?? undefined,
        alpha: layer.alpha ?? undefined,
        rValue: layer.rValue ?? undefined,
      })),
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

const counts = computed(() => {
  const current = summary.value
  return {
    total: current?.total ?? pages.value.length,
    confirmed: current?.confirmed ?? 0,
    reviewPending: current?.reviewRequired ?? 0,
    processing: current?.processing ?? 0,
    queued: current?.pending ?? 0,
    failed: current?.failed ?? 0,
    missingImage: current?.missingImage ?? 0,
  }
})
const progressPercent = computed(() => counts.value.total === 0 ? 0 : Math.round((counts.value.confirmed / counts.value.total) * 100))
const recognitionTargets = computed(() => pages.value.filter(page => page.pageImageUrl && (
  page.recognitionStatus === 'FAILED'
  || page.recognitionStatus == null
  || (page.recognitionStatus === 'PENDING' && !page.recognitionRunId)
)))
const recognitionNotes = computed(() => [...new Set([
  ...(draft.value.notes ?? []),
].map(item => item.trim()).filter(Boolean))])
const recognitionWarnings = computed(() => [...new Set([
  ...(draft.value.warnings ?? []),
  ...(recognition.value?.recognitionWarnings ?? []),
].map(item => item.trim()).filter(Boolean))])

const { statusFilter, filteredPages, selectFirstFilteredPage } = useKnowledgeReviewNavigation(pages, selectPage)

function changeFilter(value: unknown): void {
  if (value !== 'ALL' && value !== 'REVIEW_REQUIRED' && value !== 'CONFIRMED' && value !== 'FAILED' && value !== 'UNPROCESSED') return
  statusFilter.value = value
  pageListElement.value?.scrollTo({ top: 0 })
  void selectFirstFilteredPage()
}

const filterOptions = [
  { label: '全部页面', value: 'ALL' },
  { label: '待核对', value: 'REVIEW_REQUIRED' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '识别失败', value: 'FAILED' },
  { label: '未处理', value: 'UNPROCESSED' },
]

const thermalSetOptions = computed(() => thermalSets.value.map(item => ({ label: `${item.name} · ${item.code}`, value: item.id })))
const hasThermalOptions = computed(() => draft.value.systems.some(system => system.options.length > 0))
const recognizeLabel = computed(() => {
  const status = selected.value?.recognitionStatus
  if (status === 'CONFIRMED') {
    return '重新识别'
  }
  if (status === 'FAILED') {
    return '重试识别'
  }
  return '开始识别'
})

async function load(silent = false): Promise<void> {
  const request = ++loadSequence
  const versionId = props.versionId
  if (versionId !== loadedVersionId) {
    loadedVersionId = versionId
    detailSequence += 1
    detailController?.abort()
    pages.value = []
    selected.value = null
    recognition.value = null
    draft.value = emptyResult()
    summary.value = null
    savedDraftSnapshot = JSON.stringify(draft.value)
  }
  if (!versionId) {
    return
  }
  if (!silent) loading.value = true
  try {
    const first = await fetchVersionPages(versionId, 1, 100)
    const list = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      list.push(...(await fetchVersionPages(versionId, page, 100)).items)
    }
    if (request !== loadSequence || versionId !== props.versionId) return
    // 页面列表已直接返回 recognitionStatus / recognitionWarnings / lastRecognitionError，
    // 无需逐页再请求 GET /pages/:pageId/recognition（旧实现为 N+1 请求风暴）。
    pages.value = list.sort((a, b) => a.pageNumber - b.pageNumber)
    summary.value = first.pageRecognitionSummary
    const requested = props.focusPhysicalPageNumber == null ? null : filteredPages.value.find(page => page.physicalPageNumber === props.focusPhysicalPageNumber)
    const current = selected.value && pages.value.find(page => page.id === selected.value?.id)
    const visibleCurrent = current && filteredPages.value.some(page => page.id === current.id) ? current : null
    const target = requested ?? visibleCurrent ?? filteredPages.value[0] ?? null
    const statusChanged = Boolean(current && selected.value?.recognitionStatus !== current.recognitionStatus)
    if (silent && current && target?.id === current.id) {
      selected.value = current
      const mustHidePreviousResult = ['PENDING', 'PROCESSING', 'FAILED', 'CONFIRMED'].includes(current.recognitionStatus ?? '')
      if (statusChanged && (mustHidePreviousResult || JSON.stringify(draft.value) === savedDraftSnapshot)) {
        await selectPage(current)
      }
    }
    else {
      await selectPage(target)
    }
    loadError.value = null
  }
  catch (error) {
    if (request === loadSequence) {
      loadError.value = error
      if (!silent) MessagePlugin.error(businessUserError(error))
    }
  }
  finally {
    if (request === loadSequence && !silent) loading.value = false
  }
}

async function selectPage(page: KnowledgePage | null): Promise<void> {
  const request = ++detailSequence
  detailController?.abort()
  const controller = new AbortController()
  detailController = controller
  detailLoading.value = Boolean(page)
  selected.value = page
  recognition.value = null
  draft.value = emptyResult()
  ambiguous.value = false
  confirmIssues.value = []
  mappingState.value = { ...EMPTY_RECOGNITION_MAPPING_STATE }
  if (!page) {
    savedDraftSnapshot = JSON.stringify(draft.value)
    return
  }
  try {
    const detail = await fetchKnowledgePageRecognition(page.id, controller.signal)
    if (request !== detailSequence || selected.value?.id !== page.id) return
    recognition.value = detail
    const currentCandidate = currentRecognitionCandidate(detail, selected.value?.recognitionStatus ?? null)
    draft.value = copyResult(currentCandidate)
    draft.value.pageLabel = recognition.value.pageLabel ?? ''
    draft.value.pageTitle = recognition.value.pageTitle ?? ''
    if (currentCandidate && !draft.value.fullText) {
      draft.value.fullText = recognition.value.parsedText ?? ''
    }
    savedDraftSnapshot = JSON.stringify(draft.value)
  }
  catch (error) {
    if (request === detailSequence && !controller.signal.aborted) MessagePlugin.error(businessUserError(error))
  }
  finally {
    if (request === detailSequence) detailLoading.value = false
  }
}

async function loadThermalSets(): Promise<void> {
  try {
    const first = await fetchThermalSets({ page: 1, pageSize: 100 })
    const items = [...first.items]
    for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) {
      items.push(...(await fetchThermalSets({ page, pageSize: 100 })).items)
    }
    thermalSets.value = items.filter(set => set.status === 'DRAFT' && set.atlasDocumentId === props.documentId)
    // 唯一 DRAFT 参考集自动选中；多个需人工选择；没有则提示本次确认仅用于普通知识问答。
    if (thermalSets.value.length === 1) {
      thermalSetId.value = thermalSets.value[0]!.id
    }
    else {
      thermalSetId.value = ''
    }
  }
  catch {
    thermalSets.value = []
    thermalSetId.value = ''
  }
}

async function loadDictionaries(): Promise<void> {
  try {
    publishedSchemes.value = (await fetchPublishedConstructionSchemes({})).items
  }
  catch {
    publishedSchemes.value = []
  }
  try {
    publishedSpecs.value = (await fetchPublishedProductSpecs({})).items
  }
  catch {
    publishedSpecs.value = []
  }
}

function numeric(value: number | null | undefined): boolean {
  return value == null || Number.isFinite(value)
}

function validate(): string | null {
  if (!draft.value.fullText.trim()) {
    return '页面全文不能为空'
  }
  for (const [systemIndex, system] of draft.value.systems.entries()) {
    for (const [layerIndex, layer] of (system.layers ?? []).entries()) {
      if (!layer.name.trim()) {
        return `构造 ${systemIndex + 1} 的第 ${layerIndex + 1} 层材料不能为空`
      }
      if (!numeric(layer.thicknessMm) || (layer.thicknessMm != null && layer.thicknessMm <= 0)) {
        return '构造层厚度必须是大于 0 的数字'
      }
      if (!numeric(layer.lambda) || !numeric(layer.alpha) || !numeric(layer.rValue)) {
        return 'λ、α、R 必须是有效数字'
      }
    }
    const keys = (system.options ?? []).map(option => option.thicknessMm == null ? '' : String(option.thicknessMm))
    if (new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length) {
      return `构造 ${system.constructionCode || systemIndex + 1} 存在重复厚度选项`
    }
    for (const option of system.options ?? []) {
      if (option.thicknessMm == null || option.thicknessMm <= 0) {
        return '参考方案厚度必须是大于 0 的数字'
      }
      if (!numeric(option.productThermalResistance) || !numeric(option.totalThermalResistance) || !numeric(option.kValue)) {
        return '产品层热阻、总热阻与 K 必须是有效数字'
      }
    }
  }
  return null
}

async function saveDraft(): Promise<boolean> {
  if (!selected.value || !reviewAllowed.value) {
    return false
  }
  const message = validate()
  if (message) {
    MessagePlugin.warning(message)
    return false
  }
  saving.value = true
  try {
    const response = await saveKnowledgePageRecognitionDraft(selected.value.id, {
      structuredData: apiResult(draft.value),
      pageLabel: draft.value.pageLabel?.trim() || null,
      pageTitle: draft.value.pageTitle?.trim() || null,
      parsedText: draft.value.fullText,
    })
    recognition.value = response.recognition
    ambiguous.value = false
    MessagePlugin.success('识别草稿已保存')
    await load()
    return true
  }
  catch (error) {
    handleMappingError(error)
    return false
  }
  finally {
    saving.value = false
  }
}

function handleMappingError(error: unknown): void {
  const state = readRecognitionMappingState(error)
  if (state) {
    mappingState.value = state
    ambiguous.value = state.schemeCandidates.length > 0 || state.productSpecCandidates.length > 0
    MessagePlugin.warning(ambiguous.value ? RECOGNITION_AMBIGUOUS_HINT : RECOGNITION_NOT_FOUND_HINT)
    return
  }
  MessagePlugin.error(businessUserError(error))
}

function applyConfirmResult(result: PageRecognitionConfirmResult): void {
  if (result.recognition) {
    recognition.value = result.recognition
  }
  confirmIssues.value = result.thermal.mappingIssues ?? []
  const synced = result.thermal.upserted
  const skipped = result.thermal.skipped
  const warnings = result.thermal.warnings ?? []
  if (confirmIssues.value.length > 0) {
    MessagePlugin.warning('页面已确认，但部分热工数据未同步，请检查映射')
  }
  else if (!thermalSetId.value && hasThermalOptions.value && synced === 0) {
    MessagePlugin.info('页面已确认，可用于资料问答。尚未选择可编辑的热工参考集，参考档位暂未同步到方案查询。')
  }
  else if (warnings.length > 0) {
    MessagePlugin.warning(`本页已确认，但有提示需要核对：${warnings.map(businessUserMessage).join('；')}`)
  }
  else {
    const skippedHint = skipped > 0 ? `，${skipped} 条热工数据未同步` : ''
    MessagePlugin.success(`本页已确认${synced ? `，同步 ${synced} 条热工数据` : ''}${skippedHint}`)
  }
}

async function confirmPage(next = false): Promise<void> {
  if (!selected.value || !confirmAllowed.value) {
    return
  }
  const message = validate()
  if (message) {
    MessagePlugin.warning(message)
    return
  }
  if (reviewAllowed.value && !await saveDraft()) {
    return
  }
  confirming.value = true
  try {
    const confirmedPageId = selected.value.id
    const confirmedPageNumber = selected.value.physicalPageNumber
    const result = await confirmKnowledgePageRecognition(confirmedPageId, {
      ...(thermalSetId.value ? { thermalSetId: thermalSetId.value } : {}),
    })
    applyConfirmResult(result)
    await load()
    if (next) {
      const pending = pages.value.filter(page => page.recognitionStatus === 'REVIEW_REQUIRED' && page.id !== confirmedPageId)
      const target = pending.find(page => page.physicalPageNumber > confirmedPageNumber) ?? pending[0]
      if (target) {
        statusFilter.value = 'REVIEW_REQUIRED'
        await selectPage(target)
      }
      else {
        MessagePlugin.info('所有待核对页面都已处理。')
      }
    }
  }
  catch (error) {
    handleMappingError(error)
  }
  finally {
    confirming.value = false
  }
}

async function submitRecognition(page: KnowledgePage, reRecognize: boolean): Promise<void> {
  recognizing.value = true
  try {
    await recognizeKnowledgePage(page.id, reRecognize)
    MessagePlugin.success('已提交页面识别')
    await load()
    emit('refresh')
  }
  catch (error) {
    MessagePlugin.error(businessUserError(error))
  }
  finally {
    recognizing.value = false
  }
}

function recognize(page = selected.value): void {
  if (!page || !recognizeAllowed.value) {
    return
  }
  if (page.recognitionStatus === 'CONFIRMED') {
    const dialog = DialogPlugin.confirm({
      header: '重新识别页面',
      body: '重新识别不会直接覆盖已发布数据，新结果将进入待确认。',
      confirmBtn: '重新识别',
      onConfirm: async () => {
        await submitRecognition(page, true)
        dialog.hide()
      },
    })
    return
  }
  void submitRecognition(page, false)
}

async function recognizePending(): Promise<void> {
  if (batchRecognizing.value || batchConfirming.value || versionLocked.value || !canRecognize.value) return
  if (!pages.value.length) await load()
  const targets = recognitionTargets.value
  if (!targets.length) {
    MessagePlugin.info('没有待识别页面')
    return
  }
  batchRecognizing.value = true
  batchSubmitted.value = 0
  batchTotal.value = targets.length
  batchSubmitFailures.value = []
  try {
    for (let index = 0; index < targets.length; index += 4) {
      const group = targets.slice(index, index + 4)
      const results = await Promise.allSettled(group.map(page => recognizeKnowledgePage(page.id)))
      results.forEach((result, offset) => {
        if (result.status === 'rejected') {
          batchSubmitFailures.value.push({ pageId: group[offset]!.id, physicalPageNumber: group[offset]!.physicalPageNumber, reason: businessUserError(result.reason) })
        }
      })
      batchSubmitted.value += group.length
    }
    const succeeded = targets.length - batchSubmitFailures.value.length
    MessagePlugin[batchSubmitFailures.value.length ? 'warning' : 'success'](`已提交 ${succeeded} 页识别，${batchSubmitFailures.value.length} 页提交失败`)
    await load()
    emit('refresh')
  }
  finally {
    batchRecognizing.value = false
  }
}

/**
 * 批量确认：后端逐页独立确认，返回 success / failed / skipped 三段结果。
 * 前端必须分别消费，不得只看请求成功就提示「全部确认成功」。
 */
async function confirmPages(safeOnly = true, pageIds?: string[], versionId = props.versionId): Promise<void> {
  if (!versionId || versionId !== props.versionId || !canConfirm.value || versionLocked.value || batchConfirming.value || batchRecognizing.value) {
    return
  }
  if (!pages.value.length) await load()
  if (!counts.value.reviewPending) {
    MessagePlugin.info('没有待核对页面')
    return
  }
  batchConfirming.value = true
  batchResult.value = null
  try {
    if (recognition.value && JSON.stringify(draft.value) !== savedDraftSnapshot && !await saveDraft()) return
    if (versionId !== props.versionId || versionLocked.value || !canConfirm.value) return
    const result = await batchConfirmVersionPages(versionId, {
      confirmSafeOnly: safeOnly,
      ...(pageIds ? { pageIds } : {}),
      ...(thermalSetId.value ? { thermalSetId: thermalSetId.value } : {}),
    })
    if (versionId !== props.versionId) return
    batchResult.value = result
    if (result.confirmed > 0) {
      MessagePlugin.success(`批量确认完成：成功 ${result.confirmed} 页`)
    }
    else {
      MessagePlugin.warning('本次没有可确认的页面')
    }
    await load()
    emit('refresh')
  }
  catch (error) {
    MessagePlugin.error(businessUserError(error))
  }
  finally {
    batchConfirming.value = false
  }
}

function confirmAllPending(): void {
  const versionId = props.versionId
  const targets = pages.value.filter(page => page.recognitionStatus === 'REVIEW_REQUIRED').map(page => page.id)
  if (!targets.length || !canConfirm.value || versionLocked.value || batchConfirming.value || batchRecognizing.value) return
  const dialog = DialogPlugin.confirm({
    header: '批量确认待核对页',
    body: `将确认 ${targets.length} 页已保存的识别结果。请确保已核对内容；未满足确认条件的页面会保留并显示原因。`,
    confirmBtn: `确认 ${targets.length} 页`,
    onConfirm: () => {
      dialog.hide()
      void confirmPages(false, targets, versionId)
    },
  })
}

function focusFailedPages(): void {
  statusFilter.value = 'REVIEW_REQUIRED'
  const first = pages.value.find(page => page.id === batchResult.value?.failed[0]?.pageId)
  if (first) {
    void selectPage(first)
  }
}

function focusPendingPages(): void {
  statusFilter.value = 'REVIEW_REQUIRED'
  const first = pages.value.find(page => page.id === batchResult.value?.skipped[0]?.pageId)
  if (first) {
    void selectPage(first)
  }
}

function movePage(offset: number): void {
  const list = filteredPages.value
  const index = list.findIndex(page => page.id === selected.value?.id)
  const target = list[index + offset]
  if (target) {
    void selectPage(target)
  }
}

function statusMeta(page: KnowledgePage) {
  return pageRecognitionStatusMeta(page.recognitionStatus)
}

function openViewer(): void {
  if (!selected.value) {
    return
  }
  viewerVisible.value = true
}

watch(() => props.versionId, () => void load())
watch(() => props.focusPhysicalPageNumber, (value) => {
  const page = pages.value.find(item => item.physicalPageNumber === value)
  if (page) {
    void selectPage(page)
  }
})
/** 复用页面级唯一定时器：轮询窗口内静默刷新识别状态，不再自起 setInterval。 */
watch(() => props.pollTick, () => {
  if (props.polling) {
    void load(true)
  }
})

onBeforeUnmount(() => {
  loadSequence += 1
  detailSequence += 1
  detailController?.abort()
})

onMounted(() => {
  void load()
  void loadThermalSets()
  void loadDictionaries()
})
</script>

<template>
  <section class="knowledge-review">
    <header class="knowledge-review__header">
      <div>
        <h2>核对识别结果</h2>
        <p>对照原图核对文字和热工信息，确认后才能用于后续处理。</p>
      </div>
      <div v-if="!versionLocked && (canRecognize || canConfirm)" class="knowledge-review__toolbar">
        <t-button v-if="canRecognize" :disabled="!recognitionTargets.length || batchRecognizing || batchConfirming" :loading="batchRecognizing" variant="outline" @click="recognizePending">
          一键识别（{{ recognitionTargets.length }} 页）
        </t-button>
        <t-button
          v-if="canConfirm"
          :disabled="!counts.reviewPending || batchConfirming || batchRecognizing"
          :loading="batchConfirming"
          variant="outline"
          @click="confirmPages()"
        >
          一键确认无风险页
        </t-button>
        <t-button v-if="canConfirm" :disabled="!counts.reviewPending || batchConfirming || batchRecognizing" :loading="batchConfirming" theme="primary" @click="confirmAllPending">
          批量确认待核对页（{{ counts.reviewPending }}）
        </t-button>
      </div>
    </header>
    <t-alert v-if="batchTotal" theme="info" :message="`识别任务已提交 ${batchSubmitted}/${batchTotal} 页；提交失败 ${batchSubmitFailures.length} 页。识别完成后仍需核对。`" />
    <ul v-if="batchSubmitFailures.length" class="knowledge-review__issues">
      <li v-for="item in batchSubmitFailures" :key="item.pageId">文件第 {{ item.physicalPageNumber }} 页：{{ item.reason }}</li>
    </ul>

    <t-alert
      v-if="batchResult"
      class="knowledge-review__batch"
      theme="info"
      title="批量确认完成"
      :close="true"
      @close="batchResult = null"
    >
      <p class="knowledge-review__batch-summary">
        成功：{{ batchResult.confirmed }} 页 ·
        失败：{{ batchResult.failed.length }} 页 ·
        跳过：{{ batchResult.skipped.length }} 页
      </p>
      <t-space>
        <t-button v-if="batchResult.failed.length" size="small" variant="text" @click="focusFailedPages">
          查看失败页面
        </t-button>
        <t-button v-if="batchResult.skipped.length" size="small" variant="text" @click="focusPendingPages">
          只看待处理页面
        </t-button>
      </t-space>
      <ul v-if="batchResult.failed.length || batchResult.skipped.length" class="knowledge-review__issues">
        <li v-for="item in [...batchResult.failed, ...batchResult.skipped]" :key="item.pageId">
          文件第 {{ item.physicalPageNumber }} 页：{{ businessUserMessage(item.reason) }}
        </li>
      </ul>
    </t-alert>

    <div v-if="counts.total" class="knowledge-review__progress">
      <t-progress :label="false" :percentage="progressPercent" :stroke-width="8" theme="line" />
      <div class="knowledge-review__progress-stats">
          <span>已确认 <strong>{{ counts.confirmed }}</strong></span>
          <span v-if="counts.reviewPending">待核对 <strong>{{ counts.reviewPending }}</strong></span>
          <span v-if="counts.processing">识别中 <strong>{{ counts.processing }}</strong></span>
          <span v-if="counts.queued">等待识别 <strong>{{ counts.queued }}</strong></span>
          <span v-if="counts.missingImage">缺少原图 <strong>{{ counts.missingImage }}</strong></span>
          <span v-if="counts.failed" class="is-error">识别失败 <strong>{{ counts.failed }}</strong></span>
      </div>
    </div>

    <t-alert v-if="versionLocked" class="knowledge-review__lock" theme="warning" :message="KNOWLEDGE_VERSION_LOCKED_HINT" />
    <t-alert v-if="loadError" class="knowledge-review__lock" theme="error" :message="businessUserError(loadError)">
      <t-button size="small" variant="text" @click="load()">重新加载</t-button>
    </t-alert>

    <t-loading v-if="loading && !pages.length" loading text="正在加载页面识别状态" />
    <div v-else class="knowledge-review__layout">
      <nav ref="pageListElement" class="knowledge-review__pages">
        <div class="knowledge-review__filter">
          <t-select v-model="statusFilter" size="small" :options="filterOptions" @change="changeFilter" />
        </div>
        <button
          v-for="page in filteredPages"
          :key="page.id"
          v-memo="[page, selected?.id === page.id, failedImageIds.has(page.id)]"
          type="button"
          class="knowledge-review__page-button"
          :aria-current="selected?.id === page.id ? 'page' : undefined"
          :class="{ 'is-selected': selected?.id === page.id }"
          @click="selectPage(page)"
        >
          <img v-if="page.pageImageUrl && !failedImageIds.has(page.id)" :src="page.pageImageUrl" :alt="`文件第 ${page.physicalPageNumber} 页`" loading="lazy" @error="markImageUnavailable(page.id)">
          <span v-else class="knowledge-review__no-image">原图暂不可用</span>
          <span class="knowledge-review__page-meta">
            <strong>文件第 {{ page.physicalPageNumber }} 页</strong>
            <small>资料页码 {{ page.pageLabel || '—' }}</small>
            <small v-if="page.pageTitle">{{ page.pageTitle }}</small>
            <small>{{ statusMeta(page).label }}</small>
          </span>
        </button>
      </nav>

      <div v-if="selected" class="knowledge-review__editor">
        <div class="knowledge-review__image" role="button" tabindex="0" aria-label="查看页面原图" @click="openViewer" @keydown.enter="openViewer" @keydown.space.prevent="openViewer">
          <img
            v-if="(recognition?.pageImageUrl || selected.pageImageUrl) && !failedImageIds.has(selected.id)"
            :src="recognition?.pageImageUrl || selected.pageImageUrl || ''"
            :alt="`文件第 ${selected.physicalPageNumber} 页原图`"
            @error="markImageUnavailable(selected.id)"
          >
          <span v-else>页面图片不可用</span>
        </div>

        <div class="knowledge-review__fields" :aria-busy="detailLoading">
          <t-loading v-if="detailLoading" loading text="正在加载识别结果" />
          <div class="knowledge-review__page-heading">
            <div>
              <strong>文件页序：{{ selected.physicalPageNumber }}</strong>
              <span>资料页码：{{ draft.pageLabel || '—' }}</span>
            </div>
            <div class="knowledge-review__page-actions">
              <t-button size="small" variant="outline" :disabled="filteredPages.findIndex(page => page.id === selected?.id) <= 0" @click="movePage(-1)">
                上一页
              </t-button>
              <t-button size="small" variant="outline" :disabled="filteredPages.findIndex(page => page.id === selected?.id) >= filteredPages.length - 1" @click="movePage(1)">
                下一页
              </t-button>
              <t-button size="small" variant="outline" @click="openViewer">
                查看原图
              </t-button>
            </div>
          </div>

          <RecognitionWarningsSection
            :ambiguous="ambiguous"
            :can-debug="canDebug"
            :confirm-issues="confirmIssues"
            :confirmed="recognition?.recognitionStatus === 'CONFIRMED'"
            :last-recognition-error="selected.recognitionStatus === 'FAILED' ? recognition?.lastRecognitionError : null"
            :last-recognition-error-code="recognition?.lastRecognitionErrorCode"
            :recognition-run-id="recognition?.recognitionRunId"
            :physical-page-number="selected.physicalPageNumber"
            :review-issues="selected.recognitionStatus === 'REVIEW_REQUIRED' ? recognition?.reviewIssues : []"
            :thermal-set-locked="thermalSetLocked"
            :has-sync-options="thermalSets.length > 0"
          />

          <t-alert
            v-if="recognition?.confirmedStructuredData && selected.recognitionStatus !== 'CONFIRMED' && ['PENDING', 'PROCESSING', 'FAILED'].includes(selected.recognitionStatus ?? '')"
            theme="info"
            :message="selected.recognitionStatus === 'FAILED' ? '本次重新识别失败，上次确认的内容仍已保存。请点击“重试识别”。' : '正在重新识别；完成后请核对新结果。'"
          />

          <RecognitionBasicSection
            v-model:page-label="draft.pageLabel"
            v-model:page-title="draft.pageTitle"
            :readonly="!reviewAllowed"
          />

          <RecognitionTextSection v-model:full-text="draft.fullText" :readonly="!reviewAllowed" />

          <RecognitionThermalSection v-model:systems="draft.systems" :readonly="!reviewAllowed" />

          <section v-if="draft.systems.length" class="knowledge-review__section">
            <h3 class="knowledge-review__section-title">
              关联已有构造与产品
            </h3>
            <RecognitionMappingSection
              :mapping-state="mappingState"
              :published-schemes="publishedSchemes"
              :published-specs="publishedSpecs"
              :readonly="!reviewAllowed"
              :systems="draft.systems"
              @change="ambiguous = false"
            />
          </section>

          <section v-if="confirmAllowed" class="knowledge-review__section">
            <h3 class="knowledge-review__section-title">
              同步热工信息
            </h3>
            <t-form v-if="thermalSets.length" label-align="top">
              <t-form-item label="选择要保存热工信息的参考集">
                <t-select v-model="thermalSetId" clearable placeholder="请选择关联的热工参考集" :options="thermalSetOptions" />
              </t-form-item>
              <t-alert v-if="hasThermalOptions && !thermalSetId" theme="info" message="未选择参考集时，本页仍可确认用于资料问答；参考档位不会同步到方案查询。" />
            </t-form>
            <t-alert
              v-else-if="hasThermalOptions"
              theme="warning"
              message="这份资料还没有可编辑的热工参考集。页面仍可确认；如需在热工查询中使用这些信息，请先建立并关联参考集。"
            />
          </section>
          <details v-if="recognitionNotes.length" class="knowledge-review__notes">
            <summary>原图备注（{{ recognitionNotes.length }}）</summary>
            <ul>
              <li v-for="(note, index) in recognitionNotes" :key="index">{{ note }}</li>
            </ul>
          </details>
          <details v-if="recognitionWarnings.length" open class="knowledge-review__notes">
            <summary>需人工核对（{{ recognitionWarnings.length }}）</summary>
            <ul>
              <li v-for="(warning, index) in recognitionWarnings" :key="index">{{ warning }}</li>
            </ul>
          </details>
        </div>
      </div>
      <t-empty v-else :description="pages.length ? '当前筛选条件下没有页面，请切换状态查看' : '还没有页面，请先上传图片或 ZIP'">
        <t-button v-if="!pages.length" variant="outline" @click="emit('openGalleryPage', null)">前往上传页面</t-button>
        <t-button v-else variant="outline" @click="statusFilter = 'ALL'">查看全部页面</t-button>
      </t-empty>
    </div>

    <footer class="knowledge-review__actionbar">
      <span class="knowledge-review__actionbar-hint">
        {{ selected ? `文件第 ${selected.physicalPageNumber} 页 · 资料页码 ${draft.pageLabel || '—'}` : '未选择页面' }}
      </span>
      <t-space>
        <t-button v-if="canReview" :disabled="!reviewAllowed" :loading="saving" variant="outline" @click="saveDraft">
          保存修改
        </t-button>
        <t-button v-if="canRecognize" :disabled="!recognizeAllowed" :loading="recognizing" variant="outline" @click="recognize()">
          {{ recognizeLabel }}
        </t-button>
        <t-button v-if="canConfirm" :disabled="!confirmAllowed" :loading="confirming" theme="primary" @click="confirmPage(false)">
          确认本页
        </t-button>
        <t-button v-if="canConfirm" :disabled="!confirmAllowed" :loading="confirming" theme="primary" variant="outline" @click="confirmPage(true)">
          确认并下一页
        </t-button>
      </t-space>
    </footer>

    <KnowledgeOriginalPageViewer
      v-model:visible="viewerVisible"
      :image-url="recognition?.pageImageUrl || selected?.pageImageUrl"
      :page-id="selected?.id"
      :version-id="versionId"
      :physical-page-number="selected?.physicalPageNumber"
      :page-label="draft.pageLabel"
      title="原图核对"
    />
  </section>
</template>

<style scoped>
.knowledge-review {
  display: flex;
  flex-direction: column;
  height: clamp(600px, calc(100dvh - 220px), 840px);
  min-height: 0;
  overflow: hidden;
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-review__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.knowledge-review h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.knowledge-review p {
  margin: 0;
  color: var(--td-text-color-secondary);
}

.knowledge-review__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-review__progress {
  margin-bottom: 16px;
}

.knowledge-review__progress-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 8px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-review__progress-stats strong {
  color: var(--td-text-color-primary);
}

.knowledge-review__progress-stats .is-error,
.knowledge-review__progress-stats .is-error strong {
  color: var(--td-error-color);
}

.knowledge-review__lock,
.knowledge-review__batch {
  margin-bottom: 16px;
}

.knowledge-review__batch-summary {
  margin: 0 0 8px;
  color: var(--td-text-color-primary);
}

.knowledge-review__issues {
  margin: 0;
  padding-left: 18px;
}

.knowledge-review__layout {
  display: grid;
  flex: 1;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

.knowledge-review__pages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.knowledge-review__filter {
  flex: 0 0 auto;
  width: 100%;
}

.knowledge-review__page-button {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: var(--td-size-2);
  align-items: start;
  color: var(--td-text-color-primary);
  font: inherit;
  flex: 0 0 auto;
  width: 100%;
  height: auto;
  padding: 7px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-container);
  text-align: left;
  white-space: normal;
  cursor: pointer;
}

.knowledge-review__page-button.is-selected {
  border-color: var(--td-brand-color);
}

.knowledge-review__page-button:hover { background: var(--td-bg-color-container-hover); }
.knowledge-review__page-button:focus-visible { outline: 2px solid var(--td-brand-color); outline-offset: -2px; }

.knowledge-review__pages img,
.knowledge-review__no-image {
  width: 58px;
  height: 74px;
  object-fit: contain;
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-review__no-image {
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--td-text-color-placeholder);
}

.knowledge-review__page-meta {
  display: grid;
  align-content: start;
  gap: 3px;
  min-width: 0;
}

.knowledge-review__page-meta small {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-review__editor {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  overflow: hidden;
}

.knowledge-review__image {
  display: grid;
  height: 100%;
  min-height: 0;
  place-items: center;
  overflow: auto;
  background: var(--td-bg-color-secondarycontainer);
  cursor: zoom-in;
}

.knowledge-review__image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.knowledge-review__image:focus-visible { outline: 2px solid var(--td-brand-color); outline-offset: -2px; }

.knowledge-review__fields {
  display: grid;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 16px;
  overflow-y: auto;
  padding-right: var(--td-size-2);
}

.knowledge-review__page-heading {
  display: grid;
  gap: 8px;
}

.knowledge-review__page-heading div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}

.knowledge-review__page-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 8px;
}

.knowledge-review__notes {
  color: var(--td-text-color-secondary);
}

.knowledge-review__notes ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

.knowledge-review__page-heading span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-review__section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.knowledge-review__section-title {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.knowledge-review__actionbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-review__actionbar-hint {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

@media (max-width: 1500px) {
  .knowledge-review__layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .knowledge-review__pages {
    flex-direction: row;
    align-items: flex-start;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .knowledge-review__filter {
    flex: 0 0 210px;
    width: 210px;
  }

  .knowledge-review__pages :deep(.t-button) {
    flex: 0 0 210px;
    width: 210px;
  }
}

@media (max-width: 1050px) {
  .knowledge-review__editor {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(180px, 40%) minmax(0, 1fr);
  }

  .knowledge-review__image {
    height: 100%;
  }
}
</style>
