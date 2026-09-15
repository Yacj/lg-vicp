/**
 * 报告后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * - 普通业务：报告列表/生成 `system:report:generate`、审核 `system:report:review`、设置 `system:report:settings`。
 * - 报告模板（report_templates）为内部渲染配置：权限码保留给 SUPER_ADMIN / 高级技术管理员，普通菜单不展示。
 * 超级管理员全量放行；报告查看/下载仍走项目级或创建者归属校验。
 */
export const REPORT_PERMISSIONS = {
  TEMPLATE_LIST: "system:report:template:list",
  TEMPLATE_CREATE: "system:report:template:add",
  TEMPLATE_UPDATE: "system:report:template:edit",
  TEMPLATE_DELETE: "system:report:template:remove",
  TEMPLATE_APPROVE: "system:report:template:approve",
  TEMPLATE_PUBLISH: "system:report:template:publish",
  GENERATE: "system:report:generate",
  REVIEW: "system:report:review",
  SETTINGS: "system:report:settings"
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
  { code: REPORT_PERMISSIONS.GENERATE, name: "生成报告与提交审核", resource: "report", action: "generate" },
  { code: REPORT_PERMISSIONS.REVIEW, name: "审核报告", resource: "report", action: "review" },
  { code: REPORT_PERMISSIONS.SETTINGS, name: "查看和修改报告设置", resource: "report", action: "settings" }
];