/**
 * 地方标准采集后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，业务域 standard（地方标准采集）。
 * 查看、新增、修改、删除、审核、发布、触发抓取使用独立权限码；超级管理员全量放行。
 */
export const STANDARD_PERMISSIONS = {
  LIST: "system:standard:list",
  CREATE: "system:standard:add",
  UPDATE: "system:standard:edit",
  DELETE: "system:standard:remove",
  APPROVE: "system:standard:approve",
  PUBLISH: "system:standard:publish",
  RUN: "system:standard:run"
} as const;

export type StandardPermission = (typeof STANDARD_PERMISSIONS)[keyof typeof STANDARD_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const STANDARD_PERMISSION_SEEDS: ReadonlyArray<{
  code: StandardPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: STANDARD_PERMISSIONS.LIST, name: "查看地方标准采集数据", resource: "standard", action: "list" },
  { code: STANDARD_PERMISSIONS.CREATE, name: "新增标准来源与人工录入标准", resource: "standard", action: "add" },
  { code: STANDARD_PERMISSIONS.UPDATE, name: "修改标准来源与草稿文档", resource: "standard", action: "edit" },
  { code: STANDARD_PERMISSIONS.DELETE, name: "删除标准来源与草稿文档", resource: "standard", action: "remove" },
  { code: STANDARD_PERMISSIONS.APPROVE, name: "审核标准文档与指标", resource: "standard", action: "approve" },
  { code: STANDARD_PERMISSIONS.PUBLISH, name: "发布标准文档与指标", resource: "standard", action: "publish" },
  { code: STANDARD_PERMISSIONS.RUN, name: "触发标准站点抓取", resource: "standard", action: "run" }
];