import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../shared/errors.js";
import { USER_ROLES } from "../../shared/constants.js";
import {
  assertAdminCreateRole,
  assertChannelAccountHidden,
  assertDepartmentMemberRole,
  assertDepartmentNotAssignedViaUserEdit,
  assertUserPatchAllowed
} from "./user-admin.policy.js";

describe("B 端用户操作权限矩阵", () => {
  it("管理端只能创建超级管理员", () => {
    expect(() => assertAdminCreateRole(USER_ROLES.SUPER_ADMIN)).not.toThrow();
    expect(() => assertAdminCreateRole(USER_ROLES.NORMAL_USER)).toThrow(ForbiddenError);
    expect(() => assertAdminCreateRole(USER_ROLES.CHANNEL_USER)).toThrow(ForbiddenError);
  });

  it("渠道账号入口保持隐藏", () => {
    expect(() => assertChannelAccountHidden(USER_ROLES.CHANNEL_USER)).toThrow(ForbiddenError);
    expect(() => assertChannelAccountHidden(USER_ROLES.NORMAL_USER)).not.toThrow();
  });

  it("禁止通过编辑用户资料分配部门", () => {
    expect(() => assertDepartmentNotAssignedViaUserEdit(["dept-1"])).toThrow(ForbiddenError);
    expect(() => assertDepartmentNotAssignedViaUserEdit(undefined)).not.toThrow();
  });

  it("普通用户禁止编辑姓名/手机/邮箱/角色等资料", () => {
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { status: "DISABLED" })).not.toThrow();
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { displayName: "张三" })).toThrow(ForbiddenError);
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { phone: "13800138000" })).toThrow(ForbiddenError);
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { email: "a@example.com" })).toThrow(ForbiddenError);
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { role: USER_ROLES.SUPER_ADMIN })).toThrow(ForbiddenError);
    expect(() => assertUserPatchAllowed(USER_ROLES.NORMAL_USER, { departmentIds: ["d1"] })).toThrow(ForbiddenError);
  });

  it("超级管理员仍可编辑资料，但不能借 PATCH 分配部门", () => {
    expect(() => assertUserPatchAllowed(USER_ROLES.SUPER_ADMIN, { displayName: "管理员" })).not.toThrow();
    expect(() => assertUserPatchAllowed(USER_ROLES.SUPER_ADMIN, { departmentIds: ["d1"] })).toThrow(ForbiddenError);
  });

  it("部门成员只接受超级管理员或普通用户", () => {
    expect(() => assertDepartmentMemberRole(USER_ROLES.SUPER_ADMIN)).not.toThrow();
    expect(() => assertDepartmentMemberRole(USER_ROLES.NORMAL_USER)).not.toThrow();
    expect(() => assertDepartmentMemberRole(USER_ROLES.CHANNEL_USER)).toThrow(ForbiddenError);
  });
});
