import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type {
  KnowledgeIndexStatus,
  KnowledgePageRecognitionSummary,
  KnowledgeVersionIndex,
  KnowledgeWorkspace,
} from '@/types/knowledge'

export interface KnowledgeStatusMeta {
  label: string
  status: AppStatus
  hint: string
}

const INDEX_STATUS_META: Record<KnowledgeIndexStatus, { label: string, status: AppStatus }> = {
  INDEX_PENDING: { label: '待更新', status: 'warning' },
  INDEXING: { label: '更新中', status: 'processing' },
  INDEX_READY: { label: '已准备好', status: 'success' },
  INDEX_FAILED: { label: '更新失败', status: 'error' },
}

/**
 * 知识索引状态文案（用户视角）。
 * 索引已就绪但内容已变更（indexDirty / revision 不一致）时统一显示「需要更新」，
 * 与发布门禁（要求 INDEX_READY && !indexDirty && indexRevision === contentRevision）保持同一口径。
 */
export function knowledgeIndexMeta(index: KnowledgeVersionIndex | null | undefined): KnowledgeStatusMeta {
  if (!index) {
    return { label: '读取中', status: 'processing', hint: '' }
  }
  const base = INDEX_STATUS_META[index.indexStatus]
  if (index.indexStatus === 'INDEX_READY' && isKnowledgeIndexStale(index)) {
    return { label: '需要更新', status: 'warning', hint: '资料内容已变化，请更新问答内容。' }
  }
  if (index.indexStatus === 'INDEX_PENDING' && index.indexBuiltAt) {
    return { label: base.label, status: base.status, hint: '资料内容已变化，请更新问答内容。' }
  }
  if (index.indexStatus === 'INDEX_FAILED') {
    return { label: base.label, status: base.status, hint: '问答内容更新失败，请重试。' }
  }
  return { label: base.label, status: base.status, hint: '' }
}

/** 索引内容已落后于页面内容。 */
export function isKnowledgeIndexStale(index: KnowledgeVersionIndex | null | undefined): boolean {
  if (!index) {
    return false
  }
  return index.indexDirty || index.indexRevision !== index.contentRevision
}

/** 索引是否满足发布门禁（INDEX_READY 且未过期）。 */
export function isKnowledgeIndexReady(index: KnowledgeVersionIndex | null | undefined): boolean {
  return Boolean(index && index.indexStatus === 'INDEX_READY' && !isKnowledgeIndexStale(index))
}

export interface KnowledgeRecognitionChip {
  key: 'confirmed' | 'reviewRequired' | 'processing' | 'pending' | 'failed' | 'missingImage'
  label: string
  value: number
  status: AppStatus
}

/**
 * 识别进度分项：全部取自后端 pageRecognitionSummary，前端不按页面列表自行统计。
 * 无页面（total === 0）时返回空数组，由调用方展示空状态。
 */
export function buildRecognitionChips(
  summary: KnowledgePageRecognitionSummary | null | undefined,
): KnowledgeRecognitionChip[] {
  if (!summary || summary.total === 0) {
    return []
  }
  return [
    { key: 'confirmed', label: '已确认', value: summary.confirmed, status: 'success' },
    { key: 'reviewRequired', label: '待核对', value: summary.reviewRequired, status: 'warning' },
    { key: 'processing', label: '识别中', value: summary.processing, status: 'processing' },
    { key: 'pending', label: '待识别', value: summary.pending, status: 'default' },
    { key: 'failed', label: '识别失败', value: summary.failed, status: 'error' },
    { key: 'missingImage', label: '缺页面图', value: summary.missingImage, status: 'disabled' },
  ]
}

/** 已出识别结果的页面数（已确认 + 待校验 + 失败）；不含排队 / 识别中 / 缺页面图。 */
export function recognitionResolvedCount(
  summary: KnowledgePageRecognitionSummary | null | undefined,
): number {
  if (!summary) {
    return 0
  }
  return summary.confirmed + summary.reviewRequired + summary.failed
}

/** 全部页面均已出识别结果（无排队 / 识别中 / 缺页面图）。 */
export function isRecognitionSettled(
  summary: KnowledgePageRecognitionSummary | null | undefined,
): boolean {
  if (!summary || summary.total === 0) {
    return false
  }
  return summary.pending === 0 && summary.processing === 0 && summary.missingImage === 0
}

