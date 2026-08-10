/**
 * 节点图库后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:* 规范，业务域 node（节点大样图、节点-方案关联）。
 * 查看、新增、修改、删除、审核、发布使用独立权限码；超级管理员全量放行。
 */
export const NODE_PERMISSIONS = {
  LIST: "system:node:list",
  CREATE: "system:node:add",
  UPDATE: "system:node:edit",
  DELETE: "system:node:remove",
  APPROVE: "system:node:approve",
  PUBLISH: "system:node:publish"
} as const;

export type NodePermission = (typeof NODE_PERMISSIONS)[keyof typeof NODE_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const NODE_PERMISSION_SEEDS: ReadonlyArray<{
  code: NodePermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: NODE_PERMISSIONS.LIST, name: "查看节点图库", resource: "node", action: "list" },
  { code: NODE_PERMISSIONS.CREATE, name: "新增节点图", resource: "node", action: "add" },
  { code: NODE_PERMISSIONS.UPDATE, name: "修改节点图", resource: "node", action: "edit" },
  { code: NODE_PERMISSIONS.DELETE, name: "删除节点图草稿", resource: "node", action: "remove" },
  { code: NODE_PERMISSIONS.APPROVE, name: "审核节点图", resource: "node", action: "approve" },
  { code: NODE_PERMISSIONS.PUBLISH, name: "发布或停用节点图", resource: "node", action: "publish" }
];