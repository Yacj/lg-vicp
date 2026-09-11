import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type {
  KnowledgeDocType,
  KnowledgeTocSource,
  KnowledgeUserStatus,
  KnowledgeWorkspaceLastJob,
} from '@/types/knowledge'

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
  READY_TO_VERIFY: { label: '待验证', status: 'warning', usageLabel: '待确认' },
  READY: { label: '可使用', status: 'success', usageLabel: '可以使用' },
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

export function knowledgeFailureMessage(job: KnowledgeWorkspaceLastJob | null | undefined): string {
  return knowledgeUserMessage(
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

const knowledgeMessageReplacements: Array<[RegExp, string]> = [
  [/缺少 ORIGINAL 正式原文件，不能发布 AI 可引用版本/g, '还没有知识文件，不能发布给提问使用。'],
  [/原文件没有文本层且未绑定可检索的文本源：请上传 SEARCH_SOURCE 资产后升级解析，或将版本用途改为 BROWSE_ONLY（仅浏览）/g, '当前文件读不出文字。请补充可搜索文字版本，或改为只查看原文件。'],
  [/原文件没有文本层且不存在 SEARCH_SOURCE 文本源，不能进入 AI 检索/g, '当前文件读不出文字，请先补充可搜索文字版本。'],
  [/检索文本未映射到任何 ORIGINAL 页面，不能生成可回溯的 AI 引用/g, '可搜索文字版本还没有和原文件页面对上，暂时不能发布给提问使用。'],
  [/原文目录尚不可用：请从 PDF 书签、目录页、配套检索源或人工维护生成 TOC/g, '还没有识别到章节目录，可以重新解析或在更多设置中补充章节。'],
  [/原文目录尚未人工确认（CONFIRMED），AI 引用的目录路径以当前草稿为准/g, '章节目录还没有确认，提问引用会按当前识别结果。'],
  [/有 (\d+) 页仅使用物理页码回退（FALLBACK），未识别到可靠印刷页码/g, '有 $1 页没有识别到印刷页码，会用文件页码代替。'],
  [/检索页到原文页的映射尚未人工核验（verified），引用回溯可能偏页/g, '文字版本和原文件的页面对应关系还没有核对，引用页码可能不准。'],
  [/有 (\d+) 条低置信映射不能用于正式 AI 引用/g, '有 $1 处页面对应关系不够确定，可能影响引用是否准确。'],
  [/SEARCH_SOURCE 资产绑定完成，已自动发起升级解析（重建检索内容与页面映射）/g, '已补充可搜索文字版本，正在重新解析。'],
  [/SEARCH_SOURCE 资产绑定完成；如为检索文本源，请触发“升级解析”重建内容与页面映射/g, '已补充可搜索文字版本。如果没有自动开始，请点击重新解析。'],
  [/仅审核通过的版本可以发布/g, '请先审核通过，再发布给提问使用。'],
  [/版本尚未完成解析，不能发布/g, '请等解析完成后再发布。'],
  [/版本尚未完成解析，不能审核/g, '请等解析完成后再审核。'],
  [/已发布或已停用的版本不允许重新解析，请创建新版本/g, '已发布的知识库不能直接重新解析，请更换文件后再解析。'],
  [/仅已发布版本可以停用/g, '只有已发布的知识库可以停用。'],
  [/已发布版本无需重复审核/g, '这份知识库已经审核过了。'],
  [/知识库还在解析中，完成后即可测试。/g, '知识库还在解析中，完成后就可以测试。'],
  [/当前文件无法读取文字，请先补充可搜索文字版本。/g, '当前文件读不出文字，请先补充可搜索文字版本。'],
  [/当前 PDF 无法直接读取文字，请补充可搜索文字版本，或仅作为原文浏览。/g, '当前文件读不出文字。请补充可搜索文字版本，或改为只查看原文件。'],
  [/正式原文件/g, '知识文件'],
  [/检索文件/g, '可搜索文字版本'],
  [/无文本层/g, '读不出文字'],
  [/检索源/g, '可搜索文字版本'],
  [/物理页/g, '文件页'],
  [/页面映射/g, '页面对应'],
  [/\bORIGINAL\b/g, '知识文件'],
  [/\bSEARCH_SOURCE\b/g, '可搜索文字版本'],
  [/\bBROWSE_ONLY\b/g, '只查看原文件'],
  [/\bAI_ENABLED\b/g, '可用于提问'],
  [/\bCONFIRMED\b/g, '已确认'],
  [/\bFALLBACK\b/g, '文件页'],
  [/\bTOC\b/g, '目录'],
  [/\bOCR\b/g, '文字识别'],
  [/\bChunk\b/gi, '内容'],
  [/\bBlock\b/gi, '内容'],
]

/** 把后端技术说明转成普通用户能看懂的句子。 */
export function knowledgeUserMessage(message: string | null | undefined): string {
  const text = (message ?? '').trim()
  if (!text) {
    return '处理时遇到问题，请稍后重试。'
  }
  let next = text
  for (const [pattern, replacement] of knowledgeMessageReplacements) {
    next = next.replace(pattern, replacement)
  }
  if (/error|exception|stack|worker boom|traceback/i.test(next) && /[A-Za-z]/.test(next)) {
    return '系统在解析文件时遇到问题，请稍后重试。'
  }
  return next.replace(/\s{2,}/g, ' ').trim()
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
