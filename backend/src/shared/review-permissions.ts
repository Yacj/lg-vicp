/**
 * 统一审核中心后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 审核中心统一处理产品/构造/热工/标准/比较规则/报告等专业数据的提交与决议；
 * 查看队列与详情使用 list，执行审核决议（通过/驳回）使用 approve，超级管理员全量放行。
 * 注意：审核中心不替代各模块原有审核端点（submit/approve/reject 仍可用），
 * 各域审核动作通过统一审核记录（professional_reviews）自动进入本中心队列。
 */
export const REVIEW_PERMISSIONS = {
  LIST: "system:review:list",
  APPROVE: "system:review:approve"
} as const;

export type ReviewPermission = (typeof REVIEW_PERMISSIONS)[keyof typeof REVIEW_PERMISSIONS];

/** 权限码种子元数据（与 src/db/seed.ts permissionSeeds 合并写入，单一事实源） */
export const REVIEW_PERMISSION_SEEDS: ReadonlyArray<{
  code: ReviewPermission;
  name: string;
  resource: string;
  action: string;
}> = [
  { code: REVIEW_PERMISSIONS.LIST, name: "查看审核中心队列", resource: "review", action: "list" },
  { code: REVIEW_PERMISSIONS.APPROVE, name: "执行审核决议（通过/驳回）", resource: "review", action: "approve" }
];