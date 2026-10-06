import { USER_ROLES } from "../../shared/constants.js";
import { ForbiddenError } from "../../shared/errors.js";

const NORMAL_USER_LOCKED_PATCH_KEYS = [
  "displayName",
  "gender",
  "email",
  "remark",
  "role",
  "channelType",
  "adminLoginEnabled",
  "phone",
  "departmentIds",
  "postIds",
  "roleIds"
] as const;

export function assertChannelAccountHidden(role: string | undefined) {
  if (role === USER_ROLES.CHANNEL_USER) {
    throw new ForbiddenError("渠道用户入口当前未开放");
  }
}

/** B 端新增/导入用户当前只能是超级管理员；普通用户走 C 端注册。 */
export function assertAdminCreateRole(role: string | undefined) {
  assertChannelAccountHidden(role);
  if (role && role !== USER_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("管理端当前仅支持创建超级管理员；普通用户请通过 C 端注册");
  }
}

export function assertDepartmentMemberRole(role: string | undefined) {
  if (role === USER_ROLES.CHANNEL_USER) {
    throw new ForbiddenError("渠道用户入口当前未开放，不能加入部门");
  }
  if (role !== USER_ROLES.SUPER_ADMIN && role !== USER_ROLES.NORMAL_USER) {
    throw new ForbiddenError("只有超级管理员或普通用户可以加入部门");
  }
}

/**
 * 部门归属收口到「部门管理 → 部门成员」。
 * 编辑用户资料不得再承担部门分配。
 */
export function assertDepartmentNotAssignedViaUserEdit(departmentIds: unknown) {
  if (departmentIds !== undefined) {
    throw new ForbiddenError("请通过部门成员接口维护部门归属，不能在编辑用户资料时分配部门");
  }
}

/**
 * NORMAL_USER：允许查看、启用/禁用、删除；禁止改姓名/手机/邮箱/账号类型/角色/普通资料。
 * SUPER_ADMIN：资料可编辑，但部门仍不走本接口。
 */
export function assertUserPatchAllowed(targetRole: string, patch: Record<string, unknown>) {
  assertDepartmentNotAssignedViaUserEdit(patch.departmentIds);
  if (targetRole !== USER_ROLES.NORMAL_USER) return;
  const locked = NORMAL_USER_LOCKED_PATCH_KEYS.filter((key) => key in patch && patch[key] !== undefined);
  if (locked.length > 0) {
    throw new ForbiddenError("普通用户不能在后台编辑姓名、手机号、邮箱、账号类型或角色；启用/禁用请走状态接口，部门归属走部门成员");
  }
}
