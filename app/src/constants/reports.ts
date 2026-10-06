import type { PublicReportType } from '@/api/types'

/** 历史 code 仅作列表/详情展示回退，不再作为生成入口的唯一数据源。 */
export const HISTORICAL_REPORT_TYPE_LABELS: Record<string, string> = {
  energy_design: '建筑节能设计报告',
  design_note: 'VICP 设计说明',
  marketing_copy: 'VICP 项目说明',
  technical_scheme: '综合技术方案报告',
  project_brief: '项目方案简报',
  material_compare: '材料对比报告',
  ai_conversation: 'AI对话整理报告',
}

/**
 * @deprecated 旧硬编码选项不再主导报告类型。请使用 GET /reports/types。
 * 保留空数组，避免残留 Action Sheet 仍弹出 energy_design / design_note / marketing_copy。
 */
export const REPORT_TYPE_OPTIONS: Array<{ value: string, name: string }> = []

let cachedReportTypes: PublicReportType[] = []

export function setReportTypeCatalog(items: PublicReportType[]) {
  cachedReportTypes = items.filter(item => item.enabled !== false)
}

export function getReportTypeCatalog() {
  return cachedReportTypes
}

export function reportTypeLabel(reportType: string, hasProject?: boolean) {
  const fromCatalog = cachedReportTypes.find(item => item.code === reportType)
  if (fromCatalog?.name) {
    return fromCatalog.name
  }
  if (HISTORICAL_REPORT_TYPE_LABELS[reportType]) {
    return HISTORICAL_REPORT_TYPE_LABELS[reportType]
  }
  if (!reportType && !hasProject) {
    return 'AI对话报告'
  }
  return reportType || '工程报告'
}

export function formatReportDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