/** 全部页面均已人工确认。 */
export function isRecognitionConfirmed(
  summary: KnowledgePageRecognitionSummary | null | undefined,
): boolean {
  return Boolean(summary && summary.total > 0 && summary.confirmed === summary.total)
}

export type KnowledgeFlowState = 'done' | 'active' | 'todo' | 'error'

export interface KnowledgeFlowStep {
  label: string
  detail: string
  state: KnowledgeFlowState
}

export interface KnowledgeFlowInput {
  workspace: KnowledgeWorkspace | null
  index: KnowledgeVersionIndex | null
  recognitionSummary: KnowledgePageRecognitionSummary | null
}

/**
 * 资料生命周期五步：上传资料 → AI 识别 → 内容校验 → 知识索引 → 发布。
 *
 * 语义修正（旧实现把「识别完成」等同于「全部已确认」）：
 * - AI 识别完成 = 全部页面均已出结果（无排队 / 识别中 / 缺页面图）；
 * - 内容校验完成 = 全部页面均已人工确认。
 */
export function buildKnowledgeFlowSteps(input: KnowledgeFlowInput): KnowledgeFlowStep[] {
  const { workspace, index, recognitionSummary: rec } = input
  const pageCount = workspace?.summary.pageCount ?? 0
  const published = workspace?.currentVersion?.status === 'PUBLISHED'
  const uploaded = pageCount > 0
  const indexReady = isKnowledgeIndexReady(index)
  const canPublish = Boolean(workspace?.summary.canPublish)

  if (workspace?.summary.contentSource === 'ORIGINAL_FILE') {
    const parseStatus = workspace.currentVersion?.parseStatus
    const parsed = parseStatus === 'PARSED' || parseStatus === 'PARTIAL'
    const failed = parseStatus === 'FAILED'
    return [
      { label: '上传文件', detail: workspace.primaryFile?.name ?? '待上传', state: workspace.primaryFile ? 'done' : 'active' },
      { label: '解析内容', detail: failed ? '解析失败' : parsed ? '已完成' : '进行中', state: failed ? 'error' : parsed ? 'done' : 'active' },
      { label: '查看资料', detail: pageCount > 0 ? `${pageCount} 页` : '查看提取内容', state: parsed ? 'done' : 'todo' },
      { label: '准备问答内容', detail: indexReady ? '已准备好' : knowledgeIndexMeta(index).label, state: index?.indexStatus === 'INDEX_FAILED' ? 'error' : indexReady ? 'done' : parsed ? 'active' : 'todo' },
      { label: '发布', detail: published ? '已发布' : canPublish ? '可发布' : '未完成', state: published ? 'done' : canPublish ? 'active' : 'todo' },
    ]
  }

  const settled = isRecognitionSettled(rec)
  const confirmed = isRecognitionConfirmed(rec)
  const recFailed = Boolean(rec && rec.failed > 0)

  return [
    {
      label: '上传资料',
      detail: uploaded ? `${pageCount} 页` : '待上传',
      state: uploaded ? 'done' : 'active',
    },
    {
      label: 'AI 识别',
      detail: rec ? `已出结果 ${recognitionResolvedCount(rec)} / ${rec.total}` : '—',
      state: recFailed ? 'error' : !uploaded ? 'todo' : settled ? 'done' : 'active',
    },
    {
      label: '核对内容',
      detail: rec ? `已确认 ${rec.confirmed} / ${rec.total}` : '—',
      state: !uploaded ? 'todo' : confirmed ? 'done' : (rec?.reviewRequired ?? 0) > 0 ? 'active' : recFailed ? 'todo' : 'active',
    },
    {
      label: '准备问答内容',
      detail: indexReady ? '已准备好' : knowledgeIndexMeta(index).label,
      state: index?.indexStatus === 'INDEX_FAILED' ? 'error' : indexReady ? 'done' : uploaded ? 'active' : 'todo',
    },
    {
      label: '发布',
      detail: published ? '已发布' : canPublish ? '可发布' : '未完成',
      state: published ? 'done' : canPublish ? 'active' : 'todo',
    },
  ]
}
