/**
 * B 端消息通知中心权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 通知查看与已读标记使用独立权限码；超级管理员全量放行。
 */
export const NOTIFICATION_PERMISSIONS = {
  LIST: "system:notification:list",
  READ: "system:notification:read"
} as const;

export type NotificationPermission = (typeof NOTIFICATION_PERMISSIONS)[keyof typeof NOTIFICATION_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const NOTIFICATION_PERMISSION_SEEDS: ReadonlyArray<{
  code: NotificationPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: NOTIFICATION_PERMISSIONS.LIST, name: "查看消息通知列表与未读数", resource: "notification", action: "list" },
  { code: NOTIFICATION_PERMISSIONS.READ, name: "标记消息通知已读", resource: "notification", action: "read" }
];
