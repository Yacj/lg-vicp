import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth-user.js";
import { AUTH_CLIENTS, PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";
import { canCreateProjectFromClient, canManageProject, canViewProject } from "./permissions.js";

const superAdmin: AuthUser = {
  id: "admin-1",
  role: USER_ROLES.SUPER_ADMIN,
  channelType: null,
  clientType: AUTH_CLIENTS.B_ADMIN
};

const channelUser: AuthUser = {
  id: "channel-1",
  role: USER_ROLES.CHANNEL_USER,
  channelType: "DEALER",
  clientType: AUTH_CLIENTS.B_ADMIN
};

const normalUser: AuthUser = {
  id: "normal-1",
  role: USER_ROLES.NORMAL_USER,
  channelType: null,
  clientType: AUTH_CLIENTS.C_APP
};

const channelCAppUser: AuthUser = {
  ...channelUser,
  clientType: AUTH_CLIENTS.C_APP
};

const channelPcAiUser: AuthUser = {
  ...channelUser,
  clientType: AUTH_CLIENTS.PC_AI
};

describe("project permissions", () => {
  it("allows project creation for configured clients and keeps normal users closed", () => {
    expect(canCreateProjectFromClient(superAdmin)).toBe(true);
    expect(canCreateProjectFromClient(channelUser)).toBe(true);
    expect(canCreateProjectFromClient(channelCAppUser)).toBe(true);
    expect(canCreateProjectFromClient(channelPcAiUser)).toBe(true);
    expect(canCreateProjectFromClient(normalUser)).toBe(false);
  });

  it("allows private projects only for creator and super admin", () => {
    const privateProject = {
      createdById: channelUser.id,
      visibility: PROJECT_VISIBILITY.PRIVATE
    };

    expect(canViewProject(channelUser, privateProject)).toBe(true);
    expect(canViewProject(superAdmin, privateProject)).toBe(true);
    expect(canViewProject(normalUser, privateProject)).toBe(false);
  });

  it("不再依据历史成员关系授予私有项目权限", () => {
    const privateProject = {
      id: "project-1",
      createdById: channelUser.id,
      visibility: PROJECT_VISIBILITY.PRIVATE
    };
    const formerMember: AuthUser = { ...channelUser, id: "viewer-1" };

    expect(canViewProject(formerMember, privateProject)).toBe(false);
    expect(canManageProject(formerMember, privateProject)).toBe(false);
  });

  it("公开项目对所有已认证账号可读", () => {
    const publicProject = { id: "project-2", createdById: channelUser.id, visibility: PROJECT_VISIBILITY.PUBLIC };

    expect(canViewProject(normalUser, publicProject)).toBe(true);
  });
});
