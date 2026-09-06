/**
 * 文件中心权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 文件中心管理能力与业务 FilePicker 选择能力分离：
 * FilePicker（选择已有文件/上传新文件）只需登录 B_ADMIN，不要求文件中心权限码；
 * 文件中心列表管理、引用查看、回收/恢复/永久删除需要以下权限码；超级管理员全量放行。
 */
export const FILE_CENTER_PERMISSIONS = {
  VIEW: "file:center:view",
  UPLOAD: "file:center:upload",
  MANAGE: "file:center:manage"
} as const;

export type FileCenterPermission =
  (typeof FILE_CENTER_PERMISSIONS)[keyof typeof FILE_CENTER_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const FILE_CENTER_PERMISSION_SEEDS: ReadonlyArray<{
  code: FileCenterPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: FILE_CENTER_PERMISSIONS.VIEW, name: "查看文件中心列表与详情", resource: "file", action: "center:view" },
  { code: FILE_CENTER_PERMISSIONS.UPLOAD, name: "通过文件中心上传文件", resource: "file", action: "center:upload" },
  { code: FILE_CENTER_PERMISSIONS.MANAGE, name: "文件中心回收/恢复/永久删除", resource: "file", action: "center:manage" }
];
