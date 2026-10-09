import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type {
  KnowledgeDocType,
  KnowledgePageRenderingStatus,
  KnowledgeTextParsingStatus,
  KnowledgeTocSource,
  KnowledgeUserStatus,
  KnowledgeWorkspace,
  KnowledgeWorkspaceLastJob,
} from '@/types/knowledge'
import { businessUserMessage } from '@/utils/business-error'

/** 知识库类型用户文案（不展示 enum）。 */
export const knowledgeDocTypeLabels: Record<KnowledgeDocType, string> = {
  SPECIFICATION: '规范',
  DETAIL_ATLAS: '图集',
  STANDARD: '标准',
  APPLICATION_GUIDE: '应用指南',
  MATERIAL_COMPARISON: '材料对比资料',
  COMPANY_PROFILE: '企业资料',
  THERMAL_FORMULA: '热工资料',
  OTHER: '其他',
}

export interface KnowledgeUserStatusMeta {
  label: string
  status: AppStatus
  usageLabel: string
}

const userStatusMeta: Record<KnowledgeUserStatus, KnowledgeUserStatusMeta> = {
  PENDING_PARSE: { label: '待解析', status: 'default', usageLabel: '暂不可用' },
  PARSING: { label: '解析中', status: 'processing', usageLabel: '暂不可用' },
  READY_TO_VERIFY: { label: '待核对', status: 'warning', usageLabel: '需要核对内容' },
  READY: { label: '内容已准备', status: 'success', usageLabel: '内容已准备' },
  PARSE_FAILED: { label: '解析失败', status: 'error', usageLabel: '需要处理' },
  SEARCHABLE_FILE_REQUIRED: { label: '需要补充可搜索文字', status: 'warning', usageLabel: '需要处理' },
}

export function knowledgeDocTypeLabel(value: string | null | undefined): string {
  if (value && value in knowledgeDocTypeLabels) {
    return knowledgeDocTypeLabels[value as KnowledgeDocType]
  }
  return '其他'
}

export function knowledgeUserStatusMetaFor(value: string | null | undefined): KnowledgeUserStatusMeta {
  if (value && value in userStatusMeta) {
    return userStatusMeta[value as KnowledgeUserStatus]
  }
  return { label: '待解析', status: 'default', usageLabel: '暂不可用' }
}

const parsingStageLabels: Record<string, string> = {
  QUEUED: '排队等待处理',
  PARSING: '正在处理页面内容',
  CHUNKING: '正在整理章节和内容',
  COMPLETED: '解析完成',
  FAILED: '解析失败',
  OCR_REQUIRED: '需要补充可搜索文字',
}

export function knowledgeParsingStageLabel(stage: string | null | undefined): string {
  if (!stage) {
    return '正在识别文档章节和内容'
  }
  return parsingStageLabels[stage] ?? '正在识别文档章节和内容'
}

export function knowledgePageLabel(pageLabel: string | null | undefined, physicalPageNumber?: number | null): string {
  const label = pageLabel?.trim()
  if (label) {
    return label
  }
  return physicalPageNumber != null ? String(physicalPageNumber) : '—'
}

export function flattenChapterTree<T extends { id: string, children?: T[] }>(
  items: readonly T[],
  depth = 0,
): Array<{ node: T, depth: number }> {
  const result: Array<{ node: T, depth: number }> = []
  for (const item of items) {
    result.push({ node: item, depth })
    if (item.children?.length) {
      result.push(...flattenChapterTree(item.children, depth + 1))
    }
  }
  return result
}

export function isKnowledgeParsingStatus(status: string | null | undefined): boolean {
  return status === 'PENDING_PARSE' || status === 'PARSING'
}

export function isKnowledgeReadyStatus(status: string | null | undefined): boolean {
  return status === 'READY_TO_VERIFY' || status === 'READY'
}

/** 页图在识别完成前可返回 NOT_READY，不能据此退回原文件解析流程。 */
export function isKnowledgePageDrivenWorkspace(workspace: KnowledgeWorkspace | null | undefined): boolean {
  if (!workspace) return false
  if (workspace.summary.contentSource === 'PAGE_DRIVEN') return true
  if (workspace.summary.contentSource === 'ORIGINAL_FILE') return false
  return !workspace.primaryFile && !workspace.parsing.lastJob
}

