/**
 * 报告模板与模板报告后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * - 报告模板（report_templates）：版本化审核实体，list/add/edit/remove/approve/publish 六动作。
 * - 模板报告生成（/api/v1/platform/reports）：system:report:generate（生成+提交审核+查看快照）。
 * - 模板报告审核（submit 后 approve/reject）：system:report:review。
 * 超级管理员全量放行；模板报告的查看/下载仍走项目级 canViewProject/canManageProject。
 */
export const REPORT_PERMISSIONS = {
  TEMPLATE_LIST: "system:report:template:list",
  TEMPLATE_CREATE: "system:report:template:add",
  TEMPLATE_UPDATE: "system:report:template:edit",
  TEMPLATE_DELETE: "system:report:template:remove",
  TEMPLATE_APPROVE: "system:report:template:approve",
  TEMPLATE_PUBLISH: "system:report:template:publish",
  GENERATE: "system:report:generate",
  REVIEW: "system:report:review"
} as const;

export type ReportPermission = (typeof REPORT_PERMISSIONS)[keyof typeof REPORT_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const REPORT_PERMISSION_SEEDS: ReadonlyArray<{
  code: ReportPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: REPORT_PERMISSIONS.TEMPLATE_LIST, name: "查看报告模板", resource: "report_template", action: "list" },
  { code: REPORT_PERMISSIONS.TEMPLATE_CREATE, name: "新增报告模板", resource: "report_template", action: "add" },
  { code: REPORT_PERMISSIONS.TEMPLATE_UPDATE, name: "修改报告模板", resource: "report_template", action: "edit" },
  { code: REPORT_PERMISSIONS.TEMPLATE_DELETE, name: "删除报告模板草稿", resource: "report_template", action: "remove" },
  { code: REPORT_PERMISSIONS.TEMPLATE_APPROVE, name: "审核报告模板", resource: "report_template", action: "approve" },
  { code: REPORT_PERMISSIONS.TEMPLATE_PUBLISH, name: "发布或停用报告模板", resource: "report_template", action: "publish" },
  { code: REPORT_PERMISSIONS.GENERATE, name: "生成模板报告与提交审核", resource: "report", action: "generate" },
  { code: REPORT_PERMISSIONS.REVIEW, name: "审核模板报告", resource: "report", action: "review" }
];