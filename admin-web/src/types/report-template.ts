/**
 * 报告模板契约（报告成果中心 · 子模块一）。
 *
 * 状态：契约已生成，实现暂停。
 *
 * 结论：后端（../backend/src/modules/reports/reports.routes.ts 及全量路由扫描）
 * 当前不存在任何报告模板接口（无 report_templates 表、无 templates 路由），
 * 且 reports 表仅提供 templateVersion / promptTemplateVersion 两个版本字段。
 * 因此本子模块不产出页面，仅保留契约供后端接口落地后启用。
 */

/** 报告模板发布状态（契约枚举）。 */
export type ReportTemplatePublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/** 模板数据类型（契约枚举）。 */
export type ReportTemplateDataType =
  | 'project_info'
  | 'design_scheme'
  | 'calculation_result'
  | 'node_diagram'
  | 'source_material'
  | 'generation_log'

/** 模板章节定义（契约）。 */
export interface ReportTemplateSection {
  /** 章节标识，报告正文中的稳定 key。 */
  key: string
  /** 章节名称。 */
  name: string
  /** 是否必选章节。 */
  required: boolean
  /** 章节排序。 */
  sortOrder: number
  /** 章节数据来源。 */
  dataType: ReportTemplateDataType
}

/** 模板变量占位符（契约）。 */
export interface ReportTemplateVariable {
  /** 变量名（形如 projectName、buildingType）。 */
  name: string
  /** 变量说明。 */
  description?: string
  /** 是否必填。 */
  required: boolean
  /** 默认值。 */
  defaultValue?: string
}

/** 报告模板记录（契约，对齐后端预期字段）。 */
export interface ReportTemplate {
  id: string
  /** 模板名称。 */
  name: string
  /** 报告类型：energy_design / design_note / marketing_copy。 */
  reportType: 'energy_design' | 'design_note' | 'marketing_copy'
  /** 章节结构。 */
  sections: ReportTemplateSection[]
  /** 封面配置（JSON 快照）。 */
  coverJson: Record<string, unknown> | null
  /** 页眉页脚配置（JSON 快照）。 */
  headerFooterJson: Record<string, unknown> | null
  /** 模板变量。 */
  variables: ReportTemplateVariable[]
  /** 必选章节 key 列表（由 sections 派生，冗余便于校验）。 */
  requiredSectionKeys: string[]
  /** 数据来源说明。 */
  dataSource: string | null
  /** Word 模板文件（files.id，后端模板上传能力落地后启用）。 */
  wordTemplateFileId: string | null
  /** PDF 样式配置（JSON 快照）。 */
  pdfStyleJson: Record<string, unknown> | null
  /** 模板版本。 */
  version: number
  /** 发布状态。 */
  publishStatus: ReportTemplatePublishStatus
  createdAt: string
  updatedAt: string
}

/** 模板列表查询（契约）。 */
export interface ReportTemplatePageQuery {
  page?: number
  pageSize?: number
  reportType?: ReportTemplate['reportType']
  publishStatus?: ReportTemplatePublishStatus
}

/** 模板分页结果（契约）。 */
export interface ReportTemplatePageResult {
  items: ReportTemplate[]
  page: number
  pageSize: number
  total: number
}

/**
 * 后端落地该子模块所需的接口清单（契约）：
 * - GET    /api/v1/report-templates          模板分页列表
 * - POST   /api/v1/report-templates          创建模板（含 Word 模板上传）
 * - PATCH  /api/v1/report-templates/:id      修改模板
 * - POST   /api/v1/report-templates/:id/publish     发布模板
 * - POST   /api/v1/report-templates/:id/archive     归档模板
 * - GET    /api/v1/report-templates/:id/versions    模板版本历史
 *
 * 在接口存在之前，本子模块保持停用，不提供 Mock 页面。
 */
export const REPORT_TEMPLATE_CONTRACT_NOTES = '后端缺少报告模板接口，契约已生成，实现暂停' as const