/** PENDING_PARSE 也是离线页图版本的初始状态，只有文件流程才等待文件解析。 */
export function isKnowledgeFileParsingInProgress(workspace: KnowledgeWorkspace | null | undefined): boolean {
  return Boolean(workspace && !isKnowledgePageDrivenWorkspace(workspace)
    && isKnowledgeParsingStatus(workspace.currentVersion?.userStatus))
}

export interface KnowledgeChannelStatusMeta {
  label: string
  status: AppStatus
}

export function knowledgeTextParsingMeta(
  value: KnowledgeTextParsingStatus | string | null | undefined,
): KnowledgeChannelStatusMeta {
  if (value === 'READY') {
    return { label: '成功', status: 'success' }
  }
  if (value === 'FAILED') {
    return { label: '失败', status: 'error' }
  }
  return { label: '处理中', status: 'processing' }
}

export function knowledgePageRenderingMeta(
  value: KnowledgePageRenderingStatus | string | null | undefined,
  complete?: boolean | null,
): KnowledgeChannelStatusMeta {
  if (value === 'READY' && complete !== false) {
    return { label: '成功', status: 'success' }
  }
  if (value === 'READY' && complete === false) {
    return { label: '部分失败', status: 'warning' }
  }
  if (value === 'FAILED') {
    return { label: '失败', status: 'error' }
  }
  if (value === 'SKIPPED') {
    return { label: '已跳过', status: 'default' }
  }
  return { label: '生成中', status: 'processing' }
}

/** 页面视觉仍在生成，可轮询 workspace 刷新 pageCount / 图库。 */
export function isKnowledgePageRenderingInProgress(workspace: KnowledgeWorkspace | null | undefined): boolean {
  if (!workspace || isKnowledgePageDrivenWorkspace(workspace)) {
    return false
  }
  if (isKnowledgeFileParsingInProgress(workspace)) {
    return true
  }
  const rendering = workspace.parsing.pageRendering
  if (rendering === 'FAILED' || rendering === 'SKIPPED') {
    return false
  }
  if (rendering === 'READY' && workspace.parsing.pageRenderingComplete !== false) {
    return false
  }
  // 文本已就绪但页图未完成（含 null：生成尚未回写结果）
  if (isKnowledgeReadyStatus(workspace.currentVersion?.userStatus) && rendering == null) {
    const mime = workspace.primaryFile?.mimeType?.toLowerCase() ?? ''
    const name = workspace.primaryFile?.name?.toLowerCase() ?? ''
    const isDocx = mime.includes('wordprocessingml') || name.endsWith('.docx') || name.endsWith('.doc')
    return isDocx && (workspace.summary.pageCount ?? 0) === 0
  }
  return rendering === 'READY' && workspace.parsing.pageRenderingComplete === false
}

export function knowledgeFailureMessage(job: KnowledgeWorkspaceLastJob | null | undefined): string {
  return businessUserMessage(
    job?.userMessage
    || job?.errorMessage
    || '系统在解析文件时遇到问题。',
  )
}

const knowledgeTocSourceLabels: Record<KnowledgeTocSource, string> = {
  PDF_BOOKMARK: '文件目录',
  TOC_PAGE: '目录页',
  MANUAL: '人工添加',
  COMPANION_FILE: '配套文件',
}

export function knowledgeTocSourceLabel(value: string | null | undefined): string {
  if (value && value in knowledgeTocSourceLabels) {
    return knowledgeTocSourceLabels[value as KnowledgeTocSource]
  }
  return '人工添加'
}

export function knowledgeFileKind(mimeType: string | null | undefined, fileName?: string | null): string {
  const name = (fileName ?? '').toLowerCase()
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    return 'PDF'
  }
  if (mime.includes('word') || name.endsWith('.docx') || name.endsWith('.doc')) {
    return 'Word'
  }
  return '文件'
}
