import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type { ConstructionScheme } from '@/types/construction'
import type {
  KnowledgePageRecognition,
  PageRecognitionMappingIssue,
  PageRecognitionProductSpecCandidate,
  PageRecognitionResult,
  PageRecognitionSchemeCandidate,
  PageRecognitionStatus,
} from '@/types/knowledge'
import type { ProductSpec } from '@/types/masterdata'
import { BusinessError } from '@/types/error'

export interface RecognitionStatusMeta {
  label: string
  status: AppStatus
}

/**
 * 页面识别状态文案：null（未识别）/ PENDING（排队中）/ PROCESSING（识别中）/
 * REVIEW_REQUIRED（待确认）/ CONFIRMED（已确认）/ FAILED（识别失败）必须区分展示。
 */
export const PAGE_RECOGNITION_STATUS_META: Record<PageRecognitionStatus, RecognitionStatusMeta> = {
  PENDING: { label: '排队中', status: 'default' },
  PROCESSING: { label: '识别中', status: 'processing' },
  REVIEW_REQUIRED: { label: '待核对', status: 'warning' },
  CONFIRMED: { label: '已确认', status: 'success' },
  FAILED: { label: '识别失败', status: 'error' },
}

export const PAGE_RECOGNITION_UNRECOGNIZED_META: RecognitionStatusMeta = { label: '未识别', status: 'disabled' }

export function pageRecognitionStatusMeta(status: PageRecognitionStatus | null | undefined): RecognitionStatusMeta {
  if (status && status in PAGE_RECOGNITION_STATUS_META) {
    return PAGE_RECOGNITION_STATUS_META[status]
  }
  return PAGE_RECOGNITION_UNRECOGNIZED_META
}

/** 重新识别排队期间后端保留旧确认快照；它不能作为本轮待校验内容展示。 */
export function currentRecognitionCandidate(
  detail: Pick<KnowledgePageRecognition, 'structuredData' | 'draftStructuredData' | 'confirmedStructuredData'>,
  status: PageRecognitionStatus | null,
): PageRecognitionResult | null {
  if (status === 'PENDING' || status === 'PROCESSING' || status == null) {
    return null
  }
  if (status === 'FAILED' && detail.confirmedStructuredData) {
    return null
  }
  return detail.structuredData ?? detail.draftStructuredData ?? (status === 'CONFIRMED' ? detail.confirmedStructuredData : null)
}

/** 可编辑版本 = DRAFT；非 DRAFT 一律只读。 */
export const RECOGNITION_VERSION_LOCKED_HINT = '当前知识版本已发布，如需修改，请创建新版本。'

/** 识别未就绪（非 REVIEW_REQUIRED）时的业务提示。 */
export const RECOGNITION_NOT_READY_HINT = '页面仍在识别中，请等待识别完成后再确认。'

/** 未匹配到正式构造/产品规格时的业务提示。 */
export const RECOGNITION_NOT_FOUND_HINT
  = '当前识别数据未匹配到正式构造方案或产品规格，请先补充正式业务数据，或调整本页映射后再确认。'

/** 检测到多个可匹配项时的业务提示。 */
export const RECOGNITION_AMBIGUOUS_HINT = '检测到多个可匹配的正式构造方案或产品规格，请选择后再确认。'

export interface RecognitionMappingCandidateState {
  /** AMBIGUOUS 时后端返回的构造方案候选。 */
  schemeCandidates: PageRecognitionSchemeCandidate[]
  /** AMBIGUOUS 时后端返回的产品规格候选。 */
  productSpecCandidates: PageRecognitionProductSpecCandidate[]
  /** 命中的构造编号（用于定位 system）。 */
  constructionCode: string | null
  /** 命中的方案 id（用于定位 system）。 */
  schemeId: string | null
  /** 命中的厚度（用于定位 option）。 */
  thicknessMm: number | null
  /** 命中的规格类型。 */
  specClass: 'I' | 'II' | 'III' | null
}

