import type { PageResult } from '@/types/api'

/** 审核中心类型：统一专业数据审核队列（产品/构造/热工/标准/比较/节点/报告模板/报告）。 */

export const reviewStatuses = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const
export type ReviewQueueStatus = (typeof reviewStatuses)[number]

/** 实体类型白名单（professional_reviews.entityType，与审核中心服务注册一致） */
export const reviewEntityTypes = [
  'md_enterprise_profile',
  'md_product_series',
  'md_product_spec',
  'md_product_parameter',
  'md_material',
  'md_material_parameter_version',
  'construction_insulation_system',
  'construction_scheme',
  'thermal_reference_set',
  'thermal_calc_rule',
  'thermal_standard_limit',
  'comparison_version',
  'node_drawing',
  'report_template',
  'standard_document',
  'report',
] as const
export type ReviewEntityType = (typeof reviewEntityTypes)[number]

/** 实体类型展示映射（与后端 ENTITY_REVIEWERS label 一致） */
export const reviewEntityLabels: Record<ReviewEntityType, string> = {
  md_enterprise_profile: '企业内容',
  md_product_series: '产品系列',
  md_product_spec: '产品规格',
  md_product_parameter: '产品性能参数',
  md_material: '材料',
  md_material_parameter_version: '材料参数版本',
  construction_insulation_system: '保温系统',
  construction_scheme: '构造方案',
  thermal_reference_set: '图集热工参考集',
  thermal_calc_rule: '热工计算规则',
  thermal_standard_limit: '地区标准限值',
  comparison_version: '材料对比版本',
  node_drawing: '节点图',
  report_template: '报告模板',
  standard_document: '地方标准文档',
  report: '模板报告',
}

/** 审核队列项（审核记录 + 实体中文名） */
export interface ReviewQueueItem {
  id: string
  entityType: string
  entityId: string
  entityVersion: number | null
  status: ReviewQueueStatus
  comment: string | null
  projectId: string | null
  submittedById: string | null
  submittedAt: string | null
  reviewedById: string | null
  reviewedAt: string | null
  requestId: string | null
  /** 实体中文名（后端注入） */
  label: string
  createdAt: string
  updatedAt: string
}

/** 审核详情：记录 + 实体数据预览（各域详情行，结构随实体类型变化） */
export interface ReviewDetail {
  record: ReviewQueueItem
  entity: Record<string, unknown> | null
}

export interface ReviewQueueQuery {
  page: number
  pageSize: number
  entityType?: string
  status?: ReviewQueueStatus
}

export type { PageResult }