/**
 * 图集热工参考表后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，业务域 thermal（图集热工参考表）。
 * 查看、新增、修改、删除、审核、发布、导入使用独立权限码；超级管理员全量放行。
 */
export const THERMAL_PERMISSIONS = {
  LIST: "system:thermal:list",
  CREATE: "system:thermal:add",
  UPDATE: "system:thermal:edit",
  DELETE: "system:thermal:remove",
  APPROVE: "system:thermal:approve",
  PUBLISH: "system:thermal:publish",
  IMPORT: "system:thermal:import"
} as const;

export type ThermalPermission = (typeof THERMAL_PERMISSIONS)[keyof typeof THERMAL_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const THERMAL_PERMISSION_SEEDS: ReadonlyArray<{
  code: ThermalPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: THERMAL_PERMISSIONS.LIST, name: "查看图集热工参考表", resource: "thermal", action: "list" },
  { code: THERMAL_PERMISSIONS.CREATE, name: "新增图集热工参考集", resource: "thermal", action: "add" },
  { code: THERMAL_PERMISSIONS.UPDATE, name: "修改图集热工参考集与参考行", resource: "thermal", action: "edit" },
  { code: THERMAL_PERMISSIONS.DELETE, name: "删除图集热工参考集草稿", resource: "thermal", action: "remove" },
  { code: THERMAL_PERMISSIONS.APPROVE, name: "审核图集热工参考集", resource: "thermal", action: "approve" },
  { code: THERMAL_PERMISSIONS.PUBLISH, name: "发布或停用图集热工参考集", resource: "thermal", action: "publish" },
  { code: THERMAL_PERMISSIONS.IMPORT, name: "导入图集热工参考选用表", resource: "thermal", action: "import" }
];