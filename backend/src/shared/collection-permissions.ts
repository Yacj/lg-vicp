/**
 * 采集管理后台权限码（与 src/db/seed.ts permissionSeeds 保持一致）。
 * Collection 是独立 Domain，不复用 system:knowledge:crawler:*。
 */
export const COLLECTION_PERMISSIONS = {
  LIST: "system:collection:list",
  MANUAL_CREATE: "system:collection:manual:create",
  AUTO_LIST: "system:collection:auto:list",
  AUTO_CREATE: "system:collection:auto:create",
  AUTO_UPDATE: "system:collection:auto:update",
  AUTO_TOGGLE: "system:collection:auto:toggle",
  TASK_VIEW: "system:collection:task:view",
  TASK_IMPORT: "system:collection:task:import"
} as const;

export type CollectionPermission = (typeof COLLECTION_PERMISSIONS)[keyof typeof COLLECTION_PERMISSIONS];

export const COLLECTION_PERMISSION_SEEDS: ReadonlyArray<{
  code: CollectionPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: COLLECTION_PERMISSIONS.LIST, name: "查看采集任务列表", resource: "collection", action: "list" },
  { code: COLLECTION_PERMISSIONS.MANUAL_CREATE, name: "创建手动采集任务", resource: "collection_manual", action: "create" },
  { code: COLLECTION_PERMISSIONS.AUTO_LIST, name: "查看自动采集源", resource: "collection_source", action: "list" },
  { code: COLLECTION_PERMISSIONS.AUTO_CREATE, name: "新增自动采集源", resource: "collection_source", action: "create" },
  { code: COLLECTION_PERMISSIONS.AUTO_UPDATE, name: "修改自动采集源", resource: "collection_source", action: "update" },
  { code: COLLECTION_PERMISSIONS.AUTO_TOGGLE, name: "启停自动采集源", resource: "collection_source", action: "toggle" },
  { code: COLLECTION_PERMISSIONS.TASK_VIEW, name: "查看采集任务详情", resource: "collection_task", action: "view" },
  { code: COLLECTION_PERMISSIONS.TASK_IMPORT, name: "确认采集结果入库知识库", resource: "collection_task", action: "import" }
];
