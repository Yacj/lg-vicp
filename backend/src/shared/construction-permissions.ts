/**
 * 保温系统/构造方案/构造层 后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，业务域 construction（保温系统、构造方案、构造层、产品选项、方案文档）。
 * 查看、新增、修改、删除、审核、发布使用独立权限码；超级管理员全量放行。
 */
export const CONSTRUCTION_PERMISSIONS = {
  LIST: "system:construction:list",
  CREATE: "system:construction:add",
  UPDATE: "system:construction:edit",
  DELETE: "system:construction:remove",
  APPROVE: "system:construction:approve",
  PUBLISH: "system:construction:publish"
} as const;

export type ConstructionPermission = (typeof CONSTRUCTION_PERMISSIONS)[keyof typeof CONSTRUCTION_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const CONSTRUCTION_PERMISSION_SEEDS: ReadonlyArray<{
  code: ConstructionPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: CONSTRUCTION_PERMISSIONS.LIST, name: "查看保温系统与构造方案", resource: "construction", action: "list" },
  { code: CONSTRUCTION_PERMISSIONS.CREATE, name: "新增保温系统与构造方案", resource: "construction", action: "add" },
  { code: CONSTRUCTION_PERMISSIONS.UPDATE, name: "修改保温系统与构造方案", resource: "construction", action: "edit" },
  { code: CONSTRUCTION_PERMISSIONS.DELETE, name: "删除保温系统与构造方案草稿", resource: "construction", action: "remove" },
  { code: CONSTRUCTION_PERMISSIONS.APPROVE, name: "审核保温系统与构造方案", resource: "construction", action: "approve" },
  { code: CONSTRUCTION_PERMISSIONS.PUBLISH, name: "发布或停用保温系统与构造方案", resource: "construction", action: "publish" }
];