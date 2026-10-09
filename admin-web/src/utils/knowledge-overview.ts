import type { KnowledgePageRecognitionSummary, KnowledgeVersionIndex } from '@/types/knowledge'
import { isKnowledgeIndexReady } from '@/utils/knowledge-lifecycle'

export type OverviewReason = 'published' | 'upload' | 'failed' | 'processing' | 'review' | 'missing' | 'parse' | 'index' | 'publish' | 'other'
export interface OverviewNextStep {
  text: string
  action: string
  tab: string
  reason: OverviewReason
}

export interface OverviewNextStepInput {
  published: boolean
  canAskAi: boolean
  canPublish: boolean
  pageCount: number
  isPageDriven: boolean
  recognitionSummary: KnowledgePageRecognitionSummary | null
  parseStatus?: string | null
  index: KnowledgeVersionIndex | null
  canTest: boolean
  canUploadPages: boolean
  canHandleRecognition: boolean
  canRebuildIndex: boolean
  canOpenPublish: boolean
}

/** 概览只给出当前最有用的一步，不把内容准备和问答可用性混为一谈。 */
export function getOverviewNextStep(input: OverviewNextStepInput): OverviewNextStep {
  const rec = input.recognitionSummary
  if (input.published && input.canAskAi) {
    return { text: input.canTest ? '资料已发布，可测试问答结果并核对引用页面。' : '资料已发布，可以用于问答。', action: input.canTest ? '测试问答' : '', tab: 'test', reason: 'published' }
  }
  if (input.published) {
    return { text: '资料已发布，但尚不能用于问答。请查看下方的发布与问答条件。', action: '', tab: '', reason: 'other' }
  }
  if (input.pageCount === 0 && input.isPageDriven) {
    return input.canUploadPages
      ? { text: '请上传完整页面图片或 ZIP 文件；上传后系统会开始识别。', action: '上传页面', tab: 'gallery', reason: 'upload' }
      : { text: '还没有资料页面。请联系有上传权限的管理员添加页面。', action: '', tab: '', reason: 'upload' }
  }
  if (input.isPageDriven && (rec?.failed ?? 0) > 0) {
    return input.canHandleRecognition
      ? { text: '有页面识别失败，请重试后核对结果。', action: '处理失败页面', tab: 'recognition', reason: 'failed' }
      : { text: '有页面识别失败，请联系有权限的管理员重试。', action: '查看失败页面', tab: 'recognition', reason: 'failed' }
  }
  if (input.isPageDriven && ((rec?.pending ?? 0) > 0 || (rec?.processing ?? 0) > 0)) {
    return { text: '系统正在识别页面；可稍后查看处理结果。', action: '查看识别进度', tab: 'recognition', reason: 'processing' }
  }
  if (input.isPageDriven && (rec?.reviewRequired ?? 0) > 0) {
    return input.canHandleRecognition
      ? { text: '识别结果需要人工核对；确认后才能进入发布流程。', action: '核对页面', tab: 'recognition', reason: 'review' }
      : { text: '识别结果等待人工核对，请联系有权限的管理员确认。', action: '查看页面', tab: 'recognition', reason: 'review' }
  }
  if (input.isPageDriven && (rec?.missingImage ?? 0) > 0) {
    return { text: input.canUploadPages ? '部分页面缺少原图，请到资料页面补充图片。' : '部分页面缺少原图，请联系有上传权限的管理员补充图片。', action: '查看页面', tab: 'gallery', reason: 'missing' }
  }
  if (!input.isPageDriven && input.parseStatus !== 'PARSED' && input.parseStatus !== 'PARTIAL') {
    return { text: '等待文件解析完成，再查看资料内容。', action: '查看资料', tab: 'content', reason: 'parse' }
  }
  if (!isKnowledgeIndexReady(input.index)) {
    return { text: input.canRebuildIndex
      ? (input.index?.indexStatus === 'INDEX_FAILED' ? '问答内容更新失败，请重试后再发布。' : '问答内容尚未准备好，或资料有新修改。请更新后再发布。')
      : '问答内容尚未准备好，请联系有权限的管理员更新。', action: input.canRebuildIndex ? '更新问答内容' : '', tab: 'index', reason: 'index' }
  }
  if (input.canPublish) {
    return { text: input.canOpenPublish ? '发布条件已满足，请确认发布。' : '发布条件已满足，请联系有发布权限的管理员完成发布。', action: input.canOpenPublish ? '打开发布设置' : '', tab: 'publish', reason: 'publish' }
  }
  return { text: '还有发布条件未满足，请查看下方的处理进度。', action: '', tab: '', reason: 'other' }
}

export interface OverviewFact { key: string, label: string, value: string, tone: 'default' | 'warning' }

/** 0 不单独占一个指标位；页面总数也只出现一次。 */
export function buildOverviewFacts(pageCount: number, rec: KnowledgePageRecognitionSummary | null, isPageDriven: boolean): OverviewFact[] {
  if (pageCount === 0) {
    return []
  }
  const facts: OverviewFact[] = [{ key: 'pages', label: '资料页数', value: `${pageCount} 页`, tone: 'default' }]
  if (isPageDriven && rec) {
    if (rec.reviewRequired > 0) {
      facts.push({ key: 'review', label: '待核对', value: `${rec.reviewRequired} 页`, tone: 'warning' })
    }
    if (rec.confirmed > 0) {
      facts.push({ key: 'confirmed', label: '已确认', value: `${rec.confirmed} 页`, tone: 'default' })
    }
  }
  return facts
}

const reasonPatterns: Partial<Record<OverviewReason, RegExp>> = {
  upload: /没有资料页面|上传.*页面|补充.*页面/,
  failed: /识别失败/,
  processing: /正在识别|尚未识别|识别中/,
  review: /待核对|尚未核对|没有完成识别确认|识别未确认/,
  missing: /缺少.*(?:原图|图片)|补充.*(?:原图|图片)/,
  parse: /解析.*(?:完成|失败)|文件读不出文字/,
  index: /问答内容.*(?:更新|准备)|索引/,
}

/** 下一步已经解释过的阻断原因不在展开区原样再列一次。 */
export function remainingOverviewBlockers(blockers: string[], reason: OverviewReason): string[] {
  const pattern = reasonPatterns[reason]
  return [...new Set(blockers.map(item => item.trim()).filter(Boolean))].filter(item => !pattern?.test(item))
}
