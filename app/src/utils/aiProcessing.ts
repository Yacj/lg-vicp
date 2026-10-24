import type { AiSourceRef } from '@/api/types'
import { isUserFacingStatusText } from './aiAgentUi'

export interface ProcessingStep {
  key: string
  message: string
  status: 'active' | 'done' | 'error' | 'stopped'
  sources?: Array<{ title: string, pageLabel?: string }>
}

export interface ProcessingClock {
  processingStartedAt?: number
  processingFinishedAt?: number
}

/** 从本次请求开始计时，在首段正式回答或终止时冻结；不把整段输出耗时当作思考时长。 */
export function finishProcessingClock(clock: ProcessingClock, now = Date.now()) {
  if (Number.isFinite(clock.processingStartedAt) && clock.processingFinishedAt == null)
    clock.processingFinishedAt = Math.max(clock.processingStartedAt!, now)
}

export function processingSeconds(clock: ProcessingClock, now = Date.now()) {
  if (!Number.isFinite(clock.processingStartedAt))
    return null
  const end = clock.processingFinishedAt ?? now
  return Math.ceil(Math.max(0, end - clock.processingStartedAt!) / 1000)
}

export function processingTitle(active: boolean, seconds: number | null, status?: string) {
  const duration = seconds == null ? '' : `（${seconds}秒）`
  if (active)
    return `思考中${duration}`
  if (status === 'STOPPED')
    return `思考已停止${duration}`
  if (status === 'FAILED')
    return `思考未完成${duration}`
  return `已思考${duration}`
}

/** 将实际阶段合并为简短说明，资料只提书名；数值和结论仍在正式回答中展示。 */
export function processingNarrative(steps: ProcessingStep[], active: boolean) {
  const descriptions: Record<string, string> = {
    'images': '查看上传图片中的信息',
    'products': '查阅现有产品资料',
    'parameters': '核对所问参数及其来源',
    'knowledge': '检索知识库中的相关内容',
    'references': '查询相关参考做法并核对条件',
    'comparison': '查阅现有的对比依据',
    'calculation': '核对本次计算的条件',
    'tool:search_knowledge': '检索知识库中的相关内容',
    'tool:get_product_data': '查阅现有产品资料',
    'tool:thermal_calculate': '核对本次计算的条件',
    'tool:compare_products': '查阅现有的对比依据',
    'tool:compare_solutions': '核对参考做法之间的差异',
  }
  const done = [...new Set(steps.filter(step => step.status === 'done').map(step => descriptions[step.key]).filter(Boolean))]
  const running = [...new Set(steps.filter(step => step.status === 'active').map(step => descriptions[step.key]).filter(Boolean))]
  const understood = steps.some(step => step.key === 'understanding' && step.status === 'done')
  const interrupted = steps.some(step => step.status === 'error' || step.status === 'stopped')
  const paragraphs: string[] = []
  if (done.length)
    paragraphs.push(`${understood ? '我先梳理了这次提问的重点，再' : '已'}${done.join('、')}。`)
  else if (understood)
    paragraphs.push(`我已梳理这次提问的重点。${active ? '正在整理可用的信息。' : interrupted ? '' : '整理后的内容见下方。'}`)
  else if (active)
    paragraphs.push('我正在梳理你的问题，确认这次需要查找和核对的信息。')
  if (active && running.length)
    paragraphs.push(`目前正在${running.join('、')}。`)
  const titles = [...new Set(steps.flatMap(step => step.sources || []).map(source => source.title))]
  if (titles.length) {
    paragraphs.push(`本次查阅了${titles.slice(0, 3).map(title => `《${title}》`).join('、')}${titles.length > 3 ? '等资料' : '中的相关记录'}。${active ? '正在结合这些信息整理回答。' : interrupted ? '' : '整理后的内容见下方。'}`)
  }
  else if (!active && !interrupted && !paragraphs.length) {
    paragraphs.push('已完成这次问题的整理，回答见下方。')
  }
  if (interrupted)
    paragraphs.push(steps.some(step => step.status === 'stopped') ? '这次处理已停止。' : '本次处理有未完成的部分。')
  return paragraphs
}

export function mergeProcessingSources(previous: ProcessingStep['sources'], sources: readonly Partial<AiSourceRef>[]) {
  const items = new Map<string, { title: string, pageLabel?: string }>()
  for (const source of [...(previous || []), ...sources]) {
    const title = typeof source.title === 'string' ? source.title.trim().slice(0, 180) : ''
    if (!title)
      continue
    const pageLabel = typeof source.pageLabel === 'string' ? source.pageLabel.trim().slice(0, 40) : ''
    items.set(`${title}\u0000${pageLabel}`, { title, ...(pageLabel ? { pageLabel } : {}) })
  }
  return [...items.values()].slice(0, 12)
}

/** 后端真实阶段与来源的展示投影，不解析用户原话、不生成查询或工程结论。 */
export function updateProcessingStep(steps: ProcessingStep[], input: {
  key: string
  message: string
  status?: ProcessingStep['status']
  sources?: Array<{ title: string, pageLabel?: string }>
}) {
  if (!isUserFacingStatusText(input.message))
    return steps
  const existing = steps.find(item => item.key === input.key)
  const next: ProcessingStep = {
    key: input.key,
    message: input.message.slice(0, 220),
    status: input.status || 'active',
    ...(existing?.sources?.length || input.sources?.length
      ? { sources: mergeProcessingSources(existing?.sources, input.sources || []) }
      : {}),
  }
  return existing
    ? steps.map(item => item.key === next.key ? next : item)
    : [...steps.slice(-29), next]
}

export function finishProcessing(steps: ProcessingStep[], status: 'done' | 'error' | 'stopped') {
  return steps.map(item => item.status === 'active'
    ? {
        ...item,
        status,
        message: status === 'done' ? '本步处理完成' : status === 'stopped' ? '本步已停止' : '本步未完成',
      }
    : item)
}

export function processingSourceLabels(sources: ProcessingStep['sources']) {
  const books = new Map<string, string[]>()
  for (const source of sources || []) {
    const pages = books.get(source.title) || []
    if (source.pageLabel && !pages.includes(source.pageLabel))
      pages.push(source.pageLabel)
    books.set(source.title, pages)
  }
  return [...books].map(([title, pages]) => ({ title, pages: pages.length ? `${pages.slice(0, 6).join('、')}${pages.length > 6 ? '等' : ''}` : '' }))
}
