import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth-user.js";
import { AUTH_CLIENTS, PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";
import { canCreateProjectFromClient, canDeleteProject, canEditProject, canManageProject, canViewProject } from "./permissions.js";

const superAdmin: AuthUser = {
  id: "admin-1",
  role: USER_ROLES.SUPER_ADMIN,
  channelType: null,
  adminLoginEnabled: true,
  clientType: AUTH_CLIENTS.B_ADMIN
};

const channelUser: AuthUser = {
  id: "channel-1",
  role: USER_ROLES.CHANNEL_USER,
  channelType: "DEALER",
  adminLoginEnabled: true,
  clientType: AUTH_CLIENTS.B_ADMIN
};

const normalUser: AuthUser = {
  id: "normal-1",
  role: USER_ROLES.NORMAL_USER,
  channelType: null,
  adminLoginEnabled: false,
  clientType: AUTH_CLIENTS.C_APP,
  departmentIds: ["east-a"],
  departmentScopeIds: ["east-a", "east", "root"]
};

describe("project permissions", () => {
  it("仅普通用户可在 C / PC AI 端创建项目，B 端超级管理员不能新增", () => {
    expect(canCreateProjectFromClient(superAdmin)).toBe(false);
    expect(canCreateProjectFromClient(channelUser)).toBe(false);
    expect(canCreateProjectFromClient(normalUser)).toBe(true);
    expect(canCreateProjectFromClient({ ...normalUser, clientType: AUTH_CLIENTS.PC_AI })).toBe(true);
    expect(canCreateProjectFromClient({ ...normalUser, clientType: AUTH_CLIENTS.B_ADMIN })).toBe(false);
  });

  it("私有项目只对创建者和 B 端超级管理员开放", () => {
    const privateProject = {
      createdById: normalUser.id,
      visibility: PROJECT_VISIBILITY.PRIVATE
    };

    expect(canViewProject(normalUser, privateProject)).toBe(true);
    expect(canViewProject(superAdmin, privateProject)).toBe(true);
    expect(canViewProject({ ...superAdmin, clientType: AUTH_CLIENTS.C_APP }, privateProject)).toBe(false);
    expect(canViewProject(channelUser, privateProject)).toBe(false);
  });

  it("不再依据历史成员关系授予私有项目权限", () => {
    const privateProject = {
      id: "project-1",
      createdById: normalUser.id,
      visibility: PROJECT_VISIBILITY.PRIVATE
    };
    const formerMember: AuthUser = { ...normalUser, id: "viewer-1" };

    expect(canViewProject(formerMember, privateProject)).toBe(false);
    expect(canManageProject(formerMember, privateProject)).toBe(false);
  });

  it("历史公开项目对所有已认证账号可读", () => {
    const publicProject = { id: "project-2", createdById: normalUser.id, visibility: PROJECT_VISIBILITY.PUBLIC };
    expect(canViewProject({ ...normalUser, id: "other" }, publicProject)).toBe(true);
  });

  it("部门可见性由服务端按部门树判断，含子部门时下级可见", () => {
    const departmentProject = {
      createdById: "owner-2",
      visibility: PROJECT_VISIBILITY.DEPARTMENT,
      visibleDepartmentId: "east",
      includeChildDepartments: true
    };
    expect(canViewProject(normalUser, departmentProject)).toBe(true);
    expect(canViewProject({ ...normalUser, departmentIds: ["west"], departmentScopeIds: ["west", "root"] }, departmentProject)).toBe(false);
    expect(canViewProject(normalUser, { ...departmentProject, includeChildDepartments: false })).toBe(false);
  });

  it("B 端超级管理员可删除但不能编辑他人项目", () => {
    const project = { createdById: normalUser.id };
    expect(canEditProject(superAdmin, project)).toBe(false);
    expect(canDeleteProject(superAdmin, project)).toBe(true);
    expect(canManageProject(superAdmin, project)).toBe(true);
    expect(canEditProject(normalUser, project)).toBe(true);
    expect(canDeleteProject(normalUser, project)).toBe(true);
  });

  it("超级管理员持有 C 端令牌时不能按后台身份查看或管理他人项目", () => {
    const project = { createdById: normalUser.id, visibility: PROJECT_VISIBILITY.PRIVATE };
    const adminOnClient: AuthUser = { ...superAdmin, clientType: AUTH_CLIENTS.C_APP };
    expect(canViewProject(adminOnClient, project)).toBe(false);
    expect(canDeleteProject(adminOnClient, project)).toBe(false);
    expect(canManageProject(adminOnClient, project)).toBe(false);
  });
});