export const EMPTY_RECOGNITION_MAPPING_STATE: RecognitionMappingCandidateState = {
  schemeCandidates: [],
  productSpecCandidates: [],
  constructionCode: null,
  schemeId: null,
  thicknessMm: null,
  specClass: null,
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asSpecClass(value: unknown): 'I' | 'II' | 'III' | null {
  return value === 'I' || value === 'II' || value === 'III' ? value : null
}

function mapSchemeCandidate(raw: unknown): PageRecognitionSchemeCandidate | null {
  const item = asRecord(raw)
  const id = asString(item.id)
  if (!id) {
    return null
  }
  return {
    id,
    name: asString(item.name) ?? id,
    schemeCode: asString(item.schemeCode),
    systemId: asString(item.systemId),
    version: asNumber(item.version),
  }
}

function mapProductSpecCandidate(raw: unknown): PageRecognitionProductSpecCandidate | null {
  const item = asRecord(raw)
  const id = asString(item.id)
  if (!id) {
    return null
  }
  return {
    id,
    catalogProductId: asString(item.catalogProductId),
    specCode: asString(item.specCode),
    specClass: asSpecClass(item.specClass),
    thicknessMm: asNumber(item.thicknessMm),
    version: asNumber(item.version),
  }
}

/**
 * 从 confirm / draft 接口失败响应中解析映射候选。
 * Backend 统一以 HTTP 200 + success:false 返回，业务错误码不进入 error.code，
 * 因此 AMBIGUOUS 需通过 details.mappingStatus 或候选数组识别。
 */
export function readRecognitionMappingState(error: unknown): RecognitionMappingCandidateState | null {
  if (!(error instanceof BusinessError)) {
    return null
  }
  const details = asRecord(error.details)
  const schemeCandidates = Array.isArray(details.schemeCandidates)
    ? details.schemeCandidates.map(mapSchemeCandidate).filter((item): item is PageRecognitionSchemeCandidate => item !== null)
    : []
  const productSpecCandidates = Array.isArray(details.productSpecCandidates)
    ? details.productSpecCandidates.map(mapProductSpecCandidate).filter((item): item is PageRecognitionProductSpecCandidate => item !== null)
    : []
  const mappingStatus = asString(details.mappingStatus)
  if (schemeCandidates.length === 0 && productSpecCandidates.length === 0 && mappingStatus !== 'AMBIGUOUS' && mappingStatus !== 'NOT_FOUND') {
    return null
  }
  return {
    schemeCandidates,
    productSpecCandidates,
    constructionCode: asString(details.constructionCode),
    schemeId: asString(details.schemeId),
    thicknessMm: asNumber(details.thicknessMm),
    specClass: asSpecClass(details.specClass),
  }
}

/** 是否为「未匹配到正式业务数据」的映射问题。 */
export function isNotFoundMappingDetails(error: unknown): boolean {
  if (!(error instanceof BusinessError)) {
    return false
  }
  const details = asRecord(error.details)
  return asString(details.mappingStatus) === 'NOT_FOUND'
}

/** 将确认返回的 mappingIssues 转为业务可读描述。 */
export function describeMappingIssue(issue: PageRecognitionMappingIssue): string {
  if (issue.kind === 'SCHEME') {
    return issue.constructionCode
      ? `构造 ${issue.constructionCode} 未匹配到已发布的正式构造方案`
      : '存在缺少构造编号的构造块，未匹配到正式构造方案'
  }
  const scope = [issue.constructionCode, issue.thicknessMm != null ? `${issue.thicknessMm}mm` : null]
    .filter(Boolean)
    .join(' · ')
  return scope
    ? `${scope} 未匹配到属于该构造方案的已发布产品规格`
    : '存在未匹配到正式产品规格的参考方案'
}

export function formatSchemeCandidateLabel(candidate: PageRecognitionSchemeCandidate): string {
  return [candidate.name, candidate.schemeCode, candidate.version != null ? `v${candidate.version}` : null]
    .filter(Boolean)
    .join(' · ')
}

export function formatProductSpecCandidateLabel(candidate: PageRecognitionProductSpecCandidate): string {
  return [
    candidate.specCode,
    candidate.specClass ? `${candidate.specClass}型` : null,
    candidate.thicknessMm != null ? `${candidate.thicknessMm}mm` : null,
    candidate.version != null ? `v${candidate.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ') || candidate.id
}

export interface RecognitionSelectOption {
  label: string
  value: string
}

/**
 * 正式构造方案候选：合并后端 AMBIGUOUS 候选与已发布构造方案字典，
 * 按构造编号收窄；接口失败时（publishedSchemes 为空）仍保留候选可用。
 */
export function buildSchemeOptions(
  system: { constructionCode?: string | null },
  mappingState: RecognitionMappingCandidateState,
  publishedSchemes: readonly ConstructionScheme[],
): RecognitionSelectOption[] {
  const map = new Map<string, RecognitionSelectOption>()
  const code = system.constructionCode?.trim()
  const candidates = mappingState.schemeCandidates.filter(item => !code || !item.schemeCode || item.schemeCode === code)
  candidates.forEach(item => map.set(item.id, { label: formatSchemeCandidateLabel(item), value: item.id }))
  publishedSchemes
    .filter(item => !code || item.schemeCode === code)
    .forEach((item) => {
      if (!map.has(item.id)) {
        map.set(item.id, { label: `${item.name} · ${item.schemeCode}`, value: item.id })
      }
    })
  return [...map.values()]
}

/** 正式产品规格候选：按厚度与规格类型收窄，同样优先展示后端候选。 */
export function buildSpecOptions(
  system: { specClass?: 'I' | 'II' | 'III' | null },
  option: { thicknessMm?: number | null },
  mappingState: RecognitionMappingCandidateState,
  publishedSpecs: readonly ProductSpec[],
): RecognitionSelectOption[] {
  const map = new Map<string, RecognitionSelectOption>()
  const thickness = option.thicknessMm
  const candidates = mappingState.productSpecCandidates
    .filter(item => thickness == null || item.thicknessMm == null || item.thicknessMm === thickness)
  candidates.forEach(item => map.set(item.id, { label: formatProductSpecCandidateLabel(item), value: item.id }))
  publishedSpecs
    .filter(item => (thickness == null || item.thicknessMm === thickness) && (!system.specClass || item.specClass === system.specClass))
    .forEach((item) => {
      if (!map.has(item.id)) {
        map.set(item.id, { label: `${item.specCode} · ${item.specClass}型 · ${item.thicknessMm}mm`, value: item.id })
      }
    })
  return [...map.values()]
}
