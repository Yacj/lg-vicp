/**
 * 材料对比规则引擎后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，业务域 comparison（材料对比规则）。
 * 查看、新增、修改、删除、审核、发布使用独立权限码；超级管理员全量放行。
 */
export const COMPARISON_PERMISSIONS = {
  LIST: "system:comparison:list",
  CREATE: "system:comparison:add",
  UPDATE: "system:comparison:edit",
  DELETE: "system:comparison:remove",
  APPROVE: "system:comparison:approve",
  PUBLISH: "system:comparison:publish"
} as const;

export type ComparisonPermission = (typeof COMPARISON_PERMISSIONS)[keyof typeof COMPARISON_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const COMPARISON_PERMISSION_SEEDS: ReadonlyArray<{
  code: ComparisonPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: COMPARISON_PERMISSIONS.LIST, name: "查看材料对比规则", resource: "comparison", action: "list" },
  { code: COMPARISON_PERMISSIONS.CREATE, name: "新增材料对比版本", resource: "comparison", action: "add" },
  { code: COMPARISON_PERMISSIONS.UPDATE, name: "修改材料对比材料与规则", resource: "comparison", action: "edit" },
  { code: COMPARISON_PERMISSIONS.DELETE, name: "删除材料对比草稿", resource: "comparison", action: "remove" },
  { code: COMPARISON_PERMISSIONS.APPROVE, name: "审核材料对比版本", resource: "comparison", action: "approve" },
  { code: COMPARISON_PERMISSIONS.PUBLISH, name: "发布或停用材料对比版本", resource: "comparison", action: "publish" }
];