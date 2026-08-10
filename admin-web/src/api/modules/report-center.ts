import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'
import type { PageResult } from '@/types/api'
import type { WorkflowActionInput } from '@/types/professional'
import type {
  GenerateReportInput,
  ReportSnapshot,
  ReportTemplate,
  ReportTemplateInput,
  ReportTemplateQuery,
  ReportTemplateViolation,
  TemplateReport,
  TemplateReportQuery,
} from '@/types/report-center'

const TEMPLATE_PREFIX = '/api/v1/platform/report-templates'
const REPORT_PREFIX = '/api/v1/platform/reports'

function templatePath(id: string): string {
  return `${TEMPLATE_PREFIX}/${encodeURIComponent(id)}`
}

function reportPath(id: string): string {
  return `${REPORT_PREFIX}/${encodeURIComponent(id)}`
}

// ===== 报告模板（版本化审核实体，含 submit/approve/reject/publish/disable/new-version 工作流） =====

export function fetchReportTemplates(
  query: ReportTemplateQuery,
  signal?: AbortSignal,
): Promise<PageResult<ReportTemplate>> {
  return api.get<PageResult<ReportTemplate>>(TEMPLATE_PREFIX, { params: query, signal })
}

export function fetchReportTemplate(id: string, signal?: AbortSignal): Promise<ReportTemplate> {
  return api.get<ReportTemplate>(templatePath(id), { signal })
}

export function createReportTemplate(input: ReportTemplateInput): Promise<{ template: ReportTemplate }> {
  return api.post<{ template: ReportTemplate }>(TEMPLATE_PREFIX, input)
}

export function updateReportTemplate(
  id: string,
  input: Partial<ReportTemplateInput>,
): Promise<{ template: ReportTemplate }> {
  return api.patch<{ template: ReportTemplate }>(templatePath(id), input)
}

export function deleteReportTemplate(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(templatePath(id))
}

/** 报告模板工作流（版本化审核实体：submit/approve/reject/publish/disable/new-version） */
export function runReportTemplateWorkflow(
  id: string,
  action: WorkflowActionInput,
): Promise<{ template: ReportTemplate }> {
  return postWorkflow<{ template: ReportTemplate }>(TEMPLATE_PREFIX, id, action)
}

/** 结构校验：不抛错，返回 valid + 违规明细 */
export function validateReportTemplate(id: string): Promise<{ valid: boolean; violations: ReportTemplateViolation[] }> {
  return api.post<{ valid: boolean; violations: ReportTemplateViolation[] }>(`${templatePath(id)}/validate`)
}

// ===== 模板报告（按项目） =====

export function fetchTemplateReports(
  query: TemplateReportQuery,
  signal?: AbortSignal,
): Promise<PageResult<TemplateReport>> {
  return api.get<PageResult<TemplateReport>>(REPORT_PREFIX, { params: query, signal })
}

/** 基于已确认候选与已发布模板生成报告（冻结数据快照并进入生成队列） */
export function generateTemplateReport(input: GenerateReportInput): Promise<{
  message: string
  report: TemplateReport
  taskId: string
}> {
  return api.post<{ message: string; report: TemplateReport; taskId: string }>(`${REPORT_PREFIX}/generate`, input)
}

export function fetchReportSnapshot(id: string, signal?: AbortSignal): Promise<ReportSnapshot> {
  return api.get<ReportSnapshot>(`${reportPath(id)}/snapshot`, { signal })
}

export function submitTemplateReportForReview(id: string, note?: string): Promise<TemplateReport> {
  return api.post<TemplateReport>(`${reportPath(id)}/submit-review`, note ? { note } : {})
}

export function approveTemplateReport(id: string, approvalNote?: string): Promise<TemplateReport> {
  return api.post<TemplateReport>(`${reportPath(id)}/approve`, approvalNote ? { approvalNote } : {})
}

export function rejectTemplateReport(id: string, rejectReason: string): Promise<TemplateReport> {
  return api.post<TemplateReport>(`${reportPath(id)}/reject`, { rejectReason })
}